import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(260026)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
      for (const name of ['001-text-comparison.sql', '002-suites.sql', '003-runtimes.sql', '004-configured-runs.sql', '005-blind-grading.sql']) {
        if ((await client.query('SELECT name FROM schema_migrations WHERE name = $1', [name])).rowCount) continue;
        await client.query(await readFile(new URL(`../../../db/migrations/${name}`, import.meta.url), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
