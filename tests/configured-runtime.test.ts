import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Entrant } from '../packages/contracts/src/configured-runs.ts';
import { TaskDefinition, TaskKind } from '../packages/contracts/src/suites.ts';
import { TaskIO, RunAssignment } from '../packages/contracts/src/work.ts';
import { RuntimeId } from '../packages/contracts/src/runtime.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';
import { createWorkspace, prepareMaterials, safeFile, git, executionEnvironment } from '../apps/runner/src/materials.ts';
import { collectResults } from '../apps/runner/src/artifacts.ts';
import { executeAdapter } from '../apps/runner/src/adapters.ts';
import { runWorkerOnce } from '../apps/runner/src/execution.ts';
const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(),'configured-runtime-')); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path,{recursive:true,force:true}))); });
async function repository(directory: string) {
  const source = join(directory,'repo'); await mkdir(source); await git(['init','-b','main'],source,directory);
  await writeFile(join(source,'index.html'),'<button onclick="document.querySelector(\'#count\').textContent=\'1\'">Go</button><span id="count">0</span>');
  await writeFile(join(source,'old.txt'),'original');
  await git(['add','.'],source,directory); await git(['-c','user.email=test@example.com','-c','user.name=Test','commit','-m','initial'],source,directory);
  return source;
}
test('pins one commit and gives each attempt independent files while refusing escaping artifacts',async () => {
  const directory = await root(); const source = await repository(directory);
  const materials = await prepareMaterials({kind:'repository',url:source,requestedRef:'main'},join(directory,'materials'));
  await writeFile(join(source,'old.txt'),'new source'); await git(['-c','user.email=test@example.com','-c','user.name=Test','commit','-am','moved'],source,directory);
  const first = join(directory,'first'); const second = join(directory,'second');
  await createWorkspace(materials,first,directory); await writeFile(join(first,'old.txt'),'attempt mutation'); await createWorkspace(materials,second,directory);
  expect((await readFile(join(second,'old.txt'),'utf8'))).toBe('original');
  await symlink(source,join(second,'escape')); await expect(safeFile(second,'escape/old.txt')).rejects.toThrow('Symbolic');
  await expect(safeFile(second,'../old.txt')).rejects.toThrow(); await expect(safeFile(second,'.git/config')).rejects.toThrow(); await expect(safeFile(second,'.env')).rejects.toThrow();
  const env = executionEnvironment(); expect(env.VIBE_RUNNER_TOKEN).toBeUndefined(); expect(env.VIBE_API_URL).toBeUndefined();
});
for (const harness of ['codex','claude','opencode'] as const) test(`parses real fixture subprocess final output for ${harness}`,async () => {
  const directory = await root(); const workspace = join(directory,'workspace'); await mkdir(workspace);
  const entrant = Entrant.parse({id:randomUUID(),harness,model:'exact-model',settings:{timeoutMs:5000,...(harness === 'codex' ? {reasoningEffort:'high'} : harness === 'claude' ? {effort:'high'} : {variant:'high'})}});
  const result = await executeAdapter({entrant,executable:process.execPath,prefix:[fileURLToPath(new URL('./fixtures/configured-harness.mjs',import.meta.url)),harness],workspace,directory,prompt:`ASSERT_ARGS: ${JSON.stringify(['exact-model',harness === 'codex' ? 'model_reasoning_effort="high"' : 'high'])}`,writable:false});
  expect(result.text).toBe('Fixture final answer'); expect(await readFile(join(directory,'stdout.log'),'utf8')).toContain(harness === 'claude' ? 'modelUsage' : harness === 'codex' ? 'turn.completed' : 'step_finish');
});
test('all ten task kinds produce real bounded artifacts including Chromium video and code changes',async () => {
  const directory = await root(); const source = await repository(directory); const materials = await prepareMaterials({kind:'repository',url:source,requestedRef:'main'},join(directory,'materials'));
  for (const kind of TaskKind.options) {
    const task = TaskDefinition.parse({id:randomUUID(),title:kind,kind,prompt:'Fixture',criterionIds:[]});
    const attempt = join(directory,kind); await mkdir(attempt); const workspace = join(attempt,'workspace'); await createWorkspace(materials,workspace,attempt);
    if (kind === 'image-understanding' || kind === 'image-editing') await writeFile(join(workspace,'input.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=','base64'));
    const io = TaskIO.parse({inputs:kind === 'image-understanding' || kind === 'image-editing' ? ['input.png'] : [],outputs:kind.startsWith('image-') && kind !== 'image-understanding' ? [{path:'output.png',kind:'image'}] : kind.startsWith('html-') ? [{path:'output.html',kind:'html'}] : kind.startsWith('coding-') ? [{path:'new.ts',kind:'code'}] : [],browser:kind === 'browser-scenario' ? {kind:'local',entry:'index.html',instructions:'Click Go and see 1'} : null});
    const entrant = Entrant.parse({id:randomUUID(),harness:'codex',model:'fixture',settings:{timeoutMs:10000}});
    const adapter = await executeAdapter({entrant,executable:process.execPath,prefix:[fileURLToPath(new URL('./fixtures/configured-harness.mjs',import.meta.url)),'codex'],workspace,directory:attempt,images:io.inputs.map((path) => join(workspace,path)),prompt:`Task kind: ${kind}\nTask IO: ${JSON.stringify(io)}`,writable:true});
    if (kind.startsWith('coding-')) { await rm(join(workspace,'old.txt')); await writeFile(join(workspace,'index.html'),'modified'); }
    const output = await collectResults({task,io,workspace,directory:attempt,materials,text:adapter.text,timeoutMs:10000});
    expect(output.artifacts.length).toBeGreaterThan(0);
    if (output.result.kind === 'browser') { const recordingId = output.result.recordingArtifactId; expect(output.artifacts.find((item) => item.id === recordingId)?.mediaType).toBe('video/webm'); expect(output.artifacts.some((item) => item.name.endsWith('trace.zip'))).toBe(true); }
    if (output.result.kind === 'code') expect(output.result.changedFiles).toEqual(expect.arrayContaining([{path:'old.txt',change:'deleted'},{path:'new.ts',change:'added'},{path:'index.html',change:'modified'}]));
  }
},30000);
test('worker durably retries a lost terminal response and does not launch the attempt twice',async () => {
  const directory = await root(); const runtimeId = RuntimeId.parse(randomUUID()); const taskId = randomUUID(); const entrantId = randomUUID();
  const definition = {title:'suite',description:'',categories:[{id:randomUUID(),title:'category',tasks:[{id:taskId,title:'text',kind:'text-generation',prompt:'Hello',criterionIds:[]}]}],evaluation:{conversion:'rating-control-v1',criteria:[],rankingRules:[]},materials:{kind:'none'}};
  const content = {schemaVersion:1,suiteId:randomUUID(),contentId:randomUUID(),revision:1,ordinal:1,createdAt:new Date().toISOString(),definition,digest:contentDigest({schemaVersion:1,definition})};
  const snapshot = {protocol:1,content,runtimeId,selectedTaskIds:[taskId],entrants:[{id:entrantId,harness:'codex',model:'fixture',settings:{timeoutMs:5000}}],source:'fixture'};
  const assignment = RunAssignment.parse({kind:'assigned',requestId:randomUUID(),assignmentId:randomUUID(),runId:randomUUID(),snapshot:{...snapshot,digest:contentDigest(snapshot)},attempts:[{attemptId:randomUUID(),taskId,entrantId,ordinal:0}]});
  let starts = 0; let terminals = 0; let lost = false;
  const server = createServer((request,response) => { void (async () => { const chunks=[]; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body=JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('content-type','application/json');
    if (request.url === '/api/worker/claims') response.end(JSON.stringify({...assignment,requestId:body.requestId}));
    else { if (body.kind === 'started') starts++; if (body.kind === 'terminal') {terminals++; if (!lost) {lost=true; request.socket.destroy(); return;} } response.end(JSON.stringify({reportId:body.reportId,runId:body.runId,acceptedAt:'2026-10-01T00:00:00.000Z'})); }
  })(); });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve)); const address=server.address(); if (!address || typeof address === 'string') throw new Error('address');
  try { const options={apiUrl:`http://127.0.0.1:${address.port}`,stateRoot:directory,runtimeId,executables:{}}; await expect(runWorkerOnce(options)).rejects.toThrow(); expect(await runWorkerOnce(options)).toEqual({kind:'finished',runId:assignment.runId}); expect(starts).toBe(1); expect(terminals).toBe(2); const interruptedRoot = await root(); const attemptDirectory = join(interruptedRoot,'work',assignment.runId,assignment.attempts.map((attempt) => attempt.attemptId)[0] ?? 'invalid'); await mkdir(attemptDirectory,{recursive:true}); await writeFile(join(attemptDirectory,'started.json'),'{}'); await runWorkerOnce({...options,stateRoot:interruptedRoot}); const terminal = JSON.parse(await readFile(join(attemptDirectory,'terminal.json'),'utf8')); expect(terminal.outcome.kind).toBe('failed'); expect(terminal.outcome.reason).toContain('not relaunched'); expect(starts).toBe(1); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
for (const harness of ['codex','claude','opencode'] as const) for (const failure of ['FIXTURE_FAIL','FIXTURE_MALFORMED','FIXTURE_NO_TERMINAL']) test(`${harness} rejects ${failure}`,async () => {
  const directory = await root(); const entrant = Entrant.parse({id:randomUUID(),harness,model:'exact',settings:{timeoutMs:5000}});
  await expect(executeAdapter({entrant,executable:process.execPath,prefix:[fileURLToPath(new URL('./fixtures/configured-harness.mjs',import.meta.url)),harness],workspace:directory,directory,prompt:failure,writable:false})).rejects.toThrow();
  expect((await readFile(join(directory,'stdout.log'),'utf8')).length + (await readFile(join(directory,'stderr.log'),'utf8')).length).toBeGreaterThan(0);
});
test('required outputs reject absence, escaping symlinks, invalid raster data and failed browser assertions',async () => {
  const directory=await root(); const workspace=join(directory,'workspace'); await mkdir(workspace);
  const task=TaskDefinition.parse({id:randomUUID(),title:'image',kind:'image-generation',prompt:'image',criterionIds:[]});
  const io=TaskIO.parse({inputs:[],outputs:[{path:'output.png',kind:'image'}],browser:null});
  const args={task,io,workspace,directory,materials:{kind:'none'} as const,text:'done',timeoutMs:5000};
  await expect(collectResults(args)).rejects.toThrow();
  await writeFile(join(workspace,'output.png'),'not an image'); await expect(collectResults(args)).rejects.toThrow('raster');
  await rm(join(workspace,'output.png')); await symlink('/etc/passwd',join(workspace,'output.png')); await expect(collectResults(args)).rejects.toThrow('Symbolic');
  await writeFile(join(workspace,'index.html'),'<h1>Actual</h1>');
  await expect(collectResults({...args,task:{...task,kind:'browser-scenario'},io:{inputs:[],outputs:[],browser:{kind:'local',entry:'index.html',instructions:'check text'}},text:JSON.stringify({steps:[{kind:'expect-text',selector:'h1',text:'Wrong'}]})})).rejects.toThrow('assertion');
});
test('HTML bundle includes referenced local assets and refuses broken references',async () => {
  const directory=await root(); await writeFile(join(directory,'index.html'),'<html><link href="style.css"><script src="app.js"></script></html>'); await writeFile(join(directory,'style.css'),'body { color: red; }'); await writeFile(join(directory,'app.js'),'document.title = "ready";');
  const task=TaskDefinition.parse({id:randomUUID(),title:'HTML',kind:'html-interactive',prompt:'page',criterionIds:[]}); const io=TaskIO.parse({inputs:[],outputs:[{path:'index.html',kind:'html'}],browser:null});
  const options={task,io,workspace:directory,directory,materials:{kind:'none'} as const,text:'done',timeoutMs:5000};
  const result=await collectResults(options); expect(result.artifacts.map((item) => item.name).sort()).toEqual(['app.js','index.html','style.css']);
  await rm(join(directory,'app.js')); await expect(collectResults(options)).rejects.toThrow();
});
