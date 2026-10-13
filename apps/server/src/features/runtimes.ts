import type pg from 'pg';
import {
  RuntimeId,
  RuntimeRegistration,
  RuntimeReceipt,
  RegisteredRuntimes,
} from '../../../../packages/contracts/src/runtime.ts';
import { authorizeRuntime, lockRuntime, revokeRuntimeInTransaction } from './access.ts';
import { Conflict } from '../errors.ts';

export async function registerRuntime(pool: pg.Pool, registration: RuntimeRegistration, authorization?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockRuntime(client, registration.runtimeId);
    if (authorization !== undefined) await authorizeRuntime(client, registration.runtimeId, authorization);
    await client.query(
      `INSERT INTO runtime_observations(runtime_id, observation, registration) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [registration.runtimeId, registration.observation, registration],
    );
    const result = await client.query(
      'SELECT received_at, registration = $3::jsonb AS identical FROM runtime_observations WHERE runtime_id = $1 AND observation = $2',
      [registration.runtimeId, registration.observation, registration],
    );
    if (!result.rows[0]?.identical) throw new Conflict('Runtime observation conflicts with the stored observation');
    const receipt = RuntimeReceipt.parse({
      runtimeId: registration.runtimeId,
      observation: registration.observation,
      observedAt: registration.observedAt,
      receivedAt: result.rows[0].received_at.toISOString(),
    });
    await client.query(
      'INSERT INTO runtime_presence(runtime_id) VALUES($1) ON CONFLICT(runtime_id) DO UPDATE SET last_seen=clock_timestamp()',
      [registration.runtimeId],
    );
    await client.query('DELETE FROM runtime_deletions WHERE runtime_id=$1', [registration.runtimeId]);
    await client.query('COMMIT');
    return receipt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listRuntimes(pool: pg.Pool) {
  const result = await pool.query(
    'SELECT DISTINCT ON (runtime_id) registration, received_at FROM runtime_observations ORDER BY runtime_id, observation DESC',
  );
  return RegisteredRuntimes.parse(
    result.rows.map((row) => ({ registration: row.registration, receivedAt: row.received_at.toISOString() })),
  );
}

export async function touchRuntime(pool: pg.Pool, runtimeId: string) {
  await pool.query(
    'INSERT INTO runtime_presence(runtime_id) VALUES($1) ON CONFLICT(runtime_id) DO UPDATE SET last_seen=clock_timestamp()',
    [runtimeId],
  );
}
export async function dashboardRuntimes(pool: pg.Pool) {
  const { DashboardRuntimes } = await import('../../../../packages/contracts/src/dashboard.ts');
  const rows = await pool.query(`SELECT i.runtime_id,obs.registration,p.last_seen,
    EXISTS(SELECT 1 FROM runtime_credentials c WHERE c.runtime_id=i.runtime_id AND c.revoked_at IS NULL) AS connected,
    work.id AS run_id,work.number AS run_number,work.snapshot
    FROM (SELECT runtime_id FROM runtime_credentials UNION SELECT runtime_id FROM runtime_observations) i
    LEFT JOIN LATERAL(SELECT registration FROM runtime_observations o WHERE o.runtime_id=i.runtime_id ORDER BY observation DESC LIMIT 1) obs ON true
    LEFT JOIN runtime_presence p ON p.runtime_id=i.runtime_id
    LEFT JOIN LATERAL(SELECT r.id,r.number,r.snapshot FROM configured_runs r JOIN work_claims c ON c.run_id=r.id WHERE r.runtime_id=i.runtime_id AND NOT EXISTS(SELECT 1 FROM run_abandonments b WHERE b.run_id=r.id) AND EXISTS(SELECT 1 FROM configured_attempts a LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id WHERE a.run_id=r.id AND o.attempt_id IS NULL) ORDER BY r.created_at LIMIT 1) work ON true
    WHERE NOT EXISTS(SELECT 1 FROM runtime_deletions d WHERE d.runtime_id=i.runtime_id) ORDER BY p.last_seen DESC NULLS LAST,i.runtime_id`);
  const values = [];
  for (const row of rows.rows) {
    const registration = row.registration ? RuntimeRegistration.parse(row.registration) : null;
    const online = row.connected && row.last_seen && Date.now() - row.last_seen.getTime() < 30_000;
    let run = null;
    if (row.run_id) {
      const progress = await pool.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE done)::int AS done FROM (SELECT a.task_id,bool_and(o.attempt_id IS NOT NULL) AS done FROM configured_attempts a LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id WHERE a.run_id=$1 GROUP BY a.task_id) t`,
        [row.run_id],
      );
      run = { id: row.run_id, number: Number(row.run_number), ...progress.rows[0] };
    }
    values.push({
      id: row.runtime_id,
      name: registration?.machine.hostname ?? row.runtime_id.slice(0, 8),
      os: registration?.machine.os ?? 'Linux',
      connected: row.connected,
      state: online ? (run ? 'working' : 'ready') : 'offline',
      lastSeen: row.last_seen?.toISOString() ?? null,
      registration,
      run,
    });
  }
  return DashboardRuntimes.parse(values);
}
export async function deleteRuntime(pool: pg.Pool, runtimeId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockRuntime(client, RuntimeId.parse(runtimeId));
    await revokeRuntimeInTransaction(client, RuntimeId.parse(runtimeId));
    await client.query('INSERT INTO runtime_deletions(runtime_id) VALUES($1) ON CONFLICT DO NOTHING', [runtimeId]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
