import { availableParallelism, totalmem, platform, arch, hostname, release } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  RuntimeRegistration,
  RuntimeId,
  ToolName,
  RuntimeReceipt,
  type ToolAvailability,
  type HarnessReadiness,
} from '../../../packages/contracts/src/runtime.ts';
import { runProcess, readBounded, Interrupted } from './processes/run.ts';
import { checkExecutable } from './executables.ts';
import { durableDirectory, durableWrite } from './spool.ts';
import { readConfiguration, runtimeRoot, workerPost, stateLock } from './configuration.ts';

const Identity = z
  .object({ runtimeId: RuntimeId, observation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
  .strict();
const AuthJson = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
});
const commands = {
  codex: 'codex',
  claude: 'claude',
  opencode: 'opencode',
  git: 'git',
  gh: 'gh',
  node: 'node',
  dotnet: 'dotnet',
  python: 'python3',
  npm: 'npm',
  pnpm: 'pnpm',
  make: 'make',
  cmake: 'cmake',
  gcc: 'gcc',
  docker: 'docker',
} satisfies Record<z.infer<typeof ToolName>, string>;

type Probe =
  | { kind: 'exited'; code: number; output: string; diagnostic: string }
  | { kind: 'missing' | 'failed' | 'timeout' | 'output-limit' };
async function probe(executable: string, args: string[], timeoutMs: number): Promise<Probe> {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-onboarding-'));
  try {
    try {
      executable = await checkExecutable(executable);
      const result = await runProcess({
        executable,
        args,
        cwd: directory,
        directory,
        input: '',
        timeoutMs,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith('VIBE_') && key !== 'ARTIFICIAL_ANALYSIS_API_KEY',
          ),
        ),
      });
      if (result.kind !== 'exited') return result;
      try {
        return {
          ...result,
          output: await readBounded(join(directory, 'stdout.log'), 16_000),
          diagnostic: await readBounded(join(directory, 'stderr.log'), 16_000),
        };
      } catch {
        return { kind: 'output-limit' };
      }
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      if (
        error instanceof Error &&
        (error.message.includes('not installed') || ('code' in error && error.code === 'ENOENT'))
      )
        return { kind: 'missing' };
      return { kind: 'failed' };
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function tool(name: z.infer<typeof ToolName>, timeoutMs: number, executable?: string): Promise<ToolAvailability> {
  const result = await probe(executable ?? commands[name], ['--version'], timeoutMs);
  if (result.kind !== 'exited') return { kind: 'unavailable', reason: result.kind };
  if (result.code !== 0) return { kind: 'unavailable', reason: 'failed' };
  const version = /(?:^|\s)v?(\d+\.\d+(?:\.\d+)?)(?:\s|$|[-+])/m.exec(result.output)?.[1] ?? null;
  return { kind: 'available', version };
}

async function auth(
  name: 'codex' | 'claude' | 'opencode',
  timeoutMs: number,
  executable?: string,
): Promise<HarnessReadiness> {
  const args = name === 'codex' ? ['login', 'status'] : name === 'claude' ? ['auth', 'status'] : ['auth', 'list'];
  const result = await probe(executable ?? commands[name], args, timeoutMs);
  if (result.kind !== 'exited') return { kind: 'unknown', reason: result.kind };
  if (name === 'claude') {
    try {
      const parsed = AuthJson.safeParse(JSON.parse(result.output));
      if (parsed.success && !parsed.data.loggedIn) return { kind: 'not-ready' };
      if (parsed.success && result.code === 0)
        return {
          kind: 'ready',
          ...(['claude.ai', 'oauth'].includes(parsed.data.authMethod ?? '')
            ? { accountType: 'subscription' as const }
            : ['api_key', 'api-key'].includes(parsed.data.authMethod ?? '')
              ? { accountType: 'api-key' as const }
              : {}),
        };
    } catch {}
    return { kind: 'unknown', reason: result.code === 0 ? 'unrecognized' : 'failed' };
  }
  if (name === 'codex') {
    if (result.code === 0 && /^Logged in (?:using|with)\b/m.test(result.output + '\n' + result.diagnostic))
      return {
        kind: 'ready',
        ...(/API key/i.test(result.output + '\n' + result.diagnostic)
          ? { accountType: 'api-key' as const }
          : /ChatGPT/i.test(result.output + '\n' + result.diagnostic)
            ? { accountType: 'subscription' as const }
            : {}),
      };
    if (/^Not logged in\b/m.test(result.output + '\n' + result.diagnostic)) return { kind: 'not-ready' };
  } else {
    const clean = result.output.replace(/\u001b\[[0-9;]*m/g, '');
    if (result.code === 0 && /(?:^|\n)[^\n]*\bOpenCode Go\b[^\n]*\b(?:api|oauth)\b/i.test(clean)) {
      const listed = await probe(executable ?? commands.opencode, ['models', 'opencode-go'], timeoutMs);
      const models =
        listed.kind === 'exited' && listed.code === 0
          ? listed.output
              .split(/\r?\n/)
              .map((v) => v.trim())
              .filter((v) => /^opencode-go\/[a-zA-Z0-9._:/-]{1,180}$/.test(v))
              .slice(0, 500)
          : [];
      return {
        kind: 'ready',
        accountType: /OpenCode Go[^\n]*\boauth\b/i.test(clean) ? 'subscription' : 'api-key',
        ...(models.length ? { models: [...new Set(models)] } : {}),
      };
    }
    if (result.code === 0 && /\b\d+ credentials?\b/i.test(clean)) return { kind: 'not-ready' };
  }
  return { kind: 'unknown', reason: result.code === 0 ? 'unrecognized' : 'failed' };
}

async function codexModels(
  readiness: HarnessReadiness,
  timeoutMs: number,
  selected?: string,
): Promise<HarnessReadiness> {
  if (readiness.kind !== 'ready') return readiness;
  const directory = await mkdtemp(join(tmpdir(), 'vibe-models-'));
  try {
    const input =
      [
        { id: 1, method: 'initialize', params: { clientInfo: { name: 'vibe-bench', version: '1' } } },
        { method: 'initialized', params: {} },
        { id: 2, method: 'model/list', params: { limit: 100 } },
      ]
        .map((v) => JSON.stringify(v))
        .join('\n') + '\n';
    await runProcess({
      executable: await checkExecutable(selected ?? 'codex'),
      args: ['app-server'],
      cwd: directory,
      directory,
      input,
      holdInputOpen: true,
      timeoutMs,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith('VIBE_') && key !== 'ARTIFICIAL_ANALYSIS_API_KEY',
        ),
      ),
    });
    const raw = await readBounded(join(directory, 'stdout.log'), 200000);
    const response = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .find((value) => z.object({ id: z.literal(2) }).safeParse(value).success);
    const value = z
      .object({
        result: z.object({
          data: z
            .array(
              z.object({
                model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,200}$/),
                displayName: z.string().min(1).max(200),
                inputModalities: z
                  .array(z.enum(['text', 'image', 'video', 'speech', 'transcription']))
                  .max(5)
                  .default([]),
              }),
            )
            .max(100),
        }),
      })
      .parse(response);
    return {
      ...readiness,
      models: value.result.data.map((m) => m.model),
      modelDetails: value.result.data.map((m) => ({ id: m.model, name: m.displayName, modalities: m.inputModalities })),
    };
  } catch (error) {
    if (error instanceof Interrupted) throw error;
    return readiness;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function discoverRuntime({
  runtimeId,
  observation,
  selected = {},
  timeoutMs = 5_000,
}: {
  runtimeId: z.infer<typeof RuntimeId>;
  observation: number;
  selected?: Partial<Record<z.infer<typeof ToolName>, string>>;
  timeoutMs?: number;
}) {
  const tools = [];
  for (const name of ToolName.options) tools.push({ name, availability: await tool(name, timeoutMs, selected[name]) });
  return RuntimeRegistration.parse({
    protocol: 1,
    runtimeId,
    observation,
    observedAt: new Date().toISOString(),
    machine: {
      hostname: hostname().slice(0, 255),
      os: await readFile('/etc/os-release', 'utf8')
        .then((text) => /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '') ?? `Linux ${release()}`)
        .catch(() => `Linux ${release()}`),
      platform: platform(),
      architecture: arch(),
      logicalCpus: availableParallelism(),
      memoryBytes: totalmem(),
    },
    tools,
    harnesses: {
      codex: await codexModels(await auth('codex', timeoutMs, selected.codex), timeoutMs, selected.codex),
      claude: await auth('claude', timeoutMs, selected.claude),
      opencodeGo: await auth('opencode', timeoutMs, selected.opencode),
    },
    modelPolicy: 'provider-discovered-at-execution',
  });
}

export function onboardingUrl(value: string) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
  )
    throw new Error('API URL must be an HTTPS origin or loopback HTTP origin');
  return new URL('/api/worker/registrations', url);
}

export const Status = z.object({ runtimeId: RuntimeId, observation: z.number().int().nonnegative() }).strict();
export const AcknowledgedCapabilities = z
  .object({ registration: RuntimeRegistration, receipt: RuntimeReceipt })
  .strict();
export async function onboard({ stateRoot, locked = false }: { stateRoot: string; locked?: boolean }) {
  const release = locked ? async () => {} : await stateLock(stateRoot, { wait: true });
  try {
    const configuration = await readConfiguration(stateRoot);
    const root = runtimeRoot(stateRoot, configuration);
    await durableDirectory(root);
    const status = Status.parse(await workerPost(configuration, '/api/worker/status'));
    if (status.runtimeId !== configuration.runtimeId) throw new Error('Dashboard runtime identity mismatch');
    let previous = 0;
    try {
      previous = Identity.parse(JSON.parse(await readFile(join(root, 'identity.json'), 'utf8'))).observation;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const identity = Identity.parse({
      runtimeId: configuration.runtimeId,
      observation: Math.max(previous, status.observation) + 1,
    });
    await durableWrite(join(root, 'identity.json'), identity);
    const selected: Partial<Record<z.infer<typeof ToolName>, string>> = {};
    for (const name of ToolName.options) {
      try {
        selected[name] = await checkExecutable(commands[name]);
      } catch {}
    }
    const registration = await discoverRuntime({ ...identity, selected });
    const receipt = RuntimeReceipt.parse(await workerPost(configuration, '/api/worker/registrations', registration));
    if (
      receipt.runtimeId !== registration.runtimeId ||
      receipt.observation !== registration.observation ||
      receipt.observedAt !== registration.observedAt
    )
      throw new Error('Registration receipt does not match observation');
    await durableWrite(join(root, 'capabilities.json'), { registration, receipt });
    await durableWrite(join(root, 'executables.json'), selected);
    return receipt;
  } finally {
    await release();
  }
}
