import { z } from 'zod';

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
export const Report = z.object({
  protocol: z.literal(1),
  reportId: ReportId,
  runId: RunId,
  source: z.enum(['fixture', 'live']),
  createdAt: z.iso.datetime(),
  task: Task,
  entrants: z.tuple([Entrant, Entrant]),
}).strict().refine((r) => r.entrants[0].model !== r.entrants[1].model && r.entrants[0].attemptId !== r.entrants[1].attemptId, 'Entrants must be distinct');
export type Report = z.infer<typeof Report>;
export type Outcome = z.infer<typeof Outcome>;
export type Model = z.infer<typeof Model>;
export const Receipt = z.object({ reportId: ReportId, runId: RunId, accepted: z.literal(true) }).strict();
