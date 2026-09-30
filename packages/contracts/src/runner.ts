import { z } from 'zod';
import { assessDefinition, PinnedSuiteTask, SuiteContent, TaskId } from './suites.ts';
import { canonicalJson, contentDigest } from './canonical.ts';

export const RunId = z.uuid().brand<'RunId'>();
export const ReportId = z.uuid().brand<'ReportId'>();
export const AttemptId = z.uuid().brand<'AttemptId'>();
export const Model = z.enum(['gpt-6-luna', 'gpt-6-sol']);
export const Task = z.object({ title: z.string().min(1).max(120), prompt: z.string().min(1).max(20_000) }).strict();
export const Outcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('succeeded'), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ kind: z.literal('failed'), reason: z.enum(['timeout', 'exit', 'missing-output', 'process', 'output-limit']), detail: z.string().max(2000) }).strict(),
]);
export const Entrant = z.object({
  attemptId: AttemptId,
  model: Model,
  cliVersion: z.string().min(1).max(200),
  outcome: Outcome,
}).strict();
export const SnapshotBody = z.object({
  schemaVersion: z.literal(1),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('suite'), content: SuiteContent, taskId: TaskId }).strict(),
    z.object({ kind: z.literal('ad-hoc'), evaluation: z.object({ kind: z.literal('pairwise-choice'), criterion: z.literal('Which answer is better?') }).strict() }).strict(),
  ]),
  task: Task,
  models: z.tuple([Model, Model]),
  settings: z.object({ timeoutMs: z.number().int().min(100).max(600_000), sandbox: z.literal('read-only'), adapter: z.literal('codex-text-v1') }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.models[0] === snapshot.models[1]) ctx.addIssue({ code: 'custom', message: 'Choose two distinct models' });
  if (snapshot.origin.kind === 'suite') {
    const { content, taskId } = snapshot.origin;
    if (content.digest !== contentDigest({ schemaVersion: content.schemaVersion, definition: content.definition })) ctx.addIssue({ code: 'custom', message: 'Suite content digest does not match' });
    const selected = content.definition.categories.flatMap((category) => category.tasks).find((task) => task.id === taskId);
    if (assessDefinition(content.definition).kind !== 'ready') ctx.addIssue({ code: 'custom', message: 'Complete the suite before execution' });
    if (!selected || selected.kind !== 'text-generation' || content.definition.materials.kind !== 'none') ctx.addIssue({ code: 'custom', message: 'The local runner supports only text-generation tasks without repository materials' });
    if (selected && (selected.title !== snapshot.task.title || selected.prompt !== snapshot.task.prompt)) ctx.addIssue({ code: 'custom', message: 'Selected task does not match suite content' });
  }
});
export const Snapshot = SnapshotBody.safeExtend({ digest: z.string().regex(/^[a-f0-9]{64}$/) }).superRefine((snapshot, ctx) => {
  const { digest, ...body } = snapshot;
  if (digest !== contentDigest(body)) ctx.addIssue({ code: 'custom', message: 'Snapshot digest does not match' });
});
export type Snapshot = z.infer<typeof Snapshot>;
export function prepareSnapshot({ task, pinned, models, timeoutMs }: { task: z.infer<typeof Task>; pinned?: PinnedSuiteTask; models: [Model, Model]; timeoutMs: number }): Snapshot {
  let origin: z.infer<typeof SnapshotBody>['origin'] = { kind: 'ad-hoc', evaluation: { kind: 'pairwise-choice', criterion: 'Which answer is better?' } };
  if (pinned) {
    origin = { kind: 'suite', content: pinned.content, taskId: pinned.taskId };
    const selected = pinned.content.definition.categories.flatMap((category) => category.tasks).find((candidate) => candidate.id === pinned.taskId);
    if (!selected) throw new Error('Selected task is absent from the pinned suite');
    task = { title: selected.title, prompt: selected.prompt };
  }
  const body = SnapshotBody.parse({ schemaVersion: 1, origin, task, models, settings: { timeoutMs, sandbox: 'read-only', adapter: 'codex-text-v1' } });
  return Snapshot.parse({ ...body, digest: contentDigest(body) });
}
const reportFields = {
  reportId: ReportId, runId: RunId, source: z.enum(['fixture', 'live']), createdAt: z.iso.datetime(), task: Task, entrants: z.tuple([Entrant, Entrant]),
};
export const Report = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal(1), ...reportFields }).strict(),
  z.object({ protocol: z.literal(2), ...reportFields, snapshot: Snapshot }).strict(),
]).superRefine((report, ctx) => {
  if (report.entrants[0].model === report.entrants[1].model || report.entrants[0].attemptId === report.entrants[1].attemptId) ctx.addIssue({ code: 'custom', message: 'Entrants must be distinct' });
  if (report.protocol === 2 && (canonicalJson(report.task) !== canonicalJson(report.snapshot.task) || canonicalJson(report.entrants.map((entrant) => entrant.model)) !== canonicalJson(report.snapshot.models))) ctx.addIssue({ code: 'custom', message: 'Report inputs do not match the execution snapshot' });
});
export type Report = z.infer<typeof Report>;
export type Outcome = z.infer<typeof Outcome>;
export type Model = z.infer<typeof Model>;
export const Receipt = z.object({ reportId: ReportId, runId: RunId, accepted: z.literal(true) }).strict();
