import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CredentialId, CreateEnrollment, EnrollmentCommand, EnrollmentExchange, EnrollmentReceipt, RuntimeAccess } from '../../../../packages/contracts/src/access.ts';
import { RuntimeId } from '../../../../packages/contracts/src/runtime.ts';
import { Conflict, NotFound } from '../errors.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Unauthorized extends Error {}
export class Throttled extends Error {}

export async function initializeAccess(pool: pg.Pool, password: string | undefined) {
  const installation = await pool.query('SELECT password_salt FROM installation_access');
  const generation = scryptSync(password ? `protected:${password}` : 'passwordless', installation.rows[0].password_salt, 32).toString('hex');
  await pool.query('UPDATE installation_access SET password_generation=$1 WHERE password_generation<>$1', [generation]);
  await pool.query('DELETE FROM dashboard_sessions WHERE generation<>$1 OR expires_at<=now()', [generation]);
  const salt = randomBytes(32);
  const expected = scryptSync(password ?? '', salt, 32);
  return {
    passwordRequired: Boolean(password),
    async authenticated(token: string | undefined) {
      if (!password) return true;
      if (!token) return false;
      const result = await pool.query('SELECT 1 FROM dashboard_sessions s JOIN installation_access i ON s.generation=i.password_generation WHERE token_hash=$1 AND expires_at>now() AND s.generation=$2', [hash(token), generation]);
      return result.rowCount === 1;
    },
    async login(value: string, source: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(260049)');
        await client.query("DELETE FROM login_attempts WHERE window_start<now()-interval '15 minutes'");
        for (const [key, limit] of [[hash('global'), 100], [hash(source), 10]] as const) {
          const result = await client.query("INSERT INTO login_attempts(source_hash, window_start, attempts) VALUES($1,now(),1) ON CONFLICT(source_hash) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts", [key]);
          if (result.rows[0].attempts > limit) { await client.query('COMMIT'); throw new Throttled(); }
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      if (!timingSafeEqual(scryptSync(value, salt, 32), expected)) throw new Unauthorized();
      const token = randomBytes(32).toString('hex');
      await pool.query("INSERT INTO dashboard_sessions(token_hash,generation,expires_at) SELECT $1,$2,now()+interval '12 hours' FROM installation_access WHERE password_generation=$2", [hash(token), generation]);
      return token;
    },
    async logout(token: string | undefined) { if (token) await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1', [hash(token)]); },
  };
}

export async function createEnrollment(pool: pg.Pool, input: z.infer<typeof CreateEnrollment>, apiUrl: string) {
  const key = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const target = input.target.kind === 'replace' ? input.target.runtimeId : null;
  if (target && !(await pool.query('SELECT 1 FROM runtime_credentials WHERE runtime_id=$1 UNION ALL SELECT 1 FROM runtime_observations WHERE runtime_id=$1 LIMIT 1', [target])).rowCount) throw new NotFound();
  const command = EnrollmentCommand.parse({ apiUrl, key, expiresAt });
  await pool.query('INSERT INTO runtime_enrollments(key_hash,expires_at,target_runtime_id) VALUES($1,$2,$3)', [hash(key), expiresAt, target]);
  return { command: `vibe-runner pair ${Buffer.from(JSON.stringify(command)).toString('base64url')}`, expiresAt };
}

export async function redeemEnrollment(pool: pg.Pool, input: EnrollmentExchange) {
  const digest = hash(JSON.stringify(input));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT *, expires_at>now() AS valid FROM runtime_enrollments WHERE key_hash=$1 FOR UPDATE', [hash(input.key)]);
    const row = result.rows[0];
    if (!row) throw new Unauthorized();
    if (!row.valid) throw new Unauthorized();
    const prior = await client.query('SELECT * FROM enrollment_exchanges WHERE request_id=$1 AND key_hash=$2', [input.requestId, hash(input.key)]);
    if (prior.rowCount) {
      if (prior.rows[0].exchange_hash !== digest || prior.rows[0].key_hash !== hash(input.key)) throw new Unauthorized();
      await client.query('COMMIT');
      return EnrollmentReceipt.parse(prior.rows[0].receipt);
    }
    const runtimeId = RuntimeId.parse(row.target_runtime_id ?? randomUUID());
    await lockRuntime(client, runtimeId);
    await revokeRuntimeInTransaction(client, runtimeId);
    const inserted = await client.query('INSERT INTO runtime_credentials(credential_id,runtime_id,secret_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [input.credentialId, runtimeId, hash(input.secret)]);
    if (!inserted.rowCount) throw new Conflict('Credential identity already exists');
    const installation = await client.query('SELECT installation_id FROM installation_access');
    const receipt = EnrollmentReceipt.parse({ installationId: installation.rows[0].installation_id, runtimeId, credentialId: input.credentialId, requestId: input.requestId });
    await client.query('UPDATE runtime_enrollments SET target_runtime_id=$2 WHERE key_hash=$1', [hash(input.key), runtimeId]);
    await client.query('INSERT INTO enrollment_exchanges(request_id,key_hash,exchange_hash,receipt) VALUES($1,$2,$3,$4)', [input.requestId, hash(input.key), digest, receipt]);
    await client.query('COMMIT');
    return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function authenticateRuntime(pool: pg.Pool | pg.PoolClient, authorization: string | undefined) {
  const match = /^Bearer ([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(authorization ?? '');
  if (!match || !CredentialId.safeParse(match[1]).success) throw new Unauthorized();
  const result = await pool.query('SELECT runtime_id FROM runtime_credentials WHERE credential_id=$1 AND secret_hash=$2 AND revoked_at IS NULL', [match[1], hash(match[2] ?? '')]);
  if (!result.rowCount) throw new Unauthorized();
  return RuntimeId.parse(result.rows[0].runtime_id);
}
export async function lockRuntime(client: pg.PoolClient, runtimeId: z.infer<typeof RuntimeId>) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3))', [runtimeId]);
}
export async function authorizeRuntime(client: pg.PoolClient, runtimeId: z.infer<typeof RuntimeId>, authorization: string | undefined) {
  await lockRuntime(client, runtimeId);
  if (await authenticateRuntime(client, authorization) !== runtimeId) throw new Unauthorized();
}
async function revokeRuntimeInTransaction(client: pg.PoolClient, runtimeId: z.infer<typeof RuntimeId>) {
  await client.query('UPDATE runtime_credentials SET revoked_at=now() WHERE runtime_id=$1 AND revoked_at IS NULL', [runtimeId]);
  await client.query(`INSERT INTO run_abandonments(run_id)
    SELECT c.run_id FROM work_claims c WHERE c.runtime_id=$1 AND c.run_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM configured_attempts a LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id WHERE a.run_id=c.run_id AND o.attempt_id IS NULL)
    ON CONFLICT DO NOTHING`, [runtimeId]);
}
export async function revokeRuntime(pool: pg.Pool, runtimeId: z.infer<typeof RuntimeId>, authorization?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockRuntime(client, runtimeId);
    if (authorization !== undefined) await authorizeRuntime(client, runtimeId, authorization);
    await revokeRuntimeInTransaction(client, runtimeId);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function runtimeAccess(pool: pg.Pool) {
  const result = await pool.query(`SELECT identities.runtime_id, coalesce(bool_or(c.revoked_at IS NULL) FILTER (WHERE c.credential_id IS NOT NULL), false) AS active FROM (SELECT runtime_id FROM runtime_credentials UNION SELECT runtime_id FROM runtime_observations) identities LEFT JOIN runtime_credentials c USING(runtime_id) GROUP BY identities.runtime_id`);
  return RuntimeAccess.parse(result.rows.map((row) => ({ runtimeId: row.runtime_id, active: row.active })));
}
