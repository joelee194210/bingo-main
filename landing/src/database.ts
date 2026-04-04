import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';

let pool: pg.Pool;

export async function initPool(): Promise<void> {
  pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  await pool.query('SELECT 1');
  await ensureQrScansTable();
}

// Auto-migración idempotente de qr_scans. Retención indefinida.
async function ensureQrScansTable(): Promise<void> {
  await pool.query(`
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

  // ALTER TABLE idempotente para instalaciones viejas que ya tenían qr_scans mínimo
  const extraCols: Array<[string, string]> = [
    ['utm_source', 'TEXT'], ['utm_medium', 'TEXT'], ['utm_campaign', 'TEXT'],
    ['utm_content', 'TEXT'], ['utm_term', 'TEXT'], ['gclid', 'TEXT'], ['fbclid', 'TEXT'],
    ['raw_query', 'TEXT'], ['ip_chain', 'TEXT'], ['country', 'TEXT'], ['region', 'TEXT'],
    ['city', 'TEXT'], ['timezone', 'TEXT'], ['lat', 'NUMERIC(8,4)'], ['lon', 'NUMERIC(8,4)'],
    ['browser_name', 'TEXT'], ['browser_version', 'TEXT'], ['os_name', 'TEXT'],
    ['os_version', 'TEXT'], ['device_type', 'TEXT'], ['device_vendor', 'TEXT'],
    ['device_model', 'TEXT'], ['engine_name', 'TEXT'], ['is_bot', 'BOOLEAN DEFAULT FALSE'],
    ['language', 'TEXT'], ['ch_ua', 'TEXT'], ['ch_ua_mobile', 'TEXT'], ['ch_ua_platform', 'TEXT'],
    ['dnt', 'BOOLEAN DEFAULT FALSE'], ['sec_gpc', 'BOOLEAN DEFAULT FALSE'], ['host', 'TEXT'],
    ['protocol', 'TEXT'], ['visitor_hash', 'TEXT'],
  ];
  for (const [col, type] of extraCols) {
    await pool.query(`ALTER TABLE qr_scans ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }

  // Atribución: persistir el ref/source que llegó vía /go → /venta/:id?ref=xxx
  // en la orden final, para cruzar escaneos con compras reales.
  await pool.query(`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ref_source TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_online_orders_ref_source ON online_orders (ref_source)`);
}

export function getPool(): pg.Pool {
  return pool;
}
