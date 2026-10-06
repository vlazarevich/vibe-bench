const { getAsset } = require('node:sea');
const { brotliDecompressSync } = require('node:zlib');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const directory = mkdtempSync(join(tmpdir(), 'vibe-runner-'));
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
const files = JSON.parse(brotliDecompressSync(Buffer.from(getAsset('runtime'))));
for (const [name, content] of Object.entries(files)) {
  const target = join(directory, name);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, Buffer.from(content, 'base64'), { mode: 0o600 });
}
const entry = join(directory, 'apps/runner/src/cli.cjs');
const runtimeRequire = createRequire(entry);
if (process.argv[2] === '--internal-configured-fixture') {
  process.argv.splice(1, 2, join(directory, 'tests/fixtures/configured-harness.mjs'));
  import(pathToFileURL(join(directory, 'tests/fixtures/configured-harness.mjs')).href).catch(fail);
} else {
  const runner = runtimeRequire(entry);
  runner.main(process.argv.slice(2)).catch(runner.reportCliError);
}
function fail() {
  process.stderr.write('Runtime failed. Check configuration, prerequisites, and saved runtime state.\n');
  process.exitCode = 1;
}
