import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { configureRuntime, readConfiguration, runtimeRoot } from './configuration.ts';
import { onboard } from './onboarding.ts';
import { runWorkerOnce } from './execution.ts';

export function reconnectDelay(failures: number) { return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, failures - 1))); }
export async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--version') { process.stdout.write(`${process.env.VIBE_RUNTIME_VERSION ?? 'development'}\n`); return; }
  if (!args.length || args.length === 1 && args[0] === '--help') { process.stdout.write('vibe-runtime config <base64url-enrollment>\nvibe-runtime config\nvibe-runtime onboard\nvibe-runtime work [--once]\nvibe-runtime --version\n'); return; }
  const stateRoot = process.env.VIBE_RUNTIME_STATE ?? join(homedir(), '.local', 'state', 'vibe-runtime');
  const [command, ...rest] = args;
  if (command === 'config' && rest.length <= 1) { const configuration = await configureRuntime(stateRoot, rest[0]); process.stdout.write(`Runtime ${configuration.runtimeId} configured. Run vibe-runtime work to register and execute assigned work.\n`); return; }
  const slots = z.coerce.number().int().min(1).max(256).parse(process.env.VIBE_RUNTIME_SLOTS ?? '1');
  if (command === 'onboard' && !rest.length) { const receipt = await onboard({stateRoot,slots}); process.stdout.write(`Runtime ${receipt.runtimeId} observation ${receipt.observation} registered.\n`); return; }
  if (command !== 'work' || rest.length > 1 || rest.length === 1 && rest[0] !== '--once') throw new Error('Unknown command. Run vibe-runtime --help.');
  const once = rest[0] === '--once';
  let failures = 0;
  let registered = '';
  for (;;) {
    try {
      const configuration = await readConfiguration(stateRoot);
      let restoring = false;
      try { await access(join(runtimeRoot(stateRoot, configuration), 'work', 'assignment.json')); restoring = true; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      if (!restoring && registered !== configuration.credentialId) { await onboard({stateRoot,slots}); registered = configuration.credentialId; }
      const result = await runWorkerOnce({configuration,stateRoot,executables:{codex:process.env.VIBE_CODEX_BIN,claude:process.env.VIBE_CLAUDE_BIN,opencode:process.env.VIBE_OPENCODE_BIN}});
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (once) return;
      failures = 0;
    } catch (error) {
      if (once) throw error;
      failures++;
      process.stderr.write(`${error instanceof Error ? error.message : 'Runtime connection failed'}. Retrying in ${reconnectDelay(failures) / 1000}s.\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, failures ? reconnectDelay(failures) : 2_000));
  }
}
