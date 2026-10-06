import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { z, ZodError } from 'zod';
import { Interrupted } from './processes/run.ts';
import { configureRuntime, readConfiguration, runtimeRoot, reconnectDelay, stateLock, executionLock, clearState, workerPost, RequestRejected } from './configuration.ts';
import { onboard, AcknowledgedCapabilities, Status } from './onboarding.ts';
import { runWorkerOnce } from './execution.ts';

declare const __VIBE_RUNNER_VERSION__: string;

export { reconnectDelay } from './configuration.ts';
async function remoteRevoke(stateRoot: string) {
  try {
    const configuration = await readConfiguration(stateRoot);
    z.object({ ok: z.literal(true) }).strict().parse(await workerPost(configuration, '/api/worker/revoke', {}));
    process.stdout.write('Dashboard revocation confirmed. Unfinished assigned runs were abandoned.\n');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    process.stderr.write(error instanceof RequestRejected ? 'Dashboard revocation failed. Abandonment was not confirmed.\n' : 'Dashboard revocation and abandonment could not be confirmed.\n');
  }
}
async function pair(stateRoot: string, token: string) {
  const release = await stateLock(stateRoot);
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = await executionLock(stateRoot);
    await remoteRevoke(stateRoot);
    await clearState(stateRoot);
    try {
      await configureRuntime(stateRoot, token);
      const receipt = await onboard({ stateRoot, locked: true });
      process.stdout.write(`Paired runtime ${receipt.runtimeId}. Capabilities acknowledged at ${receipt.receivedAt}.\n`);
    } catch (error) { await clearState(stateRoot); throw error; }
  } finally { await stop?.(); await release(); }
}
async function revoke(stateRoot: string) {
  const release = await stateLock(stateRoot);
  let stop: (() => Promise<void>) | undefined;
  try { stop = await executionLock(stateRoot); await remoteRevoke(stateRoot); await clearState(stateRoot); process.stdout.write('Local pairing and runner state removed.\n'); }
  finally { await stop?.(); await release(); }
}
async function status(stateRoot: string) {
  const release = await stateLock(stateRoot);
  try {
  let configuration;
  try { configuration = await readConfiguration(stateRoot); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { process.stdout.write('Unpaired. Create an enrollment token in the dashboard and run vibe-runner pair TOKEN.\n'); return; } throw error; }
  let authority = 'paired';
  try { const current = Status.parse(await workerPost(configuration, '/api/worker/status')); if (current.runtimeId !== configuration.runtimeId) throw new Error('Dashboard runtime identity mismatch'); }
  catch (error) { authority = error instanceof RequestRejected && error.status === 401 ? 'rejected or revoked credentials' : 'dashboard unreachable'; }
  let capabilities = null;
  try { capabilities = AcknowledgedCapabilities.parse(JSON.parse(await readFile(join(runtimeRoot(stateRoot, configuration), 'capabilities.json'), 'utf8'))); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  process.stdout.write(`${JSON.stringify({ status: authority, runtimeId: configuration.runtimeId, dashboard: configuration.apiUrl, capabilities }, null, 2)}\n`);
  } finally { await release(); }
}
async function run(stateRoot: string, once: boolean) {
  const release = await stateLock(stateRoot);
  let stop: (() => Promise<void>) | undefined;
  let configuration;
  try { stop = await executionLock(stateRoot); configuration = await readConfiguration(stateRoot); }
  catch (error) { await stop?.(); throw error; }
  finally { await release(); }
  try {
    let failures = 0;
    let refreshed = false;
    for (;;) {
      try {
        let restoring = false;
        try { await access(join(runtimeRoot(stateRoot, configuration), 'work', 'assignment.json')); restoring = true; }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
        if (!restoring && !refreshed) { await onboard({ stateRoot }); refreshed = true; }
        let executables = {};
        try { executables = z.object({ codex: z.string().optional(), claude: z.string().optional(), opencode: z.string().optional() }).parse(JSON.parse(await readFile(join(runtimeRoot(stateRoot, configuration), 'executables.json'), 'utf8'))); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
        const result = await runWorkerOnce({ configuration, stateRoot, executables });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (once && result.kind === 'finished') return;
        if (result.kind === 'finished') refreshed = false;
        failures = 0;
      } catch (error) {
        if (error instanceof Interrupted || error instanceof RequestRejected && [401, 409].includes(error.status)) throw error;
        failures++;
        process.stderr.write(`${error instanceof Error ? error.message : 'Dashboard connection failed'}. Retrying in ${reconnectDelay(failures) / 1000}s.\n`);
      }
      await new Promise((done) => setTimeout(done, failures ? reconnectDelay(failures) : 2_000));
    }
  } finally { await stop?.(); }
}
export async function main(args: string[]) {
  const program = new Command().name('vibe-runner').description('Pair with a dashboard and execute assigned runs sequentially.').version(typeof __VIBE_RUNNER_VERSION__ === 'string' ? __VIBE_RUNNER_VERSION__ : 'development').option('--state-dir <path>', 'Private runner state directory', join(homedir(), '.local', 'state', 'vibe-runner')).exitOverride();
  const root = () => resolve(program.opts<{ stateDir: string }>().stateDir);
  const pairing = program.command('pair').description('Manage dashboard pairing.');
  pairing.command('status').description('Show pairing authority and cached acknowledged capabilities.').action(() => status(root()));
  pairing.command('probe').description('Rescan tools and upload a new capability observation.').action(async () => { const receipt = await onboard({ stateRoot: root() }); process.stdout.write(`Capabilities acknowledged at ${receipt.receivedAt}.\n`); });
  pairing.command('revoke').description('Revoke dashboard authority and remove local state.').action(() => revoke(root()));
  pairing.argument('[token]', 'Dashboard enrollment token').action(async (token?: string) => { if (!token) { pairing.help(); return; } await pair(root(), token); });
  program.command('run').description('Recover saved delivery and continuously execute assigned runs.').action(() => run(root(), false));
  program.command('run-once').description('Wait for one run and exit after every report is acknowledged.').action(() => run(root(), true));
  try { await program.parseAsync(args, { from: 'user' }); }
  catch (error) { if (error instanceof Error && 'code' in error && ['commander.helpDisplayed', 'commander.version'].includes(String(error.code))) return; throw error; }
}

export function reportCliError(error: unknown) {
  const message = error instanceof ZodError ? 'Invalid dashboard data or enrollment token. Check the token and dashboard version.' : error instanceof Error ? error.message : 'Runner failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof CommanderError ? 2 : error instanceof Interrupted ? 130 : 1;
}
