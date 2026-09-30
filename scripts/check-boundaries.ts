import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
const root = process.cwd();
let violations = 0;
for (const directory of ['apps', 'packages']) {
  for (const entry of await readdir(directory, { recursive: true })) {
    if (!/\.tsx?$/.test(entry)) continue;
    const file = resolve(directory, entry);
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const owner = relative(root, file).replaceAll('\\', '/');
    source.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const target = node.moduleSpecifier.text;
      const forbidden = owner.startsWith('apps/web/') ? /server|runner|contracts\/src\/(?!(?:evaluation|suites)\.ts$)/ : owner.startsWith('apps/server/') ? /apps\/runner|runner\/src/ : owner.startsWith('apps/runner/') ? /server|\bpg\b|evaluation/ : /apps\//;
      if (forbidden.test(target)) { process.stderr.write(`${owner} cannot import ${target}\n`); violations++; }
    });
  }
}
if (violations > 0) process.exitCode = 1;
else process.stdout.write('Application import boundaries passed.\n');
