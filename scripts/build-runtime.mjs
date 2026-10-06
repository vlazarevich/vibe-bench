import { build } from 'esbuild';
import { inject } from 'postject';
import { brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function buildRuntime({ version, entry = join(root, 'apps/runner/src/cli.ts'), output = join(root, 'dist/runtime') }) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('Runtime builds support Linux x64 glibc only');
  }
  if (process.versions.node !== '24.21.0') throw new Error('Build the runtime with Node 24.21.0');
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Version must be a v-prefixed release version');
  output = resolve(output);
  const staging = join(output, 'staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const bundled = await build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node24', write: false,
    define: { 'import.meta.url': '__importMetaUrl', 'process.env.VIBE_RUNTIME_VERSION': JSON.stringify(version) },
    banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
    plugins: [{ name: 'runtime-browser', setup(builder) {
      builder.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: 'playwright-core', external: true }));
    } }],
  });
  const files = {};
  files['apps/runner/src/cli.cjs'] = Buffer.from(bundled.outputFiles[0].contents).toString('base64');
  files['tests/fixtures/configured-harness.mjs'] = (await readFile(join(root, 'tests/fixtures/configured-harness.mjs'))).toString('base64');
  const playwrightRequire = createRequire(require.resolve('@playwright/test'));
  const coreRequire = createRequire(playwrightRequire.resolve('playwright'));
  const core = dirname(coreRequire.resolve('playwright-core/package.json'));
  for (const path of await readdir(core, { recursive: true, withFileTypes: true })) {
    if (!path.isFile()) continue;
    const absolute = join(path.parentPath, path.name);
    const relative = absolute.slice(core.length + 1);
    files[`node_modules/playwright-core/${relative}`] = (await readFile(absolute)).toString('base64');
  }
  const payload = join(staging, 'runtime.br');
  await writeFile(payload, brotliCompressSync(Buffer.from(JSON.stringify(files)), { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }));
  const blob = join(staging, 'runtime.blob');
  const config = join(staging, 'sea.json');
  await writeFile(config, JSON.stringify({ main: join(root, 'scripts/runtime-bootstrap.cjs'), output: blob,
    disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, execArgvExtension: 'none', assets: { runtime: payload } }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  const executable = join(output, 'vibe-runner');
  await copyFile(process.execPath, executable);
  await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  await chmod(executable, 0o755);
  const archive = `vibe-runner-${version}-linux-x64.tar.gz`;
  execFileSync('tar', ['-czf', join(output, archive), '-C', output, 'vibe-runner']);
  await copyFile(join(root, 'scripts/install-runtime.sh'), join(output, 'install-runtime.sh'));
  const sums = [];
  for (const name of [archive, 'install-runtime.sh']) sums.push(`${createHash('sha256').update(await readFile(join(output, name))).digest('hex')}  ${name}`);
  await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  await rm(staging, { recursive: true, force: true });
  return executable;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRuntime({ version: process.argv[2] ?? 'v0.0.0-dev' });
}
