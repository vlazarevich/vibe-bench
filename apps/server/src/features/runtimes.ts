import type pg from 'pg';
import { RuntimeRegistration, RuntimeReceipt, RegisteredRuntimes } from '../../../../packages/contracts/src/runtime.ts';
import { Conflict } from '../errors.ts';

export async function registerRuntime(pool: pg.Pool, registration: RuntimeRegistration) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO runtime_observations(runtime_id, observation, registration) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [registration.runtimeId, registration.observation, registration]);
    const result = await client.query('SELECT received_at, registration = $3::jsonb AS identical FROM runtime_observations WHERE runtime_id = $1 AND observation = $2', [registration.runtimeId, registration.observation, registration]);
    if (!result.rows[0]?.identical) throw new Conflict('Runtime observation conflicts with the stored observation');
    const receipt = RuntimeReceipt.parse({ runtimeId: registration.runtimeId, observation: registration.observation, observedAt: registration.observedAt, receivedAt: result.rows[0].received_at.toISOString() });
    await client.query('COMMIT');
    return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function listRuntimes(pool: pg.Pool) {
  const result = await pool.query('SELECT DISTINCT ON (runtime_id) registration, received_at FROM runtime_observations ORDER BY runtime_id, observation DESC');
  return RegisteredRuntimes.parse(result.rows.map((row) => ({ registration: row.registration, receivedAt: row.received_at.toISOString() })));
}
