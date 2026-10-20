import { build } from 'esbuild';
import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vercelConfig } from './vercel-config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Vercel Build Output API: all routes retain the application's access and preview policies. */
export async function buildVercel({ output = join(root, '.vercel/output'), web = join(root, 'dist/web') } = {}) {
  await access(join(web, 'index.html'));
  output = resolve(output);
  const functionRoot = join(output, 'functions/dashboard.func');
  await rm(output, { recursive: true, force: true });
  await mkdir(functionRoot, { recursive: true });
  await build({
    entryPoints: [join(root, 'scripts/vercel-handler.ts')], outfile: join(functionRoot, 'index.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    define: { __VIBE_BUNDLED__: 'true' }, external: ['pg-native'],
    banner: { js: "import { createRequire as __vibeCreateRequire } from 'node:module'; const require = __vibeCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  await cp(join(root, 'db/migrations'), join(functionRoot, 'migrations'), { recursive: true });
  await cp(web, join(functionRoot, 'web'), { recursive: true });
  await writeFile(join(functionRoot, '.vc-config.json'), JSON.stringify({
    runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs',
    shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60,
  }, null, 2) + '\n');
  await writeFile(join(output, 'config.json'), JSON.stringify({ version: 3,
    routes: [{ src: '/(.*)', dest: '/dashboard' }],
  }, null, 2) + '\n');
  return functionRoot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.VERCEL === '1') vercelConfig();
  process.stdout.write(`Built Vercel function at ${await buildVercel()}\n`);
}
