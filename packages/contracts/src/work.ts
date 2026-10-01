import { z } from 'zod';
import { Text } from './text.ts';
import { RuntimeId } from './runtime.ts';
import { ArtifactMetadata, AttemptOutcome, AttemptSlot, ConfiguredAttemptId, ConfiguredRunId, ExecutionSnapshot, Preparation } from './configured-runs.ts';

export const AssignmentId = z.uuid().brand<'AssignmentId'>();
export const ClaimRequest = z.object({ protocol: z.literal(1), requestId: z.uuid(), runtimeId: RuntimeId }).strict();
export type ClaimRequest = z.infer<typeof ClaimRequest>;
export const RunAssignment = z.object({ kind: z.literal('assigned'), requestId: z.uuid(), assignmentId: AssignmentId, runId: ConfiguredRunId, snapshot: ExecutionSnapshot, attempts: z.array(AttemptSlot).min(1) }).strict();
export type RunAssignment = z.infer<typeof RunAssignment>;
export const ClaimReceipt = z.discriminatedUnion('kind', [z.object({ kind: z.literal('idle'), requestId: z.uuid() }).strict(), RunAssignment]);
export type ClaimReceipt = z.infer<typeof ClaimReceipt>;
const reportIdentity = { protocol: z.literal(1), reportId: z.uuid(), runtimeId: RuntimeId, assignmentId: AssignmentId, runId: ConfiguredRunId };
export const PreparationReport = z.object({ ...reportIdentity, preparation: Preparation }).strict();
export type PreparationReport = z.infer<typeof PreparationReport>;
export const InlineArtifact = ArtifactMetadata.extend({ base64: Text.max(10_666_668).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) });
export const AttemptReport = z.discriminatedUnion('kind', [
  z.object({ ...reportIdentity, kind: z.literal('started'), attemptId: ConfiguredAttemptId, startedAt: z.iso.datetime() }).strict(),
  z.object({ ...reportIdentity, kind: z.literal('terminal'), attemptId: ConfiguredAttemptId, outcome: AttemptOutcome, artifacts: z.array(InlineArtifact).max(32), observed: z.object({ executableVersion: Text.max(200).nullable(), model: Text.max(200).nullable() }).strict() }).strict(),
]);
export type AttemptReport = z.infer<typeof AttemptReport>;
export const WorkReceipt = z.object({ reportId: z.uuid(), runId: ConfiguredRunId, acceptedAt: z.iso.datetime() }).strict();
export type WorkReceipt = z.infer<typeof WorkReceipt>;
export { SafeRelativePath, BrowserStep, BrowserPlan, TaskIO, RepositoryManifest } from './task-io.ts';
export const WORK_BODY_LIMIT = 12_000_000;
export const MAX_ARTIFACT_BYTES = 8_000_000;
