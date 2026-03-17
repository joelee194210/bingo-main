import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function initializeDatabase(): Promise<Pool> {
  const p = getPool();

  // Execute schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await p.query(schema);

  // Run migrations
  await runMigrations(p);

  console.log('✅ Base de datos PostgreSQL inicializada correctamente');

  return p;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function runMigrations(p: Pool): Promise<void> {
  // Check if columns exist before adding them
  const checkColumn = async (table: string, column: string): Promise<boolean> => {
    const result = await p.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return result.rows.length > 0;
  };

  // Migration: use_free_center on events
  if (!(await checkColumn('events', 'use_free_center'))) {
    await p.query('ALTER TABLE events ADD COLUMN use_free_center BOOLEAN DEFAULT TRUE');
    console.log('✅ Migración aplicada: use_free_center agregado a events');
  }

  // Migration: serial on cards
  if (!(await checkColumn('cards', 'serial'))) {
    await p.query("ALTER TABLE cards ADD COLUMN serial TEXT NOT NULL DEFAULT ''");
    const allCards = (await p.query('SELECT id, card_number FROM cards ORDER BY event_id, card_number')).rows;
    for (const card of allCards) {
      const series = Math.ceil(card.card_number / 50).toString().padStart(5, '0');
      const seq = (((card.card_number - 1) % 50) + 1).toString().padStart(2, '0');
      await p.query('UPDATE cards SET serial = $1 WHERE id = $2', [`${series}-${seq}`, card.id]);
    }
    await p.query('CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial)');
    console.log('✅ Migración aplicada: serial agregado a cards');
  }

  // Migration: promo_text on cards
  if (!(await checkColumn('cards', 'promo_text'))) {
    await p.query('ALTER TABLE cards ADD COLUMN promo_text TEXT');
    console.log('✅ Migración aplicada: promo_text agregado a cards');
  }

  // Migration: lote_id on cards
  if (!(await checkColumn('cards', 'lote_id'))) {
    await p.query('ALTER TABLE cards ADD COLUMN lote_id INTEGER REFERENCES lotes(id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_cards_lote ON cards(lote_id)');
    console.log('✅ Migración aplicada: lote_id agregado a cards');
  }

  // Migration: firma/PDF fields on inv_movimientos
  if (!(await checkColumn('inv_movimientos', 'pdf_path'))) {
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN pdf_path TEXT');
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN firma_entrega TEXT');
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN firma_recibe TEXT');
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN nombre_entrega TEXT');
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN nombre_recibe TEXT');
    console.log('✅ Migración aplicada: campos de firma/PDF agregados a inv_movimientos');
  }

  // Migration: inv_documentos table and documento_id on inv_movimientos
  const docTableExists = await p.query(`SELECT to_regclass('public.inv_documentos') as exists`);
  if (!docTableExists.rows[0].exists) {
    await p.query(`
      CREATE TABLE IF NOT EXISTS inv_documentos (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        accion TEXT NOT NULL,
        de_almacen_id INTEGER,
        a_almacen_id INTEGER,
        de_nombre TEXT,
        a_nombre TEXT,
        total_items INTEGER DEFAULT 0,
        total_cartones INTEGER DEFAULT 0,
        pdf_path TEXT,
        firma_entrega TEXT,
        firma_recibe TEXT,
        nombre_entrega TEXT,
        nombre_recibe TEXT,
        realizado_por INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (de_almacen_id) REFERENCES almacenes(id) ON DELETE SET NULL,
        FOREIGN KEY (a_almacen_id) REFERENCES almacenes(id) ON DELETE SET NULL,
        FOREIGN KEY (realizado_por) REFERENCES users(id)
      )
    `);
    console.log('✅ Migración aplicada: tabla inv_documentos creada');
  }
  if (!(await checkColumn('inv_movimientos', 'documento_id'))) {
    await p.query('ALTER TABLE inv_movimientos ADD COLUMN documento_id INTEGER REFERENCES inv_documentos(id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_inv_mov_documento ON inv_movimientos(documento_id)');
    console.log('✅ Migración aplicada: documento_id agregado a inv_movimientos');
  }

  // Migration: almacen_id on cajas
  if (!(await checkColumn('cajas', 'almacen_id'))) {
    await p.query('ALTER TABLE cajas ADD COLUMN almacen_id INTEGER REFERENCES almacenes(id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_cajas_almacen ON cajas(almacen_id)');
    console.log('✅ Migración aplicada: almacen_id agregado a cajas');
  }

  // Migration: users role constraint (incluye todos los roles)
  try {
    await p.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await p.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin', 'moderator', 'seller', 'viewer', 'inventory', 'loteria'))`);
  } catch {
    // constraint already exists
  }

  // Create serial index if not exists
  await p.query('CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial)');

  // Migration: almacen_id on lotes (ubicacion actual de cada libreta)
  if (!(await checkColumn('lotes', 'almacen_id'))) {
    await p.query('ALTER TABLE lotes ADD COLUMN almacen_id INTEGER REFERENCES almacenes(id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_lotes_almacen ON lotes(almacen_id)');
    // Backfill: heredar almacen de la caja
    await p.query(`
      UPDATE lotes SET almacen_id = c.almacen_id
      FROM cajas c WHERE c.id = lotes.caja_id AND c.almacen_id IS NOT NULL AND lotes.almacen_id IS NULL
    `);
    console.log('✅ Migración aplicada: almacen_id agregado a lotes');
  }

  // Migration: almacen_id on cards (ubicacion actual de cada carton)
  if (!(await checkColumn('cards', 'almacen_id'))) {
    await p.query('ALTER TABLE cards ADD COLUMN almacen_id INTEGER REFERENCES almacenes(id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_cards_almacen ON cards(almacen_id)');
    // Backfill: heredar almacen del lote (que a su vez hereda de la caja)
    await p.query(`
      UPDATE cards SET almacen_id = l.almacen_id
      FROM lotes l WHERE l.id = cards.lote_id AND l.almacen_id IS NOT NULL AND cards.almacen_id IS NULL
    `);
    console.log('✅ Migración aplicada: almacen_id agregado a cards');
  }

  // Migration: asignar cajas/lotes/cards huerfanos al almacen raiz de su evento
  const orphanCajas = await p.query('SELECT c.id, c.event_id FROM cajas c WHERE c.almacen_id IS NULL');
  if (orphanCajas.rows.length > 0) {
    for (const caja of orphanCajas.rows) {
      const rootAlm = await p.query(
        'SELECT id FROM almacenes WHERE event_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1',
        [caja.event_id]
      );
      if (rootAlm.rows.length > 0) {
        const rootId = rootAlm.rows[0].id;
        await p.query('UPDATE cajas SET almacen_id = $1 WHERE id = $2', [rootId, caja.id]);
        await p.query('UPDATE lotes SET almacen_id = $1 WHERE caja_id = $2 AND almacen_id IS NULL', [rootId, caja.id]);
        await p.query(`
          UPDATE cards SET almacen_id = $1
          FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = $2 AND cards.almacen_id IS NULL
        `, [rootId, caja.id]);
      }
    }
    console.log(`✅ Migración aplicada: ${orphanCajas.rows.length} cajas (y sus lotes/cartones) asignadas a su almacen raiz`);
  }

  // Migration: sold_by on cards (quien vendio el carton)
  if (!(await checkColumn('cards', 'sold_by'))) {
    await p.query('ALTER TABLE cards ADD COLUMN sold_by INTEGER REFERENCES users(id)');
    console.log('✅ Migración aplicada: sold_by agregado a cards');
  }

  // Migration: buyer_cedula, buyer_libreta on cards
  if (!(await checkColumn('cards', 'buyer_cedula'))) {
    await p.query('ALTER TABLE cards ADD COLUMN buyer_cedula TEXT');
    console.log('✅ Migración aplicada: buyer_cedula agregado a cards');
  }
  if (!(await checkColumn('cards', 'buyer_libreta'))) {
    await p.query('ALTER TABLE cards ADD COLUMN buyer_libreta TEXT');
    console.log('✅ Migración aplicada: buyer_libreta agregado a cards');
  }

  // Migration: a_cedula, a_libreta on inv_documentos
  if (!(await checkColumn('inv_documentos', 'a_cedula'))) {
    await p.query('ALTER TABLE inv_documentos ADD COLUMN a_cedula TEXT');
    console.log('✅ Migración aplicada: a_cedula agregado a inv_documentos');
  }
  if (!(await checkColumn('inv_documentos', 'a_libreta'))) {
    await p.query('ALTER TABLE inv_documentos ADD COLUMN a_libreta TEXT');
    console.log('✅ Migración aplicada: a_libreta agregado a inv_documentos');
  }

  // Migration: es_agencia_loteria on almacenes
  if (!(await checkColumn('almacenes', 'es_agencia_loteria'))) {
    await p.query('ALTER TABLE almacenes ADD COLUMN es_agencia_loteria BOOLEAN DEFAULT FALSE');
    console.log('✅ Migración aplicada: es_agencia_loteria agregado a almacenes');
  }

  // Migration: promo_fixed_rules table
  const fixedRulesExists = await p.query(`SELECT to_regclass('public.promo_fixed_rules') as exists`);
  if (!fixedRulesExists.rows[0].exists) {
    await p.query(`
      CREATE TABLE IF NOT EXISTS promo_fixed_rules (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        prize_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        series_from INTEGER NOT NULL CHECK(series_from > 0),
        series_to INTEGER NOT NULL CHECK(series_to > 0),
        created_at TIMESTAMP DEFAULT NOW(),
        CHECK(series_to >= series_from),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      )
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_promo_fixed_event ON promo_fixed_rules(event_id)');
    console.log('✅ Migración aplicada: tabla promo_fixed_rules creada');
  }

  // Backfill: lotes/cards que tienen caja con almacen pero ellos no
  // Solo ejecutar si hay cajas con almacen asignado (evita UPDATE masivo innecesario)
  const cajasConAlmacen = await p.query('SELECT COUNT(*) as c FROM cajas WHERE almacen_id IS NOT NULL');
  if (Number(cajasConAlmacen.rows[0].c) > 0) {
    await p.query(`
      UPDATE lotes SET almacen_id = c.almacen_id
      FROM cajas c WHERE c.id = lotes.caja_id AND c.almacen_id IS NOT NULL AND lotes.almacen_id IS NULL
    `);
    await p.query(`
      UPDATE cards SET almacen_id = l.almacen_id
      FROM lotes l WHERE l.id = cards.lote_id AND l.almacen_id IS NOT NULL AND cards.almacen_id IS NULL
    `);
  }

  // Migration: created_by on users (para sub-usuarios de loteria)
  if (!(await checkColumn('users', 'created_by'))) {
    await p.query('ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
    await p.query('CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by)');
    console.log('✅ Migración aplicada: created_by agregado a users');
  }
}
