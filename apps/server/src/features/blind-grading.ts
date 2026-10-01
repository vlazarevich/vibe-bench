import { createHash, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { AttemptOutcome, ConfiguredAttemptId, ConfiguredRunId, ExecutionSnapshot } from '../../../../packages/contracts/src/configured-runs.ts';
import { Criterion, TaskId, TaskKind, toGrade } from '../../../../packages/contracts/src/suites.ts';
import { BlindAsset, BlindGradingRuns, BlindGradingSession, BlindGradingTask, GradingAssetHandle, GradingCardHandle, GradingCategoryHandle, GradingCriterionHandle, GradingSessionId, GradingTaskHandle, Judgment, JudgmentValue, SaveJudgment } from '../../../../packages/contracts/src/blind-grading.ts';
import { Conflict, NotFound } from '../errors.ts';

const hash = (authority: string) => createHash('sha256').update(authority).digest('hex');
const AssetMapping = BlindAsset.extend({ artifactId: z.uuid() });
const CardMapping = z.object({ handle: GradingCardHandle, attemptId: ConfiguredAttemptId, kind: z.enum(['completed', 'failed', 'skipped']), assets: z.array(AssetMapping) });
const TaskMapping = z.object({ handle: GradingTaskHandle, taskId: TaskId, title: z.string(), prompt: z.string(), kind: TaskKind, criteria: z.array(z.object({ handle: GradingCriterionHandle, snapshot: Criterion })), cards: z.array(CardMapping) });
const Mapping = z.object({ title: z.string(), source: z.enum(['fixture', 'live']), conversion: z.literal('rating-control-v1'), categories: z.array(z.object({ handle: GradingCategoryHandle, title: z.string(), tasks: z.array(TaskMapping) })) });
const Stored = z.object({ id: GradingSessionId, mapping: Mapping });
const Cell = z.object({ card: GradingCardHandle, criterion: GradingCriterionHandle, version: z.number().int(), value: JudgmentValue });
type Database = pg.Pool | pg.PoolClient;

async function authorized(database: Database, id: z.infer<typeof GradingSessionId>, authority: string) {
  const rows = await database.query('SELECT id, mapping FROM blind_grading_sessions WHERE id=$1 AND authority_hash=$2', [id, hash(authority)]);
  const session = z.array(Stored).parse(rows.rows)[0];
  if (!session) throw new NotFound();
  return session;
}
function presentCell(cell: z.infer<typeof Cell>): Judgment {
  return { ...cell, value: cell.value.kind === 'graded' ? { ...cell.value, grade: toGrade(cell.value.selection) } : cell.value };
}
function resultAssets(outcome: AttemptOutcome): z.infer<typeof AssetMapping>[] {
  if (outcome.kind !== 'completed') return [];
  const result = outcome.result;
  let ids: string[];
  switch (result.kind) {
    case 'text': ids = []; break;
    case 'image': ids = result.artifactIds; break;
    case 'html': ids = [result.entryArtifactId, ...result.assetArtifactIds]; break;
    case 'code': ids = [result.patchArtifactId]; break;
    case 'browser': ids = [result.recordingArtifactId, ...result.screenshotArtifactIds]; break;
  }
  return [...new Set(ids)].flatMap((id) => {
    const artifact = outcome.artifacts.find((item) => item.id === id);
    if (!artifact) throw new Conflict('Result is unavailable');
    if (artifact.kind === 'diagnostic') return [];
    return [{ handle: GradingAssetHandle.parse(randomUUID()), artifactId: id, kind: artifact.kind, mediaType: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/webm', 'text/plain', 'text/html'].includes(artifact.mediaType) ? artifact.mediaType : 'application/octet-stream', bytes: artifact.bytes }];
  });
}
export async function listGradingRuns(pool: pg.Pool) {
  const rows = await pool.query(`SELECT r.review_id AS "reviewId", r.snapshot->'content'->'definition'->>'title' AS title,
    r.snapshot->>'source' AS source, bool_and(o.attempt_id IS NOT NULL) AS ready
    FROM configured_runs r JOIN configured_attempts a ON a.run_id=r.id LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id GROUP BY r.id ORDER BY r.created_at DESC`);
  return BlindGradingRuns.parse(rows.rows);
}
export async function createGrading(pool: pg.Pool, reviewId: string, authority: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 5))', [hash(authority) + reviewId]);
    const runs = await client.query('SELECT id, snapshot FROM configured_runs WHERE review_id=$1', [reviewId]);
    const run = z.array(z.object({ id: ConfiguredRunId, snapshot: ExecutionSnapshot })).parse(runs.rows)[0];
    if (!run) throw new NotFound();
    const existing = await client.query('SELECT id FROM blind_grading_sessions WHERE run_id=$1 AND authority_hash=$2', [run.id, hash(authority)]);
    const previous = z.array(z.object({ id: GradingSessionId })).parse(existing.rows)[0];
    if (previous) { await client.query('COMMIT'); return previous.id; }
    const rows = await client.query('SELECT a.id, a.task_id, o.outcome FROM configured_attempts a LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id WHERE a.run_id=$1 ORDER BY a.ordinal', [run.id]);
    const attempts = z.array(z.object({ id: ConfiguredAttemptId, task_id: TaskId, outcome: AttemptOutcome.nullable() })).parse(rows.rows);
    if (!attempts.length || attempts.some((attempt) => attempt.outcome === null)) throw new Conflict('Wait for all attempts to finish');
    const definition = run.snapshot.content.definition;
    const mapping = Mapping.parse({ title: definition.title, source: run.snapshot.source, conversion: definition.evaluation.conversion, categories: definition.categories.flatMap((category) => {
      const tasks = category.tasks.filter((task) => run.snapshot.selectedTaskIds.includes(task.id)).map((task) => {
        const cards = attempts.filter((attempt) => attempt.task_id === task.id).map((attempt) => {
          if (!attempt.outcome) throw new Conflict('Wait for all attempts to finish');
          return { handle: randomUUID(), attemptId: attempt.id, kind: attempt.outcome.kind, assets: resultAssets(attempt.outcome) };
        });
        for (let i = cards.length - 1; i > 0; i--) { const j = randomInt(i + 1); const a = cards[i], b = cards[j]; if (a && b) { cards[i] = b; cards[j] = a; } }
        return { handle: randomUUID(), taskId: task.id, title: task.title, prompt: task.prompt, kind: task.kind, cards, criteria: task.criterionIds.map((id) => ({ handle: randomUUID(), snapshot: definition.evaluation.criteria.find((criterion) => criterion.id === id) })) };
      });
      return tasks.length ? [{ handle: randomUUID(), title: category.title, tasks }] : [];
    }) });
    const id = GradingSessionId.parse(randomUUID());
    await client.query('INSERT INTO blind_grading_sessions(id,run_id,authority_hash,mapping) VALUES($1,$2,$3,$4)', [id, run.id, hash(authority), mapping]);
    const cells = mapping.categories.flatMap((category) => category.tasks.flatMap((task) => task.cards.filter((card) => card.kind === 'completed').flatMap((card) => task.criteria.map((criterion) => ({ task: task.handle, card: card.handle, criterion: criterion.handle })))));
    await client.query(`INSERT INTO blind_grading_judgments(session_id,task_handle,card_handle,criterion_handle)
      SELECT $1, task, card, criterion FROM jsonb_to_recordset($2::jsonb) AS cells(task uuid, card uuid, criterion uuid)`, [id, JSON.stringify(cells)]);
    await client.query('COMMIT'); return id;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function readGrading(pool: pg.Pool, id: z.infer<typeof GradingSessionId>, authority: string): Promise<BlindGradingSession> {
  const session = await authorized(pool, id, authority);
  const counts = await pool.query(`SELECT task_handle, count(*) FILTER(WHERE value->>'kind'='ungraded')::int AS ungraded,
    count(*) FILTER(WHERE value->>'kind'='skipped')::int AS skipped, count(*) FILTER(WHERE value->>'kind'='graded')::int AS graded
    FROM blind_grading_judgments WHERE session_id=$1 GROUP BY task_handle`, [id]);
  const progress = z.array(z.object({ task_handle: GradingTaskHandle, ungraded: z.number(), skipped: z.number(), graded: z.number() })).parse(counts.rows);
  return BlindGradingSession.parse({ id, title: session.mapping.title, source: session.mapping.source, categories: session.mapping.categories.map((category) => ({ handle: category.handle, title: category.title, tasks: category.tasks.map((task) => {
    const count = progress.find((item) => item.task_handle === task.handle);
    return { handle: task.handle, title: task.title, progress: { ungraded: count?.ungraded ?? 0, skipped: count?.skipped ?? 0, graded: count?.graded ?? 0, unavailable: task.cards.filter((card) => card.kind !== 'completed').length } };
  }) })) });
}
export async function readGradingTask(pool: pg.Pool, id: z.infer<typeof GradingSessionId>, authority: string, handle: z.infer<typeof GradingTaskHandle>): Promise<BlindGradingTask> {
  const session = await authorized(pool, id, authority);
  const task = session.mapping.categories.flatMap((category) => category.tasks).find((item) => item.handle === handle);
  if (!task) throw new NotFound();
  const rows = await pool.query('SELECT attempt_id, outcome FROM attempt_outcomes WHERE attempt_id=ANY($1::uuid[])', [task.cards.map((card) => card.attemptId)]);
  const outcomes = z.array(z.object({ attempt_id: ConfiguredAttemptId, outcome: AttemptOutcome })).parse(rows.rows);
  const cells = z.array(Cell).parse((await pool.query('SELECT card_handle AS card, criterion_handle AS criterion, version, value FROM blind_grading_judgments WHERE session_id=$1 AND task_handle=$2', [id, handle])).rows);
  return BlindGradingTask.parse({ handle, title: task.title, prompt: task.prompt, kind: task.kind, criteria: task.criteria.map(({ handle, snapshot }) => ({ handle, title: snapshot.title, instructions: snapshot.instructions, control: snapshot.control })), cards: task.cards.map((card) => {
    if (card.kind !== 'completed') return { handle: card.handle, kind: card.kind };
    const outcome = outcomes.find((item) => item.attempt_id === card.attemptId)?.outcome;
    if (!outcome || outcome.kind !== 'completed') throw new NotFound();
    const result = outcome.result.kind === 'text' ? { kind: 'text', text: outcome.summary } : { kind: outcome.result.kind, assets: card.assets.map(({ handle, kind, mediaType, bytes }) => ({ handle, kind, mediaType, bytes })) };
    return { handle: card.handle, kind: 'completed', result, judgments: cells.filter((cell) => cell.card === card.handle).map(presentCell) };
  }) });
}
export async function saveGradingJudgment(pool: pg.Pool, id: z.infer<typeof GradingSessionId>, authority: string, command: SaveJudgment): Promise<Judgment> {
  const session = await authorized(pool, id, authority);
  const task = session.mapping.categories.flatMap((category) => category.tasks).find((task) => task.cards.some((card) => card.handle === command.card && card.kind === 'completed'));
  const criterion = task?.criteria.find((criterion) => criterion.handle === command.criterion);
  if (!criterion) throw new NotFound();
  if (command.value.kind === 'graded' && command.value.selection.control !== criterion.snapshot.control) throw new Conflict('Use the rating control assigned to this criterion');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query('SELECT card_handle AS card, criterion_handle AS criterion, version, value, value=$4::jsonb AS identical FROM blind_grading_judgments WHERE session_id=$1 AND card_handle=$2 AND criterion_handle=$3 FOR UPDATE', [id, command.card, command.criterion, command.value]);
    const row = z.array(Cell.extend({ identical: z.boolean() })).parse(rows.rows)[0];
    if (!row) throw new NotFound();
    if (command.expectedVersion !== row.version) {
      if (command.expectedVersion === row.version - 1 && row.identical) { await client.query('COMMIT'); return presentCell(Cell.parse(row)); }
      throw new Conflict('This judgment changed in another tab. Reload the saved judgment before editing.');
    }
    await client.query('UPDATE blind_grading_judgments SET value=$4, version=version+1 WHERE session_id=$1 AND card_handle=$2 AND criterion_handle=$3', [id, command.card, command.criterion, command.value]);
    await client.query('COMMIT'); return presentCell({ card: command.card, criterion: command.criterion, version: row.version + 1, value: command.value });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function readGradingAsset(pool: pg.Pool, id: z.infer<typeof GradingSessionId>, authority: string, handle: z.infer<typeof GradingAssetHandle>) {
  const session = await authorized(pool, id, authority);
  const asset = session.mapping.categories.flatMap((category) => category.tasks).flatMap((task) => task.cards).flatMap((card) => card.assets).find((asset) => asset.handle === handle);
  if (!asset) throw new NotFound();
  const rows = await pool.query('SELECT bytes FROM configured_artifacts WHERE id=$1', [asset.artifactId]);
  const row = z.array(z.object({ bytes: z.instanceof(Buffer) })).parse(rows.rows)[0];
  if (!row) throw new NotFound();
  const previewable = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/webm'].includes(asset.mediaType);
  return { bytes: row.bytes, mediaType: previewable ? asset.mediaType : 'application/octet-stream', previewable };
}
