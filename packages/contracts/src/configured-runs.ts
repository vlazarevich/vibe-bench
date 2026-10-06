import { z } from 'zod';
import { Text } from './text.ts';
import { CategoryId, ContentId, SuiteContent, TaskId, TaskKind } from './suites.ts';
import { RepositoryManifest, SafeRelativePath } from './task-io.ts';
import { RuntimeId } from './runtime.ts';

export const ConfiguredRunId = z.uuid().brand<'ConfiguredRunId'>();
export const ConfiguredAttemptId = z.uuid().brand<'ConfiguredAttemptId'>();
export const EntrantId = z.uuid().brand<'EntrantId'>();
export const Digest = Text.regex(/^[a-f0-9]{64}$/);
const commonSettings = { timeoutMs: z.number().int().min(100).max(3_600_000) };
const entrantFields = { id: EntrantId, model: Text.trim().min(1).max(200) };
export const Entrant = z.discriminatedUnion('harness', [
  z.object({ ...entrantFields, harness: z.literal('codex'), settings: z.object({ ...commonSettings, reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional() }).strict() }).strict(),
  z.object({ ...entrantFields, harness: z.literal('claude'), settings: z.object({ ...commonSettings, effort: z.enum(['low', 'medium', 'high', 'max']).optional() }).strict() }).strict(),
  z.object({ ...entrantFields, harness: z.literal('opencode'), settings: z.object({ ...commonSettings, variant: Text.regex(/^[a-zA-Z0-9_-]{1,100}$/).optional() }).strict() }).strict(),
]);
export type Entrant = z.infer<typeof Entrant>;
const Entrants = z.array(Entrant).min(1).max(16).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Entrant IDs must be unique');
export const ConfigureRun = z.object({
  contentId: ContentId, runtimeId: RuntimeId,
  selection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }).strict(), z.object({ kind: z.literal('subset'), categoryIds: z.array(CategoryId).max(100), taskIds: z.array(TaskId).max(10_000) }).strict()]),
  entrants: Entrants, source: z.enum(['fixture', 'live']),
}).strict();
export type ConfigureRun = z.infer<typeof ConfigureRun>;
export const CreateConfiguredRun = ConfigureRun.extend({ requestId: z.uuid() });
export type CreateConfiguredRun = z.infer<typeof CreateConfiguredRun>;
export const ExecutionSnapshot = z.object({ protocol: z.literal(1), content: SuiteContent, runtimeId: RuntimeId, selectedTaskIds: z.array(TaskId).min(1).max(10_000), entrants: Entrants, source: z.enum(['fixture', 'live']), digest: Digest }).strict();
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshot>;
export const RunPreview = z.object({ snapshot: ExecutionSnapshot, matrix: z.array(z.object({ taskId: TaskId, taskTitle: Text, kind: TaskKind, entrantId: EntrantId }).strict()).min(1).max(1000) }).strict();
export type RunPreview = z.infer<typeof RunPreview>;
export const ArtifactMetadata = z.object({ id: z.uuid(), name: SafeRelativePath.refine((path) => path.length <= 240, 'Artifact path is too long'), kind: z.enum(['text', 'image', 'html', 'code', 'recording', 'diagnostic']), mediaType: Text.regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).max(120), bytes: z.number().int().min(0).max(8_000_000), sha256: Digest }).strict();
export const ResultDescriptor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text') }).strict(),
  z.object({ kind: z.literal('image'), artifactIds: z.array(z.uuid()).min(1).max(32) }).strict(),
  z.object({ kind: z.literal('html'), entryArtifactId: z.uuid(), assetArtifactIds: z.array(z.uuid()).max(31) }).strict(),
  z.object({ kind: z.literal('code'), patchArtifactId: z.uuid(), changedFiles: z.array(z.object({ path: SafeRelativePath, change: z.enum(['added', 'modified', 'deleted']) }).strict()).max(1000) }).strict(),
  z.object({ kind: z.literal('browser'), recordingArtifactId: z.uuid(), format: z.literal('webm'), screenshotArtifactIds: z.array(z.uuid()).max(31) }).strict(),
]);
export type ResultDescriptor = z.infer<typeof ResultDescriptor>;
export const AttemptOutcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), result: ResultDescriptor, summary: Text.min(1).max(100_000), artifacts: z.array(ArtifactMetadata).max(32) }).strict(),
  z.object({ kind: z.literal('skipped'), reason: Text.min(1).max(4000), artifacts: z.array(ArtifactMetadata).max(32) }).strict(),
  z.object({ kind: z.literal('failed'), reason: Text.min(1).max(4000), artifacts: z.array(ArtifactMetadata).max(32) }).strict(),
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;
export const AttemptSlot = z.object({ attemptId: ConfiguredAttemptId, taskId: TaskId, entrantId: EntrantId, ordinal: z.number().int().nonnegative() }).strict();
export type AttemptSlot = z.infer<typeof AttemptSlot>;
export const AttemptView = AttemptSlot.extend({ state: z.discriminatedUnion('kind', [z.object({ kind: z.literal('queued') }).strict(), z.object({ kind: z.literal('assigned') }).strict(), z.object({ kind: z.literal('started'), startedAt: z.iso.datetime() }).strict(), z.object({ kind: z.literal('terminal'), outcome: AttemptOutcome }).strict()]) });
export const Preparation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('repository'), commit: Text.regex(/^[a-f0-9]{40,64}$/), manifestDigest: Digest, manifest: RepositoryManifest }).strict(),
  z.object({ kind: z.literal('failed'), reason: Text.min(1).max(4000) }).strict(),
]);
export type Preparation = z.infer<typeof Preparation>;
export const ConfiguredRunView = z.object({ runId: ConfiguredRunId, createdAt: z.iso.datetime(), snapshot: ExecutionSnapshot, preparation: Preparation.nullable(), attempts: z.array(AttemptView), status: z.enum(['queued', 'running', 'finished', 'abandoned']) }).strict();
export type ConfiguredRunView = z.infer<typeof ConfiguredRunView>;
export const ConfiguredRunList = z.array(z.object({ runId: ConfiguredRunId, title: Text, createdAt: z.iso.datetime(), source: z.enum(['fixture', 'live']), status: z.enum(['queued', 'running', 'finished', 'abandoned']), attempts: z.number().int(), terminal: z.number().int() }).strict());
