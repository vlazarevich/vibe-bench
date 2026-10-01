import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { assessDefinition, SuiteContent, TaskId } from '../../../../packages/contracts/src/suites.ts';
import { contentDigest } from '../../../../packages/contracts/src/canonical.ts';
import { ArtifactMetadata, AttemptSlot, AttemptView, ConfigureRun, ConfiguredRunId, ConfiguredRunList, ConfiguredRunView, CreateConfiguredRun, ExecutionSnapshot, Preparation, RunPreview } from '../../../../packages/contracts/src/configured-runs.ts';
import { AttemptReport, ClaimReceipt, ClaimRequest, MAX_ARTIFACT_BYTES, PreparationReport, WorkReceipt } from '../../../../packages/contracts/src/work.ts';
import { Conflict, NotFound } from '../errors.ts';

type Database = pg.Pool | pg.PoolClient;
export async function previewRun(database: Database, input: ConfigureRun): Promise<RunPreview> {
  const stored = await database.query('SELECT * FROM suite_contents WHERE id = $1', [input.contentId]);
  if (!stored.rowCount) throw new NotFound();
  if (!(await database.query('SELECT 1 FROM runtime_observations WHERE runtime_id = $1 LIMIT 1', [input.runtimeId])).rowCount) throw new Conflict('Select a registered runtime');
  const row = stored.rows[0];
  const content = SuiteContent.parse({ schemaVersion: row.schema_version, suiteId: row.suite_id, contentId: row.id, revision: row.revision, ordinal: row.ordinal, createdAt: row.created_at.toISOString(), digest: row.digest, definition: row.definition });
  if (assessDefinition(content.definition).kind !== 'ready') throw new Conflict('Suite content must be ready before execution');
  const tasks = content.definition.categories.flatMap((category) => category.tasks);
  const selection = input.selection;
  if (selection.kind === 'subset' && (selection.taskIds.some((id) => !tasks.some((task) => task.id === id)) || selection.categoryIds.some((id) => !content.definition.categories.some((category) => category.id === id)))) throw new Conflict('Selected task or category is not in this suite content');
  const selected = new Set(selection.kind === 'all' ? tasks.map((task) => task.id) : [...selection.taskIds, ...content.definition.categories.filter((category) => selection.categoryIds.includes(category.id)).flatMap((category) => category.tasks.map((task) => task.id))]);
  const selectedTasks = tasks.filter((task) => selected.has(task.id));
  if (!selectedTasks.length || selectedTasks.length * input.entrants.length > 1000) throw new Conflict('Select between 1 and 1000 task and entrant combinations');
  const snapshot = { protocol: 1, content, runtimeId: input.runtimeId, selectedTaskIds: selectedTasks.map((task) => task.id), entrants: input.entrants, source: input.source };
  return RunPreview.parse({ snapshot: { ...snapshot, digest: contentDigest(snapshot) }, matrix: selectedTasks.flatMap((task) => input.entrants.map((entrant) => ({ taskId: task.id, taskTitle: task.title, kind: task.kind, entrantId: entrant.id }))) });
}

const RunRow = z.object({ id: ConfiguredRunId, snapshot: ExecutionSnapshot, created_at: z.date() });
async function runView(database: Database, runId: string, initial = false): Promise<ConfiguredRunView> {
  const result = await database.query('SELECT * FROM configured_runs WHERE id = $1', [runId]);
  if (!result.rowCount) throw new NotFound();
  const run = RunRow.parse(result.rows[0]);
  const rows = await database.query(`SELECT a.id AS "attemptId", a.task_id AS "taskId", a.entrant_id AS "entrantId", a.ordinal, s.started_at, o.outcome, c.assignment_id
    FROM configured_attempts a LEFT JOIN attempt_starts s ON s.attempt_id = a.id LEFT JOIN attempt_outcomes o ON o.attempt_id = a.id LEFT JOIN work_claims c ON c.run_id = a.run_id WHERE a.run_id = $1 ORDER BY a.ordinal`, [runId]);
  const attempts = rows.rows.map((row) => AttemptView.parse({ ...AttemptSlot.parse({ attemptId: row.attemptId, taskId: row.taskId, entrantId: row.entrantId, ordinal: row.ordinal }), state: initial ? { kind: 'queued' } : row.outcome ? { kind: 'terminal', outcome: row.outcome } : row.started_at ? { kind: 'started', startedAt: row.started_at.toISOString() } : row.assignment_id ? { kind: 'assigned' } : { kind: 'queued' } }));
  const preparation = initial ? null : (await database.query('SELECT preparation FROM run_preparations WHERE run_id = $1', [runId])).rows[0]?.preparation ?? null;
  return ConfiguredRunView.parse({ runId, createdAt: run.created_at.toISOString(), snapshot: run.snapshot, preparation, attempts, status: attempts.every((attempt) => attempt.state.kind === 'terminal') ? 'finished' : attempts.some((attempt) => attempt.state.kind !== 'queued') ? 'running' : 'queued' });
}
export async function readConfiguredRun(pool: pg.Pool, runId: string) { return runView(pool, runId); }
export async function listConfiguredRuns(pool: pg.Pool) {
  const rows = await pool.query(`SELECT r.id AS "runId", r.snapshot->'content'->'definition'->>'title' AS title, r.created_at, r.snapshot->>'source' AS source,
    count(a.id)::integer AS attempts, count(o.attempt_id)::integer AS terminal, bool_or(c.assignment_id IS NOT NULL) AS assigned
    FROM configured_runs r JOIN configured_attempts a ON a.run_id = r.id LEFT JOIN attempt_outcomes o ON o.attempt_id = a.id LEFT JOIN work_claims c ON c.run_id = r.id
    GROUP BY r.id ORDER BY r.created_at DESC, r.id`);
  return ConfiguredRunList.parse(rows.rows.map((row) => ({ runId: row.runId, title: row.title, createdAt: row.created_at.toISOString(), source: row.source, attempts: row.attempts, terminal: row.terminal, status: row.attempts === row.terminal ? 'finished' : row.assigned ? 'running' : 'queued' })));
}
export async function createConfiguredRun(pool: pg.Pool, input: CreateConfiguredRun) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [input.requestId]);
    const prior = await client.query('SELECT id, request = $2::jsonb AS identical FROM configured_runs WHERE request_id = $1', [input.requestId, input]);
    if (prior.rowCount) {
      if (!prior.rows[0].identical) throw new Conflict('Create request ID was already used for different inputs');
      const view = await runView(client, prior.rows[0].id, true); await client.query('COMMIT'); return view;
    }
    const preview = await previewRun(client, input);
    const runId = randomUUID();
    await client.query('INSERT INTO configured_runs(id, request_id, request, runtime_id, snapshot) VALUES($1,$2,$3,$4,$5)', [runId, input.requestId, input, input.runtimeId, preview.snapshot]);
    for (const [ordinal, cell] of preview.matrix.entries()) await client.query('INSERT INTO configured_attempts(id, run_id, task_id, entrant_id, ordinal) VALUES($1,$2,$3,$4,$5)', [randomUUID(), runId, cell.taskId, cell.entrantId, ordinal]);
    const view = await runView(client, runId); await client.query('COMMIT'); return view;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function claimRun(pool: pg.Pool, input: ClaimRequest): Promise<ClaimReceipt> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 2))', [input.requestId]);
    const existing = await client.query('SELECT receipt, request = $2::jsonb AS identical FROM work_claims WHERE request_id = $1', [input.requestId, input]);
    if (existing.rowCount) {
      if (!existing.rows[0].identical) throw new Conflict('Claim ID was already used for different inputs');
      await client.query('COMMIT'); return ClaimReceipt.parse(existing.rows[0].receipt);
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3))', [input.runtimeId]);
    if (!(await client.query('SELECT 1 FROM runtime_observations WHERE runtime_id = $1 LIMIT 1', [input.runtimeId])).rowCount) throw new Conflict('Runtime must register before claiming work');
    const active = await client.query(`SELECT 1 FROM work_claims c JOIN configured_attempts a ON a.run_id = c.run_id LEFT JOIN attempt_outcomes o ON o.attempt_id = a.id WHERE c.runtime_id = $1 AND o.attempt_id IS NULL LIMIT 1`, [input.runtimeId]);
    const pending = active.rowCount ? null : (await client.query('SELECT r.id FROM configured_runs r LEFT JOIN work_claims c ON c.run_id = r.id WHERE r.runtime_id = $1 AND c.run_id IS NULL ORDER BY r.created_at, r.id LIMIT 1', [input.runtimeId])).rows[0];
    let receipt: ClaimReceipt = { kind: 'idle', requestId: input.requestId };
    if (pending) {
      const view = await runView(client, pending.id);
      receipt = ClaimReceipt.parse({ kind: 'assigned', requestId: input.requestId, assignmentId: randomUUID(), runId: pending.id, snapshot: view.snapshot, attempts: view.attempts.map((attempt) => ({ attemptId: attempt.attemptId, taskId: attempt.taskId, entrantId: attempt.entrantId, ordinal: attempt.ordinal })) });
    }
    await client.query('INSERT INTO work_claims(request_id, runtime_id, assignment_id, run_id, request, receipt) VALUES($1,$2,$3,$4,$5,$6)', [input.requestId, input.runtimeId, receipt.kind === 'assigned' ? receipt.assignmentId : null, receipt.kind === 'assigned' ? receipt.runId : null, input, receipt]);
    await client.query('COMMIT'); return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function acceptWorkReport(pool: pg.Pool, report: PreparationReport | AttemptReport, apply: (client: pg.PoolClient, snapshot: ExecutionSnapshot) => Promise<void>): Promise<WorkReceipt> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 4))', [report.reportId]);
    const digest = contentDigest(report);
    const previous = await client.query('SELECT * FROM work_reports WHERE report_id = $1', [report.reportId]);
    if (previous.rowCount) {
      if (previous.rows[0].request_digest !== digest) throw new Conflict('Report ID was already used for different content');
      await client.query('COMMIT'); return WorkReceipt.parse(previous.rows[0].receipt);
    }
    const assignment = await client.query('SELECT 1 FROM work_claims WHERE assignment_id = $1 AND runtime_id = $2 AND run_id = $3', [report.assignmentId, report.runtimeId, report.runId]);
    if (!assignment.rowCount) throw new Conflict('Report does not belong to this runtime assignment');
    const run = await client.query('SELECT snapshot FROM configured_runs WHERE id = $1 FOR UPDATE', [report.runId]);
    await apply(client, ExecutionSnapshot.parse(run.rows[0].snapshot));
    const receipt = WorkReceipt.parse({ reportId: report.reportId, runId: report.runId, acceptedAt: new Date().toISOString() });
    await client.query('INSERT INTO work_reports(report_id, request_digest, receipt) VALUES($1,$2,$3)', [report.reportId, digest, receipt]);
    await client.query('COMMIT'); return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function acceptPreparation(pool: pg.Pool, report: PreparationReport) {
  return acceptWorkReport(pool, report, async (client, snapshot) => {
    const prior = await client.query('SELECT preparation FROM run_preparations WHERE run_id = $1', [report.runId]);
    if (prior.rowCount) throw new Conflict('Preparation has already been recorded');
    if (report.preparation.kind !== 'failed' && report.preparation.kind !== snapshot.content.definition.materials.kind) throw new Conflict('Preparation does not match the pinned materials');
    if (report.preparation.kind === 'repository') {
      if (contentDigest(report.preparation.manifest) !== report.preparation.manifestDigest) throw new Conflict('Repository manifest digest does not match');
      const taskIds = new Set<string>(snapshot.content.definition.categories.flatMap((category) => category.tasks.map((task) => task.id)));
      if (Object.keys(report.preparation.manifest.tasks).some((id) => !taskIds.has(id))) throw new Conflict('Manifest refers to a task outside the pinned suite');
    }
    await client.query('INSERT INTO run_preparations(run_id, preparation) VALUES($1,$2)', [report.runId, report.preparation]);
  });
}
export async function acceptAttemptReport(pool: pg.Pool, report: AttemptReport) {
  return acceptWorkReport(pool, report, async (client, snapshot) => {
    const slot = await client.query('SELECT task_id FROM configured_attempts WHERE id = $1 AND run_id = $2', [report.attemptId, report.runId]);
    if (!slot.rowCount) throw new Conflict('Attempt does not belong to this run');
    if ((await client.query('SELECT 1 FROM attempt_outcomes WHERE attempt_id = $1', [report.attemptId])).rowCount) throw new Conflict('Attempt already has a terminal outcome');
    const preparationRow = await client.query('SELECT preparation FROM run_preparations WHERE run_id = $1', [report.runId]);
    if (!preparationRow.rowCount) throw new Conflict('Preparation must be recorded before attempts');
    const preparation = Preparation.parse(preparationRow.rows[0].preparation);
    const started = (await client.query('SELECT 1 FROM attempt_starts WHERE attempt_id = $1', [report.attemptId])).rowCount;
    if (report.kind === 'started') {
      if (started) throw new Conflict('Attempt was already started');
      if (preparation.kind === 'failed') throw new Conflict('Cannot start after preparation failed');
      const active = await client.query('SELECT 1 FROM configured_attempts a JOIN attempt_starts s ON s.attempt_id = a.id LEFT JOIN attempt_outcomes o ON o.attempt_id = a.id WHERE a.run_id = $1 AND o.attempt_id IS NULL LIMIT 1', [report.runId]);
      if (active.rowCount) throw new Conflict('Runtime executes one attempt at a time');
      await client.query('INSERT INTO attempt_starts(attempt_id, started_at) VALUES($1,$2)', [report.attemptId, report.startedAt]);
      return;
    }
    if (report.outcome.kind === 'completed' && !started) throw new Conflict('Completed attempts must have started');
    if (report.outcome.kind === 'skipped' && started) throw new Conflict('Started attempts must fail rather than skip');
    if (preparation.kind === 'failed' && report.outcome.kind === 'completed') throw new Conflict('Cannot complete after preparation failed');
    validateArtifacts(report, snapshot, slot.rows[0].task_id, preparation);
    for (const artifact of report.artifacts) {
      const inserted = await client.query('INSERT INTO configured_artifacts(id, attempt_id, metadata, bytes) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [artifact.id, report.attemptId, artifactMetadata(artifact), Buffer.from(artifact.base64, 'base64')]);
      if (!inserted.rowCount) throw new Conflict('Artifact ID was already used');
    }
    await client.query('INSERT INTO attempt_outcomes(attempt_id, outcome, observed) VALUES($1,$2,$3)', [report.attemptId, report.outcome, report.observed]);
  });
}

function artifactMetadata(artifact: z.infer<typeof ArtifactMetadata> & { base64: string }) { const { base64: _base64, ...metadata } = artifact; return ArtifactMetadata.parse(metadata); }

function validateArtifacts(report: Extract<AttemptReport, { kind: 'terminal' }>, snapshot: ExecutionSnapshot, taskId: string, preparation: Preparation) {
  const artifacts = new Map(report.artifacts.map((artifact) => [artifact.id, artifact]));
  if (new Set(report.artifacts.map((artifact) => artifact.name)).size !== report.artifacts.length) throw new Conflict('Artifact paths must be unique');
  if (artifacts.size !== report.artifacts.length || report.artifacts.reduce((total, artifact) => total + artifact.bytes, 0) > MAX_ARTIFACT_BYTES) throw new Conflict('Artifact IDs must be unique and total bytes bounded');
  if (contentDigest(report.outcome.artifacts) !== contentDigest(report.artifacts.map((artifact) => artifactMetadata(artifact)))) throw new Conflict('Artifact metadata does not match uploaded artifacts');
  for (const artifact of report.artifacts) {
    const bytes = Buffer.from(artifact.base64, 'base64');
    if (bytes.length !== artifact.bytes || bytes.toString('base64') !== artifact.base64 || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Conflict('Artifact size or digest does not match its bytes');
  }
  if (report.outcome.kind !== 'completed') return;
  if (preparation.kind === 'repository') {
    const declared = preparation.manifest.tasks[TaskId.parse(taskId)];
    if (declared) for (const output of declared.outputs) {
      if (!report.artifacts.some((artifact) => artifact.name === output.path && artifact.kind === output.kind)) throw new Conflict('A declared output is missing from the completed result');
    }
  }
  const result = report.outcome.result;
  const task = snapshot.content.definition.categories.flatMap((category) => category.tasks).find((task) => task.id === taskId);
  if (!task) throw new Conflict('Task is absent from the snapshot');
  const expected = { 'text-generation': 'text', 'text-editing': 'text', 'image-understanding': 'text', 'image-generation': 'image', 'image-editing': 'image', 'html-static': 'html', 'html-interactive': 'html', 'coding-bugfix': 'code', 'coding-feature': 'code', 'browser-scenario': 'browser' };
  if (result.kind !== expected[task.kind]) throw new Conflict('Result kind does not match the task');
  function requireArtifact(id: string, kind: string) {
    const artifact = artifacts.get(id);
    if (!artifact || artifact.kind !== kind) throw new Conflict('Result references a missing or incompatible artifact');
    const bytes = Buffer.from(artifact.base64, 'base64');
    if (kind !== 'code' && bytes.length === 0) throw new Conflict('Required artifacts must contain bytes');
    if (kind === 'recording' && (artifact.mediaType !== 'video/webm' || bytes.subarray(0, 4).toString('hex') !== '1a45dfa3')) throw new Conflict('Browser recording must be WebM');
    if (kind === 'image' && !((artifact.mediaType === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) || (artifact.mediaType === 'image/jpeg' && bytes.length > 4 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff') || (artifact.mediaType === 'image/webp' && bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'))) throw new Conflict('Image artifact has no supported raster signature');
  }
  const references = result.kind === 'image' ? result.artifactIds : result.kind === 'html' ? [result.entryArtifactId, ...result.assetArtifactIds] : result.kind === 'browser' ? [result.recordingArtifactId, ...result.screenshotArtifactIds] : [];
  if (new Set(references).size !== references.length) throw new Conflict('Result artifact references must be unique');
  switch (result.kind) {
    case 'text': break;
    case 'image': result.artifactIds.forEach((id) => requireArtifact(id, 'image')); break;
    case 'html': requireArtifact(result.entryArtifactId, 'html'); result.assetArtifactIds.forEach((id) => { if (!artifacts.has(id)) throw new Conflict('HTML references a missing asset'); }); break;
    case 'code': requireArtifact(result.patchArtifactId, 'code'); break;
    case 'browser': requireArtifact(result.recordingArtifactId, 'recording'); result.screenshotArtifactIds.forEach((id) => requireArtifact(id, 'image')); break;
  }
}
export async function readArtifact(pool: pg.Pool, runId: string, artifactId: string) {
  const result = await pool.query('SELECT f.bytes FROM configured_artifacts f JOIN configured_attempts a ON a.id = f.attempt_id WHERE a.run_id = $1 AND f.id = $2', [runId, artifactId]);
  if (!result.rowCount) throw new NotFound();
  return z.instanceof(Buffer).parse(result.rows[0].bytes);
}
