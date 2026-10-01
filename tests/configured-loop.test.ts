import { afterAll, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
import { durableWrite } from '../apps/runner/src/spool.ts';
import { runWorkerOnce } from '../apps/runner/src/execution.ts';
import { ConfiguredRunView, RunPreview } from '../packages/contracts/src/configured-runs.ts';
import { ToolName } from '../packages/contracts/src/runtime.ts';
import { SuiteView, TaskKind } from '../packages/contracts/src/suites.ts';
import { RepositoryManifest, SafeRelativePath } from '../packages/contracts/src/task-io.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';

const exec = promisify(execFile);
let database: Awaited<ReturnType<typeof startDatabase>> | undefined;
let pool: Awaited<ReturnType<typeof connectDatabase>> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let worker: ReturnType<typeof createWorkerApp> | undefined;
const repositoryServer = createServer((request, response) => { void (async () => {
  try { const path = SafeRelativePath.parse(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).slice(1)); response.end(await readFile(join(repositoryRoot, path))); }
  catch { response.statusCode = 404; response.end(); }
})(); });
let repositoryRoot = '';
afterAll(async () => { await worker?.close(); await app?.close(); await pool?.end(); await database?.stop(); if (repositoryServer.listening) await new Promise<void>((done) => repositoryServer.close(() => done())); });

test('configured worker persists every task kind across HTTP and PostgreSQL, retains mixed outcomes and reopens pinned inputs', async () => {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/configured-loop-'));
  repositoryRoot = join(root, 'remote'); await mkdir(repositoryRoot);
  const source = join(root, 'source'); await mkdir(source);
  const criterion = randomUUID();
  const tasks = TaskKind.options.map((kind) => ({ id: randomUUID(), title: kind, kind, prompt: 'Produce the requested fixture output.', criterionIds: [criterion] }));
  const failedTask = { id: randomUUID(), title: 'Failure retains diagnostics', kind: 'text-generation', prompt: 'FIXTURE_FAIL', criterionIds: [criterion] };
  const skippedTask = { id: randomUUID(), title: 'Browser context unavailable', kind: 'browser-scenario', prompt: 'Use a missing browser context.', criterionIds: [criterion] };
  const manifest = RepositoryManifest.parse({version:1,tasks:Object.fromEntries(tasks.map((task) => [task.id, {
    inputs: ['image-editing','image-understanding'].includes(task.kind) ? ['input.png'] : task.kind === 'text-editing' ? ['input.txt'] : [],
    outputs: ['image-generation','image-editing'].includes(task.kind) ? [{path:'output.png',kind:'image'}] : task.kind.startsWith('html-') ? [{path:'output.html',kind:'html'}] : task.kind.startsWith('coding-') ? [{path:'new.ts',kind:'code'}] : [],
    browser: task.kind === 'browser-scenario' ? {kind:'local',entry:'index.html',instructions:'Click Go and check count is 1.'} : null,
  }]))});
  await writeFile(join(source, 'vibe-bench.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'input.txt'), 'Original text.');
  await writeFile(join(source, 'input.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=', 'base64'));
  await writeFile(join(source, 'index.html'), '<button onclick="document.querySelector(\'#count\').textContent=\'1\'">Go</button><span id="count">0</span>');
  await exec('git',['init','-b','main'],{cwd:source});
  await exec('git',['add','.'],{cwd:source});
  await exec('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','Pinned materials'],{cwd:source});
  const commit = (await exec('git',['rev-parse','HEAD'],{cwd:source})).stdout.trim();
  await exec('git',['clone','--bare',source,join(repositoryRoot,'repo.git')]);
  await exec('git',['update-server-info'],{cwd:join(repositoryRoot,'repo.git')});
  await new Promise<void>((done) => repositoryServer.listen(0,'127.0.0.1',done));
  const address = repositoryServer.address(); if (!address || typeof address === 'string') throw new Error('Repository server did not bind');
  database = await startDatabase(join(root,'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({pool,token:'test-only'}); worker = createWorkerApp({pool});
  const url = await app.listen({host:'127.0.0.1',port:0}); const workerUrl = await worker.listen({host:'127.0.0.1',port:0});
  async function post(path: string, body: unknown, endpoint=url) {
    const response = await fetch(endpoint+path,{method:'POST',headers:{'content-type':'application/json',...(endpoint===url ? {origin:url} : {authorization:runtimeAuthorization(configuration)})},body:JSON.stringify(body)});
    const value: unknown = await response.json(); expect(response.status, JSON.stringify(value)).toBe(200); return value;
  }
  const configuration={...await enrollRuntime(url),apiUrl:workerUrl}; const runtimeId=configuration.runtimeId;
  await post('/api/worker/registrations',{protocol:1,runtimeId,observation:1,observedAt:new Date().toISOString(),capacity:{slots:1},machine:{platform:'linux',architecture:'x64',logicalCpus:2,memoryBytes:1024},tools:ToolName.options.map(name=>({name,availability:{kind:'available',version:'1.0.0'}})),harnesses:{codex:{kind:'ready'},claude:{kind:'ready'},opencodeGo:{kind:'ready'}},modelPolicy:'provider-discovered-at-execution'},workerUrl);
  const definition={title:'All configured outputs',description:'Fixture integration evidence',categories:[{id:randomUUID(),title:'Tasks',tasks:[...tasks,failedTask,skippedTask]}],evaluation:{conversion:'rating-control-v1',criteria:[{id:criterion,title:'Clarity',instructions:'Prefer clear outputs.',control:'stars-5'}],rankingRules:[]},materials:{kind:'repository',url:`http://127.0.0.1:${address.port}/repo.git`,requestedRef:'main'}};
  const suite=SuiteView.parse(await post('/api/suites',{definition}));
  const config={contentId:suite.content.contentId,runtimeId,selection:{kind:'all'},source:'fixture',entrants:['codex','claude','opencode'].map(harness=>({id:randomUUID(),harness,model:'exact-fixture-model',settings:{timeoutMs:15000}}))};
  const preview=RunPreview.parse(await post('/api/configured-runs/preview',config)); expect(preview.matrix).toHaveLength(36);
  const run=ConfiguredRunView.parse(await post('/api/configured-runs',{...config,requestId:randomUUID()}));
  await post(`/api/suites/${suite.content.suiteId}`,{expectedContentId:suite.content.contentId,change:'minor',definition:{...definition,title:'Later edited title'}});
  const options={configuration,stateRoot:join(root,'runtime'),executables:{}};
  await durableWrite(join(options.stateRoot,'config.json'),configuration);
  const workOnce = async () => process.env.VIBE_RUNTIME_BINARY ? JSON.parse((await exec(process.env.VIBE_RUNTIME_BINARY,['work','--once'],{env:{...process.env,VIBE_RUNTIME_STATE:options.stateRoot},maxBuffer:1000000})).stdout.trim().split('\n').at(-1) ?? '{}') : runWorkerOnce(options);
  expect(await workOnce()).toEqual({kind:'finished',runId:run.runId});
  const result=ConfiguredRunView.parse(await (await fetch(url+`/api/configured-runs/${run.runId}`)).json());
  expect(result.status).toBe('finished'); expect(result.snapshot).toEqual(run.snapshot);
  expect(result.preparation).toEqual({kind:'repository',commit,manifestDigest:contentDigest(manifest),manifest});
  const states=result.attempts.map(attempt=>attempt.state);
  expect(states.filter(state=>state.kind==='terminal' && state.outcome.kind==='completed')).toHaveLength(30);
  expect(states.filter(state=>state.kind==='terminal' && state.outcome.kind==='failed')).toHaveLength(3);
  expect(states.filter(state=>state.kind==='terminal' && state.outcome.kind==='skipped')).toHaveLength(3);
  for (const state of states) {
    if(state.kind!=='terminal')throw new Error('Attempt did not finish');
    for(const artifact of state.outcome.artifacts){
      const response=await fetch(url+`/api/configured-runs/${run.runId}/artifacts/${artifact.id}`);
      expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toContain('attachment');
      const bytes=Buffer.from(await response.arrayBuffer());expect(bytes.length).toBe(artifact.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }
  }
  expect(await workOnce()).toEqual({kind:'idle'});
  await worker.close();await app.close();await pool.end();await database.stop();
  database=await startDatabase(join(root,'postgres'));pool=await connectDatabase(database.url);app=await createApp({pool,token:'test-only'});
  const restartedUrl=await app.listen({host:'127.0.0.1',port:0});
  expect(await (await fetch(restartedUrl+`/api/configured-runs/${run.runId}`)).json()).toEqual(result);
},60000);
