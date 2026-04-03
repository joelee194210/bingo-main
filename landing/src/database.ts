import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';

let pool: pg.Pool;

export async function initPool(): Promise<void> {
  pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  await pool.query('SELECT 1');
}

export function getPool(): pg.Pool {
  return pool;
}
