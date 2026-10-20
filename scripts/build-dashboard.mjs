import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages a self-contained dashboard directory: the bundled server and web assets plus a flat production
 * `node_modules` installed from the lockfile. Hosts need Node 24 and nothing from a source checkout.
 */
export async function buildDashboard({
  version,
  output = join(root, 'dist/dashboard'),
  web = join(root, 'dist/web'),
  pnpm = process.env.npm_execpath ?? 'pnpm',
}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Dashboard archives support Linux x64 only');
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Version must be a v-prefixed release version');
  await access(join(web, 'index.html')).catch(() => {
    throw new Error('Build the web assets first with pnpm build');
  });
  output = resolve(output);
  const name = `vibe-bench-dashboard-${version}-linux-x64`;
  const staging = join(output, 'staging', 'vibe-bench-dashboard');
  await rm(join(output, 'staging'), { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await buildServer({ output: join(staging, 'dist/server') });
  await cp(web, join(staging, 'dist/web'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await writeFile(
    join(staging, 'package.json'),
    `${JSON.stringify({ ...manifest, version: version.slice(1), scripts: { start: 'node --env-file-if-exists=.env dist/server/serve.mjs', migrate: 'node --env-file-if-exists=.env dist/server/migrate.mjs' } }, null, 2)}\n`,
  );
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env.example']) await copyFile(join(root, file), join(staging, file));
  await cp(join(root, 'deploy/systemd'), join(staging, 'deploy/systemd'), { recursive: true });
  // A hoisted layout gives plain directories without pnpm symlinks, so the archive extracts anywhere.
  const install = ['install', '--prod', '--frozen-lockfile', '--prefer-offline', '--config.node-linker=hoisted'];
  const [command, args] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm, ...install]] : [pnpm, install];
  execFileSync(command, args, { cwd: staging, stdio: 'inherit' });
  await writeFile(join(staging, 'VERSION'), `${version}\n`);
  const archive = `${name}.tar.gz`;
  execFileSync('tar', ['-czf', join(output, archive), '--owner=0', '--group=0', '-C', join(output, 'staging'), 'vibe-bench-dashboard']);
  const installer = join(output, 'install-dashboard.sh');
  await copyFile(join(root, 'scripts/install-dashboard.sh'), installer);
  await chmod(installer, 0o755);
  const sums = [];
  for (const file of [archive, 'install-dashboard.sh'])
    sums.push(`${createHash('sha256').update(await readFile(join(output, file))).digest('hex')}  ${file}`);
  await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  await rm(join(output, 'staging'), { recursive: true, force: true });
  return join(output, archive);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`Built ${await buildDashboard({ version: process.argv[2] ?? 'v0.0.0-dev' })}\n`);
}
