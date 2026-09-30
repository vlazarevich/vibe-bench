import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { Report } from '../../../../packages/contracts/src/runner.ts';

export class Conflict extends Error {}

export async function acceptReport(pool: pg.Pool, report: Report) {
  const digest = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const inserted = await pool.query('INSERT INTO runs(id, report_id, digest, report, review_id) VALUES($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id', [report.runId, report.reportId, digest, report, randomUUID()]);
  if (inserted.rowCount === 0) {
    const existing = await pool.query('SELECT digest FROM runs WHERE report_id = $1 AND id = $2', [report.reportId, report.runId]);
    const stored = z.array(z.object({ digest: z.string() })).parse(existing.rows);
    if (stored[0]?.digest !== digest) throw new Conflict('Report identity already has different content');
  }
  return { reportId: report.reportId, runId: report.runId, accepted: true };
}

export async function listRuns(pool: pg.Pool) {
  const result = await pool.query('SELECT review_id, report FROM runs ORDER BY accepted_at DESC LIMIT 100');
  return z.array(z.object({ review_id: z.uuid(), report: Report })).parse(result.rows).map(({ review_id, report }) => ({
    id: review_id, title: report.task.title, createdAt: report.createdAt, source: report.source,
    status: report.entrants.every((e) => e.outcome.kind === 'succeeded') ? 'ready' : 'failed',
  }));
}
