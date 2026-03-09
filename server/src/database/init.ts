import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// @ts-expect-error import.meta works at runtime with tsx/ESM
const __dirname = dirname((import.meta as { url: string }).url.replace('file://', ''));

const DB_PATH = join(__dirname, '../../data/bingo.db');

let dbInstance: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  // Crear directorio data si no existe
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Habilitar WAL mode para mejor rendimiento con escrituras concurrentes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  db.pragma('mmap_size = 268435456'); // 256MB mmap

  // Ejecutar schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Migraciones para bases de datos existentes
  runMigrations(db);

  // Crear índices que dependen de columnas migradas
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial)");

  console.log('✅ Base de datos inicializada correctamente');
  console.log(`📍 Ubicación: ${DB_PATH}`);

  dbInstance = db;
  return db;
}

export function getDatabase(): Database.Database {
  // Crear directorio si no existe
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Ejecuta migraciones para bases de datos existentes
 */
function runMigrations(db: Database.Database): void {
  // Migración: agregar columna use_free_center si no existe
  const columns = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  const hasUseFreeCenter = columns.some(col => col.name === 'use_free_center');

  if (!hasUseFreeCenter) {
    db.exec('ALTER TABLE events ADD COLUMN use_free_center INTEGER DEFAULT 1');
    console.log('✅ Migración aplicada: use_free_center agregado a events');
  }

  // Migración: agregar columna serial si no existe
  const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  const hasSerial = cardColumns.some(col => col.name === 'serial');

  if (!hasSerial) {
    db.exec("ALTER TABLE cards ADD COLUMN serial TEXT NOT NULL DEFAULT ''");
    // Computar seriales para cartones existentes
    const allCards = db.prepare("SELECT id, card_number FROM cards ORDER BY event_id, card_number").all() as Array<{ id: number; card_number: number }>;
    const updateStmt = db.prepare("UPDATE cards SET serial = ? WHERE id = ?");
    const updateMany = db.transaction((cards: Array<{ id: number; card_number: number }>) => {
      for (const card of cards) {
        const series = Math.ceil(card.card_number / 50).toString().padStart(5, '0');
        const seq = (((card.card_number - 1) % 50) + 1).toString().padStart(2, '0');
        updateStmt.run(`${series}-${seq}`, card.id);
      }
    });
    updateMany(allCards);
    db.exec("CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial)");
    console.log('✅ Migración aplicada: serial agregado a cards');
  }
}
