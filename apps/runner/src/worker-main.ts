import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { RuntimeId } from '../../../packages/contracts/src/runtime.ts';
import { runWorkerOnce } from './execution.ts';

try {
  const stateRoot = process.env.VIBE_RUNTIME_STATE ?? '.local/runtime-onboarding';
  const identity = z.object({runtimeId:RuntimeId}).parse(JSON.parse(await readFile(join(stateRoot,'identity.json'),'utf8')));
  const apiUrl = z.url().parse(process.env.VIBE_API_URL);
  const executables = {codex:process.env.VIBE_CODEX_BIN,claude:process.env.VIBE_CLAUDE_BIN,opencode:process.env.VIBE_OPENCODE_BIN};
  do {
    const result = await runWorkerOnce({apiUrl,stateRoot,runtimeId:identity.runtimeId,executables});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.argv.includes('--once')) break;
    await new Promise((resolve) => setTimeout(resolve,2000));
  } while (true);
} catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Worker failed'}\n`); process.exitCode = 1; }
