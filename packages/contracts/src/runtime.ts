import { z } from 'zod';

export const RuntimeId = z.uuid().brand<'RuntimeId'>();
export const ToolName = z.enum([
  'codex',
  'claude',
  'opencode',
  'git',
  'gh',
  'node',
  'dotnet',
  'python',
  'npm',
  'pnpm',
  'make',
  'cmake',
  'gcc',
  'docker',
]);
export const ToolAvailability = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('available'),
      version: z
        .string()
        .regex(/^\d+\.\d+(?:\.\d+)?$/)
        .max(100)
        .nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal('unavailable'), reason: z.enum(['missing', 'failed', 'timeout', 'output-limit']) })
    .strict(),
]);
export const HarnessReadiness = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ready'),
      accountType: z.enum(['subscription', 'api-key']).optional(),
      modelDetails: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-zA-Z0-9._:/-]{1,200}$/),
              name: z.string().min(1).max(200),
              modalities: z.array(z.enum(['text', 'image', 'video', 'speech', 'transcription'])).max(5),
            })
            .strict(),
        )
        .max(500)
        .optional(),
      models: z
        .array(z.string().regex(/^[a-zA-Z0-9._:/-]{1,200}$/))
        .max(500)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal('not-ready') }).strict(),
  z
    .object({
      kind: z.literal('unknown'),
      reason: z.enum(['missing', 'failed', 'timeout', 'output-limit', 'unrecognized']),
    })
    .strict(),
]);
export const RuntimeRegistration = z
  .object({
    protocol: z.literal(1),
    runtimeId: RuntimeId,
    observation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    observedAt: z.iso.datetime(),
    machine: z
      .object({
        hostname: z.string().trim().min(1).max(255).optional(),
        os: z.string().max(200).optional(),
        platform: z.literal('linux'),
        architecture: z.enum(['x64', 'arm64']),
        logicalCpus: z.number().int().positive(),
        memoryBytes: z.number().int().positive(),
      })
      .strict(),
    tools: z
      .array(z.object({ name: ToolName, availability: ToolAvailability }).strict())
      .length(ToolName.options.length)
      .refine(
        (tools) => new Set(tools.map((tool) => tool.name)).size === ToolName.options.length,
        'Tools must appear exactly once',
      ),
    harnesses: z.object({ codex: HarnessReadiness, claude: HarnessReadiness, opencodeGo: HarnessReadiness }).strict(),
    modelPolicy: z.literal('provider-discovered-at-execution'),
  })
  .strict();
export type RuntimeRegistration = z.infer<typeof RuntimeRegistration>;
export type ToolAvailability = z.infer<typeof ToolAvailability>;
export type HarnessReadiness = z.infer<typeof HarnessReadiness>;
export const RuntimeReceipt = z
  .object({
    runtimeId: RuntimeId,
    observation: z.number().int().positive(),
    observedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export const RegisteredRuntime = z.object({ registration: RuntimeRegistration, receivedAt: z.iso.datetime() }).strict();
export const RegisteredRuntimes = z.array(RegisteredRuntime);
