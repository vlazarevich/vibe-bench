import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundles the dashboard process into `output` with migrations beside it. Expects built web assets at `output/../web`. */
export async function buildServer({ output = join(root, 'dist/server') } = {}) {
  output = resolve(output);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      serve: join(root, 'scripts/serve.ts'),
      migrate: join(root, 'scripts/migrate.ts'),
      'database-worker': join(root, 'scripts/database-worker.ts'),
    },
    outdir: output,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    define: { __VIBE_BUNDLED__: 'true' },
    // Native binaries and the browser driver stay installed packages; the CJS shim lets bundled dependencies call require.
    external: ['embedded-postgres', '@embedded-postgres/*', '@playwright/test', 'playwright', 'playwright-core', 'pg-native'],
    banner: { js: "import { createRequire as __vibeCreateRequire } from 'node:module'; const require = __vibeCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  await cp(join(root, 'db/migrations'), join(output, 'migrations'), { recursive: true });
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`Built ${await buildServer()}\n`);
}
