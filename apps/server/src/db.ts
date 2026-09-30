import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  await pool.query(await readFile(new URL('../../../db/migrations/001-text-comparison.sql', import.meta.url), 'utf8'));
  return pool;
}
