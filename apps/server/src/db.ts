import { readFile } from 'node:fs/promises';
import pg from 'pg';

declare const __VIBE_BUNDLED__: boolean | undefined;
const migrations = new URL(
  typeof __VIBE_BUNDLED__ === 'boolean' && __VIBE_BUNDLED__ ? './migrations/' : '../../../db/migrations/',
  import.meta.url,
);

export async function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  // Idle clients can be terminated by a restart or a hosted provider's idle timeout; the pool discards them.
  pool.on('error', (error) => {
    process.stderr.write(`PostgreSQL idle connection closed: ${error.message}\n`);
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(260026)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
      for (const name of [
        '001-text-comparison.sql',
        '002-suites.sql',
        '003-runtimes.sql',
        '004-configured-runs.sql',
        '005-blind-grading.sql',
        '006-access.sql',
        '007-runner-pairing.sql',
        '008-remove-legacy-demo.sql',
        '009-dashboard-design.sql',
        '010-artifact-chunks.sql',
      ]) {
        if ((await client.query('SELECT name FROM schema_migrations WHERE name = $1', [name])).rowCount) continue;
        await client.query(await readFile(new URL(name, migrations), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
