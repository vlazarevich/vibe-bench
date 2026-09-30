import { z } from 'zod';

export const RuntimeId = z.uuid().brand<'RuntimeId'>();
export const ToolName = z.enum(['codex', 'claude', 'opencode', 'git', 'gh', 'node', 'dotnet', 'python', 'npm', 'pnpm', 'make', 'cmake', 'gcc', 'docker']);
export const ToolAvailability = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), version: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/).max(100).nullable() }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.enum(['missing', 'failed', 'timeout', 'output-limit']) }).strict(),
]);
export const HarnessReadiness = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }).strict(),
  z.object({ kind: z.literal('not-ready') }).strict(),
  z.object({ kind: z.literal('unknown'), reason: z.enum(['missing', 'failed', 'timeout', 'output-limit', 'unrecognized']) }).strict(),
]);
export const RuntimeRegistration = z.object({
  protocol: z.literal(1),
  runtimeId: RuntimeId,
  observation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedAt: z.iso.datetime(),
  capacity: z.object({ slots: z.number().int().min(1).max(256) }).strict(),
  machine: z.object({ platform: z.literal('linux'), architecture: z.enum(['x64', 'arm64']), logicalCpus: z.number().int().positive(), memoryBytes: z.number().int().positive() }).strict(),
  tools: z.array(z.object({ name: ToolName, availability: ToolAvailability }).strict()).length(ToolName.options.length).refine((tools) => new Set(tools.map((tool) => tool.name)).size === ToolName.options.length, 'Tools must appear exactly once'),
  harnesses: z.object({ codex: HarnessReadiness, claude: HarnessReadiness, opencodeGo: HarnessReadiness }).strict(),
  modelPolicy: z.literal('provider-discovered-at-execution'),
}).strict();
export type RuntimeRegistration = z.infer<typeof RuntimeRegistration>;
export type ToolAvailability = z.infer<typeof ToolAvailability>;
export type HarnessReadiness = z.infer<typeof HarnessReadiness>;
export const RuntimeReceipt = z.object({ runtimeId: RuntimeId, observation: z.number().int().positive(), observedAt: z.iso.datetime(), receivedAt: z.iso.datetime() }).strict();
export const RegisteredRuntime = z.object({ registration: RuntimeRegistration, receivedAt: z.iso.datetime() }).strict();
export const RegisteredRuntimes = z.array(RegisteredRuntime);
