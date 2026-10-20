import { z } from 'zod';
import { Text } from './text.ts';
import { RuntimeId } from './runtime.ts';
import { ArtifactMetadata, AttemptOutcome, AttemptSlot, ConfiguredAttemptId, ConfiguredRunId, ExecutionSnapshot, Preparation } from './configured-runs.ts';

/** Protocol 2 delivers artifact bytes in bounded chunks before the terminal report. */
export const WORK_PROTOCOL = 2;
const Protocol = z.literal(WORK_PROTOCOL);
export const AssignmentId = z.uuid().brand<'AssignmentId'>();
export const ClaimRequest = z.object({ protocol: Protocol, requestId: z.uuid(), runtimeId: RuntimeId }).strict();
export type ClaimRequest = z.infer<typeof ClaimRequest>;
export const RunAssignment = z.object({ kind: z.literal('assigned'), requestId: z.uuid(), assignmentId: AssignmentId, runId: ConfiguredRunId, snapshot: ExecutionSnapshot, attempts: z.array(AttemptSlot).min(1) }).strict();
export type RunAssignment = z.infer<typeof RunAssignment>;
export const ClaimReceipt = z.discriminatedUnion('kind', [z.object({ kind: z.literal('idle'), requestId: z.uuid() }).strict(), RunAssignment]);
export type ClaimReceipt = z.infer<typeof ClaimReceipt>;
const reportIdentity = { protocol: Protocol, reportId: z.uuid(), runtimeId: RuntimeId, assignmentId: AssignmentId, runId: ConfiguredRunId };
export const PreparationReport = z.object({ ...reportIdentity, preparation: Preparation }).strict();
export type PreparationReport = z.infer<typeof PreparationReport>;
const Base64 = Text.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const InlineArtifact = ArtifactMetadata.extend({ base64: Base64.max(10_666_668) });
const StartedReport = z.object({ ...reportIdentity, kind: z.literal('started'), attemptId: ConfiguredAttemptId, startedAt: z.iso.datetime() }).strict();
const terminalReport = { ...reportIdentity, kind: z.literal('terminal'), attemptId: ConfiguredAttemptId, outcome: AttemptOutcome, observed: z.object({ executableVersion: Text.max(200).nullable(), model: Text.max(200).nullable() }).strict() };
/** Wire report: terminal outcomes list artifact metadata; bytes arrive earlier as `ArtifactChunk`s. */
export const AttemptReport = z.discriminatedUnion('kind', [StartedReport, z.object(terminalReport).strict()]);
export type AttemptReport = z.infer<typeof AttemptReport>;
/** Runner spool entry: the terminal report keeps its artifact bytes until every chunk and the report are acknowledged. */
export const SpooledAttemptReport = z.discriminatedUnion('kind', [StartedReport, z.object({ ...terminalReport, artifacts: z.array(InlineArtifact).max(32) }).strict()]);
export type SpooledAttemptReport = z.infer<typeof SpooledAttemptReport>;
export const ARTIFACT_CHUNK_BYTES = 3_000_000;
/** One aligned slice of an artifact. Offsets are multiples of ARTIFACT_CHUNK_BYTES; only the final slice may be shorter. */
export const ArtifactChunk = z.object({ protocol: Protocol, runtimeId: RuntimeId, assignmentId: AssignmentId, runId: ConfiguredRunId, attemptId: ConfiguredAttemptId, artifactId: z.uuid(), offset: z.number().int().min(0).multipleOf(ARTIFACT_CHUNK_BYTES), base64: Base64.min(4).max(ARTIFACT_CHUNK_BYTES / 3 * 4) }).strict();
export type ArtifactChunk = z.infer<typeof ArtifactChunk>;
export const ArtifactChunkReceipt = z.object({ artifactId: z.uuid(), offset: z.number().int().min(0), bytes: z.number().int().min(1) }).strict();
export type ArtifactChunkReceipt = z.infer<typeof ArtifactChunkReceipt>;
export const WorkReceipt = z.object({ reportId: z.uuid(), runId: ConfiguredRunId, acceptedAt: z.iso.datetime() }).strict();
export type WorkReceipt = z.infer<typeof WorkReceipt>;
export { SafeRelativePath, BrowserStep, BrowserPlan, TaskIO, RepositoryManifest } from './task-io.ts';
/** Every worker request fits under common serverless body limits (Vercel: 4.5 MB). */
export const WORK_BODY_LIMIT = 4_100_000;
export const MAX_ARTIFACT_BYTES = 8_000_000;
