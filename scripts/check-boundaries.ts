import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type Violation = { owner: string; target: string; line: number };

export async function checkBoundaries(root: string): Promise<Violation[]> {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const options = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath)).options : { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const violations: Violation[] = [];
  for (const directory of ['apps', 'packages']) {
    for (const entry of await readdir(resolve(root, directory), { recursive: true })) {
      if (!/\.tsx?$/.test(entry)) continue;
      const file = resolve(root, directory, entry);
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const owner = relative(root, file);
      function inspect(node: ts.Node, specifier: ts.Node | undefined) {
        const target = specifier && ts.isStringLiteralLike(specifier) ? specifier.text : null;
        const resolved = target ? ts.resolveModuleName(target, file, options, ts.sys).resolvedModule : undefined;
        const path = resolved?.resolvedFileName ?? (target && (target.startsWith('.') || isAbsolute(target)) ? resolve(dirname(file), target) : undefined);
        const destination = path ? relative(root, path) : '';
        const application = destination.startsWith('apps/');
        const contracts = destination.startsWith('packages/contracts/');
        const forbidden = target === null || (owner.startsWith('apps/web/')
          ? application && !destination.startsWith('apps/web/') || contracts && !['packages/contracts/src/evaluation.ts', 'packages/contracts/src/suites.ts'].includes(destination)
          : owner.startsWith('apps/server/')
            ? application && !destination.startsWith('apps/server/')
            : owner.startsWith('apps/runner/')
              ? application && !destination.startsWith('apps/runner/') || destination === 'packages/contracts/src/evaluation.ts' || target === 'pg' || target.startsWith('pg/') || resolved?.packageId?.name === '@types/pg'
              : application);
        if (forbidden) violations.push({ owner, target: target ?? '<nonliteral module>', line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
      function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) inspect(node, node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) inspect(node, node.argument.literal);
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) inspect(node, node.moduleReference.expression);
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) inspect(node, node.arguments[0]);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkBoundaries(process.cwd());
  for (const { owner, target, line } of violations) process.stderr.write(`${owner}:${line} cannot import ${target}\n`);
  if (violations.length > 0) process.exitCode = 1;
  else process.stdout.write('Application import boundaries passed.\n');
}
