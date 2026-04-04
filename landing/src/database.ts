import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';

let pool: pg.Pool | undefined;

export async function initPool(): Promise<void> {
  pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  await pool.query('SELECT 1');
  await ensureQrScansTable();
}

// Auto-migración idempotente de qr_scans. Retención indefinida.
async function ensureQrScansTable(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS qr_scans (
      id              BIGSERIAL PRIMARY KEY,

      -- Atribución (query string)
      source          TEXT NOT NULL,
      utm_source      TEXT,
      utm_medium      TEXT,
      utm_campaign    TEXT,
      utm_content     TEXT,
      utm_term        TEXT,
      gclid           TEXT,
      fbclid          TEXT,
      raw_query       TEXT,

      -- Red
      ip              INET,
      ip_chain        TEXT,
      country         TEXT,
      region          TEXT,
      city            TEXT,
      timezone        TEXT,
      lat             NUMERIC(8,4),
      lon             NUMERIC(8,4),

      -- Cliente (headers + parsed UA)
      user_agent      TEXT,
      browser_name    TEXT,
      browser_version TEXT,
      os_name         TEXT,
      os_version      TEXT,
      device_type     TEXT,
      device_vendor   TEXT,
      device_model    TEXT,
      engine_name     TEXT,
      is_bot          BOOLEAN DEFAULT FALSE,
      language        TEXT,

      -- Client Hints
      ch_ua           TEXT,
      ch_ua_mobile    TEXT,
      ch_ua_platform  TEXT,

      -- Privacidad (señales del cliente, respetadas)
      dnt             BOOLEAN DEFAULT FALSE,
      sec_gpc         BOOLEAN DEFAULT FALSE,

      -- Origen
      referer         TEXT,
      host            TEXT,
      protocol        TEXT,

      -- Dedupe
      visitor_hash    TEXT,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_qr_scans_source_created ON qr_scans (source, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qr_scans_created        ON qr_scans (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qr_scans_visitor        ON qr_scans (visitor_hash);
    CREATE INDEX IF NOT EXISTS idx_qr_scans_country        ON qr_scans (country);
  `);

  // ALTER TABLE idempotente para instalaciones viejas que ya tenían qr_scans mínimo.
  // Tipo y default van separados para evitar que el DEFAULT quede embebido en la
  // cadena del tipo (frágil si el loop se extiende a otros ALTER en el futuro).
  const extraCols: Array<{ col: string; type: string; default?: string }> = [
    { col: 'utm_source',      type: 'TEXT' },
    { col: 'utm_medium',      type: 'TEXT' },
    { col: 'utm_campaign',    type: 'TEXT' },
    { col: 'utm_content',     type: 'TEXT' },
    { col: 'utm_term',        type: 'TEXT' },
    { col: 'gclid',           type: 'TEXT' },
    { col: 'fbclid',          type: 'TEXT' },
    { col: 'raw_query',       type: 'TEXT' },
    { col: 'ip_chain',        type: 'TEXT' },
    { col: 'country',         type: 'TEXT' },
    { col: 'region',          type: 'TEXT' },
    { col: 'city',            type: 'TEXT' },
    { col: 'timezone',        type: 'TEXT' },
    { col: 'lat',             type: 'NUMERIC(8,4)' },
    { col: 'lon',             type: 'NUMERIC(8,4)' },
    { col: 'browser_name',    type: 'TEXT' },
    { col: 'browser_version', type: 'TEXT' },
    { col: 'os_name',         type: 'TEXT' },
    { col: 'os_version',      type: 'TEXT' },
    { col: 'device_type',     type: 'TEXT' },
    { col: 'device_vendor',   type: 'TEXT' },
    { col: 'device_model',    type: 'TEXT' },
    { col: 'engine_name',     type: 'TEXT' },
    { col: 'is_bot',          type: 'BOOLEAN', default: 'FALSE' },
    { col: 'language',        type: 'TEXT' },
    { col: 'ch_ua',           type: 'TEXT' },
    { col: 'ch_ua_mobile',    type: 'TEXT' },
    { col: 'ch_ua_platform',  type: 'TEXT' },
    { col: 'dnt',             type: 'BOOLEAN', default: 'FALSE' },
    { col: 'sec_gpc',         type: 'BOOLEAN', default: 'FALSE' },
    { col: 'host',            type: 'TEXT' },
    { col: 'protocol',        type: 'TEXT' },
    { col: 'visitor_hash',    type: 'TEXT' },
  ];
  for (const { col, type, default: def } of extraCols) {
    const defaultClause = def ? ` DEFAULT ${def}` : '';
    await p.query(`ALTER TABLE qr_scans ADD COLUMN IF NOT EXISTS ${col} ${type}${defaultClause}`);
  }

  // Atribución: persistir el ref/source que llegó vía /go → /venta/:id?ref=xxx
  // en la orden final, para cruzar escaneos con compras reales.
  await p.query(`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ref_source TEXT`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_online_orders_ref_source ON online_orders (ref_source)`);
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool no inicializado. Llama initPool() antes de usar getPool().');
  }
  return pool;
}
