import { z } from 'zod';
import { ConfiguredRunId } from '../../../packages/contracts/src/configured-runs.ts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { RuntimeRegistration } from '../../../packages/contracts/src/runtime.ts';
import { EnrollmentExchange } from '../../../packages/contracts/src/access.ts';
import {
  ArtifactChunk,
  AttemptReport,
  ClaimRequest,
  PreparationReport,
  WORK_BODY_LIMIT,
  WORK_PROTOCOL,
} from '../../../packages/contracts/src/work.ts';
import { registerRuntime, touchRuntime } from './features/runtimes.ts';
import { claimRun, acceptPreparation, acceptAttemptReport, acceptArtifactChunk } from './features/configured-runs.ts';
import { authenticateRuntime, redeemEnrollment, revokeRuntime, Unauthorized } from './features/access.ts';
import { UnsupportedProtocol } from './errors.ts';

/** Work bodies name their protocol; an older runner gets an explicit upgrade error instead of a schema failure. */
function work<T>(schema: z.ZodType<T>, body: unknown): T {
  const declared = z.object({ protocol: z.number() }).safeParse(body);
  if (declared.success && declared.data.protocol !== WORK_PROTOCOL) throw new UnsupportedProtocol();
  return schema.parse(body);
}

export function registerWorkerRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.post('/api/worker/heartbeat', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const { runId } = z.object({ runId: ConfiguredRunId.optional() }).strict().parse(request.body);
    await touchRuntime(pool, runtimeId);
    const cancelled = runId
      ? !!(
          await pool.query(
            'SELECT 1 FROM run_abandonments b JOIN configured_runs r ON r.id=b.run_id WHERE r.id=$1 AND r.runtime_id=$2',
            [runId, runtimeId],
          )
        ).rowCount
      : false;
    return { cancelled };
  });
  app.get('/api/worker/status', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const latest = await pool.query(
      'SELECT registration, received_at FROM runtime_observations WHERE runtime_id=$1 ORDER BY observation DESC LIMIT 1',
      [runtimeId],
    );
    return { runtimeId, observation: latest.rows[0]?.registration.observation ?? 0 };
  });
  app.post('/api/worker/revoke', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    return revokeRuntime(pool, runtimeId, request.headers.authorization);
  });
  app.post('/api/worker/enrollments', async (request) =>
    redeemEnrollment(pool, EnrollmentExchange.parse(request.body)),
  );
  app.post('/api/worker/registrations', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = RuntimeRegistration.parse(request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return registerRuntime(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/claims', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    await touchRuntime(pool, runtimeId);
    const input = work(ClaimRequest, request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return claimRun(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/preparations', { bodyLimit: WORK_BODY_LIMIT }, async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = work(PreparationReport, request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return acceptPreparation(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/attempts', { bodyLimit: WORK_BODY_LIMIT }, async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = work(AttemptReport, request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return acceptAttemptReport(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/artifact-chunks', { bodyLimit: WORK_BODY_LIMIT }, async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = work(ArtifactChunk, request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return acceptArtifactChunk(pool, input, request.headers.authorization);
  });
}
