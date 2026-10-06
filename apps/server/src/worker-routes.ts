import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { RuntimeRegistration } from '../../../packages/contracts/src/runtime.ts';
import { EnrollmentExchange } from '../../../packages/contracts/src/access.ts';
import { AttemptReport, ClaimRequest, PreparationReport, WORK_BODY_LIMIT } from '../../../packages/contracts/src/work.ts';
import { registerRuntime } from './features/runtimes.ts';
import { claimRun, acceptPreparation, acceptAttemptReport } from './features/configured-runs.ts';
import { authenticateRuntime, redeemEnrollment, revokeRuntime, Unauthorized } from './features/access.ts';

export function registerWorkerRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/worker/status', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const latest = await pool.query('SELECT registration, received_at FROM runtime_observations WHERE runtime_id=$1 ORDER BY observation DESC LIMIT 1', [runtimeId]);
    return { runtimeId, observation: latest.rows[0]?.registration.observation ?? 0 };
  });
  app.post('/api/worker/revoke', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    return revokeRuntime(pool, runtimeId, request.headers.authorization);
  });
  app.post('/api/worker/enrollments', async (request) => redeemEnrollment(pool, EnrollmentExchange.parse(request.body)));
  app.post('/api/worker/registrations', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = RuntimeRegistration.parse(request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return registerRuntime(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/claims', async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = ClaimRequest.parse(request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return claimRun(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/preparations', { bodyLimit: WORK_BODY_LIMIT }, async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = PreparationReport.parse(request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return acceptPreparation(pool, input, request.headers.authorization);
  });
  app.post('/api/worker/attempts', { bodyLimit: WORK_BODY_LIMIT }, async (request) => {
    const runtimeId = await authenticateRuntime(pool, request.headers.authorization);
    const input = AttemptReport.parse(request.body);
    if (input.runtimeId !== runtimeId) throw new Unauthorized();
    return acceptAttemptReport(pool, input, request.headers.authorization);
  });
}
