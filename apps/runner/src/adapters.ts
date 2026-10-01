import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { join, delimiter, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Entrant } from '../../../packages/contracts/src/configured-runs.ts';
import { executionEnvironment } from './materials.ts';
import { runProcess, readBounded } from './processes/run.ts';

export type Executables = Partial<Record<Entrant['harness'], string | undefined>>;
export class Unavailable extends Error {}
export async function checkExecutable(executable: string | undefined) {
  if (!executable) throw new Unavailable('Harness executable is not configured');
  const candidates = executable.includes('/') ? [executable] : (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, executable));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  throw new Unavailable('Harness executable is not installed or executable');
}
const Event = z.object({ type: z.string(), part: z.object({ text: z.string().optional(), reason: z.string().optional() }).passthrough().optional() }).passthrough();
export async function executeAdapter({ entrant, executable, workspace, directory, prompt, images = [], writable, prefix = [] }: { prefix?: string[]; entrant: Entrant; executable: string; workspace: string; directory: string; prompt: string; images?: string[]; writable: boolean }) {
  await mkdir(directory, { recursive: true });
  const env = executionEnvironment();
  const versionDirectory = join(directory, 'version'); await mkdir(versionDirectory);
  const version = await runProcess({ executable, args: [...prefix, '--version'], cwd: workspace, directory: versionDirectory, input: '', timeoutMs: 10_000, env });
  if (version.kind !== 'exited' || version.code !== 0) throw new Error('Harness version probe failed');
  const executableVersion = (await readBounded(join(versionDirectory, 'stdout.log'), 200)).trim();
  let args: string[];
  switch (entrant.harness) {
    case 'codex': args = ['exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--model', entrant.model, '--sandbox', writable ? 'workspace-write' : 'read-only', '--output-last-message', join(directory, 'final.txt'), '--json', ...(entrant.settings.reasoningEffort ? ['-c', `model_reasoning_effort="${entrant.settings.reasoningEffort}"`] : []), ...images.flatMap((image) => ['--image', image]), '-']; break;
    case 'claude': args = ['-p', '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--tools', writable ? 'Read,Edit,Write,Bash' : 'Read', '--permission-mode', 'acceptEdits', '--model', entrant.model, '--output-format', 'json', ...(entrant.settings.effort ? ['--effort', entrant.settings.effort] : [])]; break;
    case 'opencode': args = ['run', '--pure', '--format', 'json', '--model', entrant.model, ...(entrant.settings.variant ? ['--variant', entrant.settings.variant] : []), ...images.flatMap((image) => ['--file', image])]; env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true'; env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'deny', read: 'allow', ...(writable ? { edit: 'allow', bash: 'allow' } : {}) } }); break;
  }
  const result = await runProcess({ executable, args: [...prefix, ...args], cwd: workspace, directory, input: prompt, timeoutMs: entrant.settings.timeoutMs, env });
  if (result.kind !== 'exited') throw new Error(`Harness ${result.kind}`);
  if (result.code !== 0) throw new Error(`Harness exited with code ${result.code}`);
  const raw = await readBounded(join(directory, 'stdout.log'), 500_000);
  let text: string; let model: string | null = null;
  switch (entrant.harness) {
    case 'codex': {
      const events = raw.split(/\r?\n/).filter(Boolean).map((line) => Event.parse(JSON.parse(line)));
      if (!events.some((event) => event.type === 'turn.completed') || events.some((event) => event.type === 'turn.failed' || event.type === 'error')) throw new Error('Codex did not complete a turn');
      text = await readBounded(join(directory, 'final.txt')); break;
    }
    case 'claude': {
      const result = z.object({ type: z.literal('result'), subtype: z.literal('success'), is_error: z.literal(false), result: z.string(), modelUsage: z.record(z.string(), z.unknown()).optional() }).passthrough().parse(JSON.parse(raw));
      text = result.result; const models = Object.keys(result.modelUsage ?? {}); model = models.length === 1 ? models[0] ?? null : null; break;
    }
    case 'opencode': {
      const events = raw.split(/\r?\n/).filter(Boolean).map((line) => Event.parse(JSON.parse(line)));
      if (events.some((event) => event.type === 'error') || !events.some((event) => event.type === 'step_finish' && event.part?.reason === 'stop')) throw new Error('OpenCode did not complete a final step');
      text = events.filter((event) => event.type === 'text').map((event) => event.part?.text ?? '').join('\n'); break;
    }
  }
  if (!text.trim() || text.length > 100_000) throw new Error('Harness produced no bounded final answer');
  return { text, observed: { executableVersion, model } };
}
