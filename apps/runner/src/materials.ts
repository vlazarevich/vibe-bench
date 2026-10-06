import { checkExecutable } from './executables.ts';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { contentDigest } from '../../../packages/contracts/src/canonical.ts';
import { Materials } from '../../../packages/contracts/src/suites.ts';
import { runProcess, readBounded } from './processes/run.ts';
import { durableWrite } from './spool.ts';

export const SafePath = z.string().min(1).max(500).refine((value) => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !/^(\.git|\.env(?:\..*)?|\.aws|\.ssh|\.codex|\.claude|credentials?|auth\.json)$/i.test(part)), 'Unsafe material path');
import { RepositoryManifest as MaterialManifest } from '../../../packages/contracts/src/work.ts';
export { TaskIO } from '../../../packages/contracts/src/work.ts';
export const PreparedMaterials = z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('repository'), commit: z.string().regex(/^[a-f0-9]{40,64}$/), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/), manifest: MaterialManifest, repository: z.string() }).strict()]);
export type PreparedMaterials = z.infer<typeof PreparedMaterials>;
export function executionEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VIBE_')));
}
export async function git(args: string[], cwd: string, diagnostics: string) {
  const directory = join(diagnostics, randomUUID());
  await mkdir(directory, { recursive: true });
  const result = await runProcess({ executable: await checkExecutable('git'), args: ['-c', 'core.hooksPath=/dev/null', ...args], cwd, directory, input: '', timeoutMs: 60_000, env: { ...executionEnvironment(), GIT_TERMINAL_PROMPT: '0' } });
  if (result.kind !== 'exited' || result.code !== 0) throw new Error('Repository operation failed. See local Git diagnostics.');
  return readBounded(join(directory, 'stdout.log'), 500_000);
}
export async function safeFile(root: string, name: string, limit = 8_000_000) {
  SafePath.parse(name);
  let path = root;
  for (const part of name.split('/')) { path = join(path, part); if ((await lstat(path)).isSymbolicLink()) throw new Error('Symbolic links are not allowed in task material'); }
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('Material is not a bounded regular file');
  return readFile(path);
}
export async function prepareMaterials(materials: z.infer<typeof Materials>, directory: string): Promise<PreparedMaterials> {
  await mkdir(directory, { recursive: true });
  const saved = join(directory, 'prepared.json');
  try { return PreparedMaterials.parse(JSON.parse(await readFile(saved, 'utf8'))); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (materials.kind === 'none') { const prepared = PreparedMaterials.parse({ kind: 'none' }); await durableWrite(saved, prepared, 'create'); return prepared; }
  const repository = join(directory, `source-${randomUUID()}`);
  await git(['clone', '--no-checkout', '--', materials.url, repository], directory, directory);
  const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${materials.requestedRef}^{commit}`], repository, directory)).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Repository ref did not resolve to one commit');
  await git(['checkout', '--detach', commit], repository, directory);
  let manifestBytes: Buffer;
  try { manifestBytes = await safeFile(repository, 'vibe-bench.json', 200_000); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; manifestBytes = Buffer.from('{"version":1,"tasks":{}}'); }
  await validateMaterialTree(repository);
  const prepared = PreparedMaterials.parse({ kind: 'repository', repository, commit, manifestDigest: contentDigest(MaterialManifest.parse(JSON.parse(manifestBytes.toString('utf8')))), manifest: MaterialManifest.parse(JSON.parse(manifestBytes.toString('utf8'))) });
  await durableWrite(saved, prepared, 'create');
  return prepared;
}
export async function createWorkspace(materials: PreparedMaterials, workspace: string, diagnostics: string) {
  if (materials.kind === 'none') { await mkdir(workspace, { recursive: false }); return; }
  await git(['clone', '--no-hardlinks', '--no-checkout', '--', materials.repository, workspace], diagnostics, diagnostics);
  await git(['checkout', '--detach', materials.commit], workspace, diagnostics);
}
async function validateMaterialTree(source: string) {
  let count = 0; let bytes = 0;
  async function visit(relative: string) {
    for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
      if (entry.name === '.git' && !relative) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      SafePath.parse(name);
      if (entry.isDirectory()) await visit(name);
      else { const content = await safeFile(source, name); count++; bytes += content.length; if (count > 1000 || bytes > 32_000_000) throw new Error('Material bundle exceeds limit'); }
    }
  }
  await visit('');
}
