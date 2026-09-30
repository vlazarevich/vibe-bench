import { resolve } from 'node:path';
import { runProcess } from '../../apps/runner/src/processes/run.ts';
import { childEnvironment } from '../../apps/runner/src/runner.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Missing directory');
await runProcess({ executable: process.execPath, args: [resolve('tests/fixtures/process-tree.mjs'), resolve(directory, 'child.pid'), 'timeout'], cwd: directory, directory, input: '', timeoutMs: 30_000, env: childEnvironment() });
