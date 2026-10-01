import { z } from 'zod';
import { RuntimeId } from './runtime.ts';
import { TaskId } from './suites.ts';
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
export const InlineArtifact = ArtifactMetadata.extend({ base64: z.string().max(10_666_668).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) });
export const AttemptReport = z.discriminatedUnion('kind', [
  z.object({ ...reportIdentity, kind: z.literal('started'), attemptId: ConfiguredAttemptId, startedAt: z.iso.datetime() }).strict(),
  z.object({ ...reportIdentity, kind: z.literal('terminal'), attemptId: ConfiguredAttemptId, outcome: AttemptOutcome, artifacts: z.array(InlineArtifact).max(32), observed: z.object({ executableVersion: z.string().max(200).nullable(), model: z.string().max(200).nullable() }).strict() }).strict(),
]);
export type AttemptReport = z.infer<typeof AttemptReport>;
export const WorkReceipt = z.object({ reportId: z.uuid(), runId: ConfiguredRunId, acceptedAt: z.iso.datetime() }).strict();
export type WorkReceipt = z.infer<typeof WorkReceipt>;
export const SafeRelativePath = z.string().min(1).max(500).refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git'), 'Use a contained relative path');
export const BrowserStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goto'), url: z.url().max(2000).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)) }).strict(),
  z.object({ kind: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1).max(500), value: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal('expect-text'), selector: z.string().min(1).max(500), text: z.string().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('screenshot'), path: SafeRelativePath }).strict(),
]);
export const BrowserPlan = z.object({ steps: z.array(BrowserStep).min(1).max(100) }).strict();
export type BrowserPlan = z.infer<typeof BrowserPlan>;
export const TaskIO = z.object({ inputs: z.array(SafeRelativePath).max(32), outputs: z.array(z.object({ path: SafeRelativePath, kind: z.enum(['image', 'html', 'code', 'text']) }).strict()).max(32), browser: z.object({ startUrl: z.url().max(2000).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)), instructions: z.string().max(20_000) }).strict().nullable() }).strict();
export type TaskIO = z.infer<typeof TaskIO>;
export const RepositoryManifest = z.object({ version: z.literal(1), tasks: z.record(TaskId, TaskIO) }).strict();
export type RepositoryManifest = z.infer<typeof RepositoryManifest>;
export const WORK_BODY_LIMIT = 12_000_000;
export const MAX_ARTIFACT_BYTES = 8_000_000;
