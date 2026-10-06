import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { checkBoundaries } from '../scripts/check-boundaries.ts';

test('import boundaries inspect every loading syntax and resolve module ownership', async () => {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/boundaries-'));
  for (const directory of ['apps/web/src', 'apps/server/src', 'apps/runner/src', 'packages/contracts/src']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', paths: { '@server/*': ['./apps/server/src/*'] } } }));
  await writeFile(join(root, 'apps/server/src/private.ts'), 'export const secret = 1;');
  await writeFile(join(root, 'apps/web/src/server-status.ts'), 'export const status = 1;');
  for (const name of ['blind-grading', 'suites', 'work', 'runtime']) await writeFile(join(root, `packages/contracts/src/${name}.ts`), 'export const schema = 1;');
  const imports = [
    "import '../../server/src/private.ts';",
    "export * from '../../server/src/private.ts';",
    "async function load() { return import('../../server/src/private.ts'); }",
    "type Private = typeof import('../../server/src/private.ts');",
    "const privateCode = require('../../server/src/private.ts');",
    "import privateCode = require('../../server/src/private.ts');",
    "import '@server/private';",
    "import '../../web/../server/src/private.js';",
    "import '../../server/src/missing.ts';",
    "import '../../../packages/contracts/src/work.ts';",
    "const path = './dynamic'; import(path);",
    "import './server-status.ts';",
    "import '../../../packages/contracts/src/suites.ts';",
    "import '../../../packages/contracts/src/blind-grading.ts';",
  ];
  await writeFile(join(root, 'apps/web/src/entry.ts'), imports.join('\n'));
  await writeFile(join(root, 'apps/runner/src/entry.ts'), "import 'pg'; import 'pg/lib/client'; import '../../../packages/contracts/src/blind-grading.ts';");
  await writeFile(join(root, 'packages/contracts/src/private.ts'), "export * from '../../../apps/server/src/private.ts';");
  const violations = await checkBoundaries(root);
  expect(violations.filter((item) => item.owner === 'apps/web/src/entry.ts').map((item) => item.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(violations.filter((item) => item.owner === 'apps/runner/src/entry.ts')).toHaveLength(3);
  expect(violations.filter((item) => item.owner.startsWith('packages/'))).toHaveLength(1);
});
