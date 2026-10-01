import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { chromium } from '@playwright/test';
import { ArtifactMetadata, type ResultDescriptor } from '../../../packages/contracts/src/configured-runs.ts';
import { InlineArtifact, type TaskIO } from '../../../packages/contracts/src/work.ts';
import { TaskDefinition } from '../../../packages/contracts/src/suites.ts';
import { safeFile, git, type PreparedMaterials } from './materials.ts';
import { BrowserPlan, runBrowserScenario } from './browser-scenario.ts';

export function artifact(name: string, kind: z.infer<typeof ArtifactMetadata>['kind'], mediaType: string, bytes: Buffer): z.infer<typeof InlineArtifact> { return InlineArtifact.parse({ id: randomUUID(), name, kind, mediaType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }); }
export function metadata(artifacts: z.infer<typeof InlineArtifact>[]) { return artifacts.map(({ base64: _, ...entry }) => entry); }
export async function diagnostics(directory: string) {
  const artifacts: z.infer<typeof InlineArtifact>[] = [];
  for (const name of ['stdout.log', 'stderr.log']) {
    try { const bytes = await readFile(join(directory, name)); artifacts.push(artifact(`diagnostics/${name}`, 'diagnostic', 'text/plain', bytes.subarray(0, 1_000_000))); } catch {}
  }
  return artifacts;
}
export async function imageType(bytes: Buffer) {
  let mediaType: string;
  if (bytes.length > 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mediaType = 'image/png';
  else if (bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') mediaType = 'image/webp';
  else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) mediaType = 'image/jpeg';
  else throw new Error('Required image is not a supported raster image');
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const dimensions = await page.evaluate(async (url) => { const image = new Image(); image.src = url; await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight}; },`data:${mediaType};base64,${bytes.toString('base64')}`);
    if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 40_000_000) throw new Error('Image dimensions exceed limit');
  } finally { await browser.close(); }
  return mediaType;
}
export async function declaredArtifacts(io: TaskIO, workspace: string) {
  const artifacts = [];
  for (const output of io.outputs) {
    const bytes = await safeFile(workspace,output.path);
    const mediaType = output.kind === 'image' ? await imageType(bytes) : output.kind === 'html' ? 'text/html' : extname(output.path) === '.css' ? 'text/css' : extname(output.path) === '.js' ? 'text/javascript' : 'text/plain';
    artifacts.push(artifact(output.path,output.kind,mediaType,bytes));
  }
  return artifacts;
}
export async function collectResults({ task, io, workspace, directory, materials, text, timeoutMs }: { task: z.infer<typeof TaskDefinition>; io: TaskIO; workspace: string; directory: string; materials: PreparedMaterials; text: string; timeoutMs: number }) {
  const artifacts: z.infer<typeof InlineArtifact>[] = [];
  let result: ResultDescriptor;
  const file = async (path: string, kind: z.infer<typeof ArtifactMetadata>['kind'], mediaType: string) => { const item = artifact(path, kind, mediaType, await safeFile(workspace,path)); artifacts.push(item); return item; };
  switch (task.kind) {
    case 'text-generation': case 'text-editing': case 'image-understanding': artifacts.push(artifact('answer.txt','text','text/plain',Buffer.from(text))); result = { kind:'text' }; break;
    case 'image-generation': case 'image-editing': {
      const outputs = io.outputs.filter((item) => item.kind === 'image'); if (!outputs.length) throw new Error('Task requires declared image outputs');
      for (const output of outputs) { const bytes = await safeFile(workspace,output.path); artifacts.push(artifact(output.path,'image',await imageType(bytes),bytes)); }
      result = {kind:'image',artifactIds:artifacts.map((item) => item.id)}; break;
    }
    case 'html-static': case 'html-interactive': {
      const entry = io.outputs.find((item) => item.kind === 'html'); if (!entry) throw new Error('Task requires a declared HTML entry');
      const entryArtifact = await file(entry.path,'html','text/html');
      const html = Buffer.from(entryArtifact.base64,'base64').toString('utf8'); if (!/<(?:!doctype|html|body|main|div|h1)\b/i.test(html)) throw new Error('HTML entry is not HTML');
      for (const output of await declaredArtifacts(io,workspace)) if (output.name !== entry.path) artifacts.push(output);
      result = {kind:'html',entryArtifactId:entryArtifact.id,assetArtifactIds:artifacts.filter((item) => item.id !== entryArtifact.id).map((item) => item.id)}; break;
    }
    case 'coding-bugfix': case 'coding-feature': {
      if (materials.kind !== 'repository') throw new Error('Coding tasks require repository materials');
      const changes = (await git(['diff','--name-status','--no-renames',materials.commit,'--'],workspace,directory)).trim().split('\n').filter(Boolean).map((line) => { const [status,...parts] = line.split('\t'); return {path:parts.join('\t'),change:status === 'D' ? 'deleted' : 'modified'}; });
      const untracked = (await git(['ls-files','--others','--exclude-standard','-z'],workspace,directory)).split('\0').filter(Boolean);
      const changedFiles = z.array(z.object({path:z.string(),change:z.enum(['added','modified','deleted'])})).parse([...changes,...untracked.map((path) => ({path,change:'added'}))]);
      if (untracked.length) await git(['add','--intent-to-add','--',...untracked],workspace,directory);
      const patch = await git(['diff','--binary',materials.commit,'--'],workspace,directory);
      const patchArtifact = artifact('changes.patch','code','text/x-diff',Buffer.from(patch)); artifacts.push(patchArtifact);
      for (const change of changedFiles) if (change.change !== 'deleted') await file(change.path,'code','application/octet-stream');
      result = {kind:'code',patchArtifactId:patchArtifact.id,changedFiles}; break;
    }
    case 'browser-scenario': {
      if (!io.browser) throw new Error('Browser scenario requires a starting context');
      const plan = BrowserPlan.parse(JSON.parse(text));
      const recording = await runBrowserScenario({workspace,directory:join(directory,'browser'),browser:io.browser,plan,timeoutMs});
      const video = artifact('browser/recording.webm','recording','video/webm',await readFile(recording.video)); artifacts.push(video,artifact('browser/trace.zip','diagnostic','application/zip',await readFile(recording.trace)));
      const screenshots = [];
      for (const step of plan.steps) if (step.kind === 'screenshot') {const item = artifact(`browser/${step.path}`,'image','image/png',await safeFile(join(directory,'browser'),step.path)); artifacts.push(item); screenshots.push(item.id);}
      result = {kind:'browser',recordingArtifactId:video.id,format:'webm',screenshotArtifactIds:screenshots}; break;
    }
  }
  for (const output of await declaredArtifacts(io,workspace)) if (!artifacts.some((item) => item.name === output.name)) artifacts.push(output);
  if (new Set(artifacts.map((item) => item.name)).size !== artifacts.length) throw new Error('Artifact names must be unique');
  if (artifacts.length > 30 || artifacts.reduce((sum,item) => sum+item.bytes,0) > 6_000_000) throw new Error('Result bundle exceeds limit');
  return {artifacts,result};
}
