import pg from 'pg';
const { Pool } = pg;

// SEC-H2: en prod exige DATABASE_URL explícito; en dev permite fallback local.
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL env var es requerida en producción. ' +
      'Configurala en Railway antes de arrancar el servicio.'
    );
  }
  console.warn(
    '⚠️  DATABASE_URL no está seteada. Usando fallback local (solo dev): ' +
    'postgresql://slacker@localhost:5432/bingo'
  );
  return 'postgresql://slacker@localhost:5432/bingo';
}
const DATABASE_URL = requireDatabaseUrl();

let pool: pg.Pool | undefined;

export async function initPool(): Promise<void> {
  pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  await pool.query('SELECT 1');
  await ensureQrScansTable();
}

// Auto-migración idempotente de qr_scans en 3 fases ordenadas:
//   1. CREATE TABLE IF NOT EXISTS — solo garantiza que la tabla exista (base mínima).
//   2. ALTER TABLE ADD COLUMN IF NOT EXISTS — añade todas las columnas modernas.
//   3. CREATE INDEX IF NOT EXISTS — después de que las columnas existan.
// Retención indefinida.
async function ensureQrScansTable(): Promise<void> {
  const p = getPool();

  // Fase 1 — tabla base. No incluye índices que dependan de columnas nuevas,
  // porque si la tabla ya existe con schema viejo, el CREATE TABLE es no-op
  // y los índices se intentarían crear sobre columnas inexistentes.
  await p.query(`
    CREATE TABLE IF NOT EXISTS qr_scans (
      id              BIGSERIAL PRIMARY KEY,
      source          TEXT NOT NULL,
      ip              INET,
      user_agent      TEXT,
      referer         TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  // Fase 2 — ALTER TABLE idempotente. Añade cualquier columna faltante.
  for (const { col, type, default: def } of extraCols) {
    const defaultClause = def ? ` DEFAULT ${def}` : '';
    await p.query(`ALTER TABLE qr_scans ADD COLUMN IF NOT EXISTS ${col} ${type}${defaultClause}`);
  }

  // Fase 3 — índices. Ahora que todas las columnas existen, los índices
  // se crean sin riesgo de referenciar columnas inexistentes.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_source_created ON qr_scans (source, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_created ON qr_scans (created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_visitor ON qr_scans (visitor_hash)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_country ON qr_scans (country)`);

  // Atribución: persistir el ref/source que llegó vía /go → /venta/:id?ref=xxx
  // en la orden final, para cruzar escaneos con compras reales. Tolerante a
  // que online_orders no exista (ej. si landing corre contra DB separada).
  try {
    await p.query(`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS ref_source TEXT`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_online_orders_ref_source ON online_orders (ref_source)`);
  } catch (err) {
    console.warn('⚠️ No se pudo migrar online_orders.ref_source:', (err as Error).message);
  }
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool no inicializado. Llama initPool() antes de usar getPool().');
  }
  return pool;
}
