import { availableParallelism, totalmem, platform, arch } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { RuntimeRegistration, RuntimeId, ToolName, RuntimeReceipt, type ToolAvailability, type HarnessReadiness } from '../../../packages/contracts/src/runtime.ts';
import { runProcess, readBounded, Interrupted } from './processes/run.ts';
import { acquireLocalLock } from '../../../scripts/local-lock.ts';
import { durableWrite } from './spool.ts';

const Identity = z.object({ runtimeId: RuntimeId, observation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const AuthJson = z.object({ loggedIn: z.boolean() });
const commands = { codex: 'codex', claude: 'claude', opencode: 'opencode', git: 'git', gh: 'gh', node: 'node', dotnet: 'dotnet', python: 'python3', npm: 'npm', pnpm: 'pnpm', make: 'make', cmake: 'cmake', gcc: 'gcc', docker: 'docker' } satisfies Record<z.infer<typeof ToolName>, string>;

type Probe = { kind: 'exited'; code: number; output: string; diagnostic: string } | { kind: 'missing' | 'failed' | 'timeout' | 'output-limit' };
async function probe(executable: string, args: string[], timeoutMs: number): Promise<Probe> {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-onboarding-'));
  try {
    try {
      const result = await runProcess({ executable, args, cwd: directory, directory, input: '', timeoutMs, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VIBE_'))) });
      if (result.kind !== 'exited') return result;
      try { return { ...result, output: await readBounded(join(directory, 'stdout.log'), 16_000), diagnostic: await readBounded(join(directory, 'stderr.log'), 16_000) }; }
      catch { return { kind: 'output-limit' }; }
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'failed' };
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function tool(name: z.infer<typeof ToolName>, timeoutMs: number): Promise<ToolAvailability> {
  const result = await probe(commands[name], ['--version'], timeoutMs);
  if (result.kind !== 'exited') return { kind: 'unavailable', reason: result.kind };
  if (result.code !== 0) return { kind: 'unavailable', reason: 'failed' };
  const version = /(?:^|\s)v?(\d+\.\d+(?:\.\d+)?)(?:\s|$|[-+])/m.exec(result.output)?.[1] ?? null;
  return { kind: 'available', version };
}

async function auth(name: 'codex' | 'claude' | 'opencode', timeoutMs: number): Promise<HarnessReadiness> {
  const args = name === 'codex' ? ['login', 'status'] : name === 'claude' ? ['auth', 'status'] : ['auth', 'list'];
  const result = await probe(commands[name], args, timeoutMs);
  if (result.kind !== 'exited') return { kind: 'unknown', reason: result.kind };
  if (name === 'claude') {
    try {
      const parsed = AuthJson.safeParse(JSON.parse(result.output));
      if (parsed.success && !parsed.data.loggedIn) return { kind: 'not-ready' };
      if (parsed.success && result.code === 0) return { kind: 'ready' };
    }
    catch {}
    return { kind: 'unknown', reason: result.code === 0 ? 'unrecognized' : 'failed' };
  }
  if (name === 'codex') {
    if (result.code === 0 && /^Logged in (?:using|with)\b/m.test(result.output + '\n' + result.diagnostic)) return { kind: 'ready' };
    if (/^Not logged in\b/m.test(result.output + '\n' + result.diagnostic)) return { kind: 'not-ready' };
  } else {
    const clean = result.output.replace(/\u001b\[[0-9;]*m/g, '');
    if (result.code === 0 && /(?:^|\n)[^\n]*\bOpenCode Go\b[^\n]*\b(?:api|oauth)\b/i.test(clean)) return { kind: 'ready' };
    if (result.code === 0 && /\b\d+ credentials?\b/i.test(clean)) return { kind: 'not-ready' };
  }
  return { kind: 'unknown', reason: result.code === 0 ? 'unrecognized' : 'failed' };
}

export async function discoverRuntime({ runtimeId, observation, slots, timeoutMs = 5_000 }: { runtimeId: z.infer<typeof RuntimeId>; observation: number; slots: number; timeoutMs?: number }) {
  const tools = [];
  for (const name of ToolName.options) tools.push({ name, availability: await tool(name, timeoutMs) });
  return RuntimeRegistration.parse({ protocol: 1, runtimeId, observation, observedAt: new Date().toISOString(), capacity: { slots }, machine: { platform: platform(), architecture: arch(), logicalCpus: availableParallelism(), memoryBytes: totalmem() }, tools,
    harnesses: { codex: await auth('codex', timeoutMs), claude: await auth('claude', timeoutMs), opencodeGo: await auth('opencode', timeoutMs) }, modelPolicy: 'provider-discovered-at-execution' });
}

export function onboardingUrl(value: string) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || url.protocol === 'http:' && loopback)) throw new Error('API URL must be an HTTPS origin or loopback HTTP origin');
  return new URL('/api/worker/registrations', url);
}

export async function onboard({ apiUrl, stateRoot, slots }: { apiUrl: string; stateRoot: string; slots: number }) {
  z.number().int().min(1).max(256).parse(slots);
  const url = onboardingUrl(apiUrl);
  const root = resolve(stateRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await acquireLocalLock(root);
  try {
    const pendingPath = join(root, 'pending.json');
    let registration: RuntimeRegistration;
    try { registration = RuntimeRegistration.parse(JSON.parse(await readFile(pendingPath, 'utf8'))); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      let identity: z.infer<typeof Identity>;
      try { identity = Identity.parse(JSON.parse(await readFile(join(root, 'identity.json'), 'utf8'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; identity = Identity.parse({ runtimeId: randomUUID(), observation: 0 }); }
      identity = Identity.parse({ ...identity, observation: identity.observation + 1 });
      await durableWrite(join(root, 'identity.json'), identity);
      registration = await discoverRuntime({ ...identity, slots });
      await durableWrite(pendingPath, registration);
    }
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registration), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Registration rejected (${response.status})`); }
    if (!response.body) throw new Error('Missing registration receipt');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32_000) { await reader.cancel(); throw new Error('Registration receipt is too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const receipt = RuntimeReceipt.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (receipt.runtimeId !== registration.runtimeId || receipt.observation !== registration.observation || receipt.observedAt !== registration.observedAt) throw new Error('Registration receipt does not match observation');
    await durableWrite(join(root, 'receipt.json'), receipt);
    await rm(pendingPath);
    return receipt;
  } finally { await release(); }
}
