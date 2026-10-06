import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { RuntimeConfiguration } from '../packages/contracts/src/access.ts';
import { SuiteView } from '../packages/contracts/src/suites.ts';
import { ConfiguredRunView } from '../packages/contracts/src/configured-runs.ts';
import { definition } from './suite-fixtures.ts';
import { runtimeRoot } from '../apps/runner/src/configuration.ts';
import { runtimeAuthorization } from './runtime-auth.ts';

const exec = promisify(execFile);
let database: Awaited<ReturnType<typeof startDatabase>>, pool: Awaited<ReturnType<typeof connectDatabase>>, app: Awaited<ReturnType<typeof createApp>>, url: string, root: string;
const post = async (path: string, body: unknown) => { const response = await fetch(url + path, {method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(body)}); expect(response.status, await response.clone().text()).toBe(200); return response.json(); };
const cli = (state: string, ...args: string[]) => exec(process.execPath, ['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,...args], {env:{...process.env,PATH:'/nonexistent'},maxBuffer:1_000_000});
const config = async (state: string) => RuntimeConfiguration.parse(JSON.parse(await readFile(join(state,'config.json'),'utf8')));
const token = async () => (await post('/api/runtime-enrollments',{target:{kind:'new'}})).command.split(' ')[2];
async function createRun(runtimeId: string) { const suite = SuiteView.parse(await post('/api/suites',{definition:definition()})); return ConfiguredRunView.parse(await post('/api/configured-runs',{requestId:randomUUID(),contentId:suite.content.contentId,runtimeId,selection:{kind:'all'},source:'fixture',entrants:Array.from({length:2},()=>({id:randomUUID(),harness:'codex',model:'fixture',settings:{timeoutMs:15000}}))})); }
beforeAll(async () => { await mkdir('.artifacts',{recursive:true}); root=await mkdtemp(resolve('.artifacts/runner-cli-')); database=await startDatabase(join(root,'postgres'));pool=await connectDatabase(database.url);app=await createApp({pool});url=await app.listen({host:'127.0.0.1',port:0}); });
afterAll(async () => {await app?.close();await pool?.end();await database?.stop();});

test('unpaired commands and malformed tokens explain how to pair without exposing parser or filesystem errors', async () => {
  const state = join(root, 'unpaired-errors');
  const unpaired = 'Unpaired. Create an enrollment token in the dashboard and run vibe-runner pair TOKEN.\n';
  for (const args of [['run'], ['run-once'], ['pair', 'probe']]) {
    await expect(cli(state, ...args)).rejects.toMatchObject({ code: 1, stdout: '', stderr: unpaired });
  }
  expect(await cli(state, 'pair', 'status')).toMatchObject({ stdout: unpaired, stderr: '' });
  expect(await cli(state, 'pair', 'revoke')).toMatchObject({ stdout: 'Local pairing and runner state removed.\n', stderr: '' });
  for (const malformed of ['abc', 'invalid-token', '!', Buffer.from('{}').toString('base64url')]) {
    await expect(cli(state, 'pair', malformed)).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'Invalid enrollment token. Copy the complete token from the dashboard.\n' });
    expect(await readdir(state)).toEqual([]);
  }
});

test('pair token reuse replaces authority without duplicate runtimes and failed pairing removes selected state', async () => {
  const state=join(root,'reuse'), enrollment=await token();
  await cli(state,'pair',enrollment);const first=await config(state);
  expect((await stat(state)).mode&0o777).toBe(0o700);expect((await stat(join(state,'config.json'))).mode&0o777).toBe(0o600);
  await writeFile(join(state,'leftover.txt'),'old execution state');
  await cli(state,'pair',enrollment);const second=await config(state);
  expect(second.runtimeId).toBe(first.runtimeId);expect(second.credentialId).not.toBe(first.credentialId);
  expect((await fetch(url+'/api/worker/status',{headers:{authorization:runtimeAuthorization(first)}})).status).toBe(401);
  expect(JSON.parse((await cli(state,'pair','status')).stdout).capabilities.receipt.observation).toBe(2);
  await expect(readFile(join(state,'leftover.txt'))).rejects.toThrow();
  await expect(cli(state,'pair','invalid-token')).rejects.toThrow();expect(await readdir(state)).toEqual([]);
  expect((await pool.query('SELECT count(DISTINCT runtime_id)::int AS n FROM runtime_credentials WHERE runtime_id=$1',[first.runtimeId])).rows[0].n).toBe(1);
},30000);

test('status and probe wait for automatic capability refresh without rescanning status or allowing auth mutation', async () => {
  const state = join(root, 'refresh'), bin = join(root, 'refresh-bin'), marker = join(root, 'refresh-marker');
  await mkdir(bin);
  const executable = process.env.VIBE_RUNTIME_BINARY ?? process.execPath;
  const args = [...(process.env.VIBE_RUNTIME_BINARY ? [] : ['--import', 'tsx', 'apps/runner/src/cli-main.ts']), '--state-dir', state];
  const env = { ...process.env, PATH: bin };
  const invoke = (...command: string[]) => exec(executable, [...args, ...command], { env });
  const enrollment = await token();
  await invoke('pair', enrollment);
  await writeFile(join(bin, 'codex'), `#!${process.execPath}\nconst fs = await import('node:fs'); if (process.argv.includes('--version')) { fs.writeFileSync(${JSON.stringify(marker)}, 'refresh'); setTimeout(() => console.log('codex 1.2.3'), 3000); } else console.log('Logged in using ChatGPT');\n`, { mode: 0o700 });
  const child = spawn(executable, [...args, 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  try {
    await expect.poll(async () => { try { return await readFile(marker, 'utf8'); } catch { return ''; } }, { timeout: 10000 }).toBe('refresh');
    const reads = Promise.all([invoke('pair', 'status'), invoke('pair', 'probe')]);
    await expect(invoke('pair', 'revoke')).rejects.toThrow('Stop the runner first');
    await expect(invoke('pair', enrollment)).rejects.toThrow('Stop the runner first');
    await expect(invoke('run')).rejects.toThrow('Stop the runner first');
    const [status, probe] = await reads;
    expect(JSON.parse(status.stdout).status).toBe('paired');
    expect(probe.stdout).toContain('Capabilities acknowledged');
    expect(JSON.parse((await invoke('pair', 'status')).stdout).capabilities.receipt.observation).toBe(3);
    expect(child.exitCode).toBeNull();
  } finally { child.kill('SIGTERM'); await exited; }
}, 30000);

test('run-once waits through an empty queue, permits cached status and probe, refuses auth mutation, and acknowledges the whole run', async () => {
  const state=join(root,'waiting'), enrollment=await token();await cli(state,'pair',enrollment);const configuration=await config(state);
  const child=spawn(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,'run-once'],{env:{...process.env,PATH:'/nonexistent'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const exited = new Promise<number|null>(done=>child.once('exit',done));
  try {
    await expect.poll(()=>stdout,{timeout:10000}).toContain('"kind":"idle"');expect(child.exitCode).toBeNull();
    const before=JSON.parse((await cli(state,'pair','status')).stdout).capabilities;
    await cli(state,'pair','probe');const after=JSON.parse((await cli(state,'pair','status')).stdout).capabilities;
    expect(after.receipt.observation).toBeGreaterThan(before.receipt.observation);
    await expect(cli(state,'pair','revoke')).rejects.toThrow('Stop the runner first');
    await expect(cli(state,'pair',enrollment)).rejects.toThrow('Stop the runner first');
    expect(await config(state)).toEqual(configuration);
    const run=await createRun(configuration.runtimeId);
    expect(await exited,stderr).toBe(0);expect(stdout).toContain(run.runId);
    const result=ConfiguredRunView.parse(await (await fetch(url+`/api/configured-runs/${run.runId}`)).json());expect(result.status).toBe('finished');
    expect(result.attempts.every(attempt=>attempt.state.kind==='terminal')).toBe(true);
    await expect(readFile(join(runtimeRoot(state,configuration),'work','assignment.json'))).rejects.toThrow();
  } finally {child.kill('SIGKILL');await exited;}
},30000);

test('revocation abandons assigned unfinished work and credential replacement cannot replay its accepted reports', async () => {
  const state=join(root,'abandon');await cli(state,'pair',await token());const configuration=await config(state);const run=await createRun(configuration.runtimeId);
  const worker = async (path:string,body:unknown, authority=configuration) => fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:runtimeAuthorization(authority)},body:JSON.stringify(body)});
  const assignment=await (await worker('/api/worker/claims',{protocol:1,requestId:randomUUID(),runtimeId:configuration.runtimeId})).json();
  const preparation={protocol:1,reportId:randomUUID(),runtimeId:configuration.runtimeId,assignmentId:assignment.assignmentId,runId:run.runId,preparation:{kind:'none'}};
  expect((await worker('/api/worker/preparations',preparation)).status).toBe(200);
  await cli(state,'pair','revoke');expect(await readdir(state)).toEqual([]);
  expect(ConfiguredRunView.parse(await (await fetch(url+`/api/configured-runs/${run.runId}`)).json()).status).toBe('abandoned');
  const replacement=(await post('/api/runtime-enrollments',{target:{kind:'replace',runtimeId:configuration.runtimeId}})).command.split(' ')[2];await cli(state,'pair',replacement);const current=await config(state);
  expect((await worker('/api/worker/preparations',preparation,current)).status).toBe(409);
  expect((await pool.query('SELECT preparation FROM run_preparations WHERE run_id=$1',[run.runId])).rows[0].preparation).toEqual({kind:'none'});
  const next=await createRun(current.runtimeId);await cli(state,'run-once');expect(ConfiguredRunView.parse(await (await fetch(url+`/api/configured-runs/${next.runId}`)).json()).status).toBe('finished');
  await cli(state,'pair','revoke');expect(ConfiguredRunView.parse(await (await fetch(url+`/api/configured-runs/${next.runId}`)).json()).status).toBe('finished');
},30000);

test('lost enrollment responses, failed registration and revocation delivery erase state without inventing remote success', async () => {
  const { createServer } = await import('node:http');
  let lostEnrollment=true, rejectRegistration=false, rejectRevocation=false, loseRevocation=false, malformedRevocation=false;
  const proxy=createServer((request,response)=>{ void (async()=>{
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const path=request.url??'', body=Buffer.concat(chunks).toString();
    if(path==='/api/worker/registrations' && rejectRegistration || path==='/api/worker/revoke' && rejectRevocation) {response.statusCode=503;response.end('{}');return;}
    if(path==='/api/worker/revoke' && malformedRevocation){response.end(JSON.stringify({ok:false}));return;}
    const upstream=await fetch(url+path,{method:request.method ?? 'POST',headers:{'content-type':'application/json',...(request.headers.authorization?{authorization:request.headers.authorization}:{})},...(request.method==='GET'?{}:{body})});
    const result=await upstream.text();
    if(path==='/api/worker/enrollments' && lostEnrollment){lostEnrollment=false;response.destroy();return;}
    if(path==='/api/worker/revoke' && loseRevocation){response.destroy();return;}
    response.statusCode=upstream.status;response.end(result);
  })().catch(()=>response.destroy());});
  await new Promise<void>(done=>proxy.listen(0,'127.0.0.1',done));const address=proxy.address();if(!address||typeof address==='string')throw new Error('Proxy failed to bind');
  const enrollment=await token();const command=JSON.parse(Buffer.from(enrollment,'base64url').toString());const encoded=Buffer.from(JSON.stringify({...command,apiUrl:`http://127.0.0.1:${address.port}`})).toString('base64url');const state=join(root,'lost-enrollment');
  try {
    await expect(cli(state,'pair',encoded)).rejects.toThrow();expect(await readdir(state)).toEqual([]);
    const identity=(await pool.query('SELECT target_runtime_id FROM runtime_enrollments WHERE key_hash=encode(sha256($1::bytea),\'hex\')',[Buffer.from(command.key)])).rows[0].target_runtime_id;
    await cli(state,'pair',encoded);expect((await config(state)).runtimeId).toBe(identity);
    const cache=JSON.parse((await cli(state,'pair','status')).stdout).capabilities;
    rejectRegistration=true;await expect(cli(state,'pair','probe')).rejects.toThrow('HTTP 503');expect(JSON.parse((await cli(state,'pair','status')).stdout).capabilities).toEqual(cache);
    const authority=await config(state), assigned=await createRun(authority.runtimeId);
    const workerPost=(path:string,body:unknown)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:runtimeAuthorization(authority)},body:JSON.stringify(body)});
    const assignment=await(await workerPost('/api/worker/claims',{protocol:1,requestId:randomUUID(),runtimeId:authority.runtimeId})).json();
    const report={protocol:1,reportId:randomUUID(),runtimeId:authority.runtimeId,assignmentId:assignment.assignmentId,runId:assigned.runId,kind:'terminal',attemptId:assignment.attempts[0].attemptId,outcome:{kind:'skipped',reason:'fixture unavailable',artifacts:[]},artifacts:[],observed:{executableVersion:null,model:null}};
    expect((await workerPost('/api/worker/preparations',{protocol:1,reportId:randomUUID(),runtimeId:authority.runtimeId,assignmentId:assignment.assignmentId,runId:assigned.runId,preparation:{kind:'none'}})).status).toBe(200);
    expect((await workerPost('/api/worker/attempts',report)).status).toBe(200);
    rejectRevocation=true;const failed=await cli(state,'pair','revoke');expect(failed.stderr).toContain('revocation failed');expect(failed.stdout).not.toContain('revocation confirmed');expect(await readdir(state)).toEqual([]);
    expect(ConfiguredRunView.parse(await(await fetch(url+`/api/configured-runs/${assigned.runId}`)).json()).status).toBe('running');
    rejectRevocation=false;await expect(cli(state,'pair',encoded)).rejects.toThrow('HTTP 503');expect(await readdir(state)).toEqual([]);
    const abandoned=ConfiguredRunView.parse(await(await fetch(url+`/api/configured-runs/${assigned.runId}`)).json());
    expect(abandoned.status).toBe('abandoned');expect(abandoned.attempts[0]?.state).toMatchObject({kind:'terminal',outcome:report.outcome});
    expect((await workerPost('/api/worker/attempts',report)).status).toBe(401);
    rejectRegistration=false;await cli(state,'pair',encoded);const credentials=await config(state);
    await post(`/api/runtimes/${credentials.runtimeId}/revoke`,{});expect(JSON.parse((await cli(state,'pair','status')).stdout).status).toBe('rejected or revoked credentials');
    await cli(state,'pair',encoded);loseRevocation=true;const lost=await cli(state,'pair','revoke');expect(lost.stderr).toContain('could not be confirmed');expect(await readdir(state)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM runtime_credentials WHERE runtime_id=$1 AND revoked_at IS NULL',[identity])).rowCount).toBe(0);
    loseRevocation=false;await cli(state,'pair',encoded);malformedRevocation=true;
    const malformed=await cli(state,'pair','revoke');expect(malformed.stderr).toContain('could not be confirmed');expect(malformed.stdout).not.toContain('revocation confirmed');expect(await readdir(state)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM runtime_credentials WHERE runtime_id=$1 AND revoked_at IS NULL',[identity])).rowCount).toBe(1);
  } finally {await new Promise<void>(done=>proxy.close(()=>done()));}
},30000);

test('probe during an active attempt preserves the selected PATH executable and provider environment', async () => {
  const state=join(root,'active'),bin=join(root,'tools'),other=join(root,'other-tools'),marker=join(root,'active-marker');await mkdir(bin);await mkdir(other);
  const executable=join(bin,'codex');
  await writeFile(executable,`#!${process.execPath}\nconst fs=await import('node:fs'); if(process.argv.includes('--version')){console.log('codex 1.2.3');process.exit();} if(process.argv.includes('status')){console.log('Logged in using ChatGPT');process.exit();} if(process.env.PROVIDER_TEST!=='preserved'||process.env.VIBE_RUNTIME_CREDENTIAL)throw Error('Wrong environment'); fs.writeFileSync(${JSON.stringify(marker)},'active');setTimeout(()=>{fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],'selected first executable');console.log(JSON.stringify({type:'turn.completed'}));},3000);`,{mode:0o700});
  await writeFile(join(other,'codex'),`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex 9.9.9');process.exit();} if(process.argv.includes('status')){console.log('Logged in using ChatGPT');process.exit();} process.stderr.write('Wrong executable selected');process.exit(9);`,{mode:0o700});
  const environment={...process.env,PATH:`${bin}:${other}`,PROVIDER_TEST:'preserved',VIBE_RUNTIME_CREDENTIAL:'credential-canary'};
  const invoke=(...args:string[])=>exec(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,...args],{env:environment,maxBuffer:1_000_000});
  await invoke('pair',await token());const configuration=await config(state);
  const suite=SuiteView.parse(await post('/api/suites',{definition:definition()}));
  const run=ConfiguredRunView.parse(await post('/api/configured-runs',{requestId:randomUUID(),contentId:suite.content.contentId,runtimeId:configuration.runtimeId,selection:{kind:'all'},source:'live',entrants:Array.from({length:2},()=>({id:randomUUID(),harness:'codex',model:'exact-model',settings:{timeoutMs:15000}}))}));
  const child=spawn(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,'run-once'],{env:environment,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);const exited=new Promise<number|null>(done=>child.once('exit',done));
  try {
    await expect.poll(async()=>{try{return await readFile(marker,'utf8');}catch{return '';}},{timeout:10000}).toBe('active');
    await exec(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,'pair','probe'],{env:{...environment,PATH:other}});
    const cached=JSON.parse((await invoke('pair','status')).stdout).capabilities;
    expect(cached.registration.tools.find((tool:{name:string})=>tool.name==='codex').availability.version).toBe('9.9.9');
    expect(child.exitCode).toBeNull();await expect(invoke('pair','revoke')).rejects.toThrow('Stop the runner first');
    await expect.poll(()=>child.exitCode,{timeout:15000}).toBe(0);expect(await exited,stderr).toBe(0);
    const result=ConfiguredRunView.parse(await(await fetch(url+`/api/configured-runs/${run.runId}`)).json());expect(result.status).toBe('finished');
    expect(result.attempts.every(attempt=>attempt.state.kind==='terminal'&&attempt.state.outcome.kind==='completed'&&attempt.state.outcome.summary==='selected first executable')).toBe(true);
  }finally{child.kill('SIGKILL');await exited;}
},30000);


test('tools installed after discovery remain unavailable until an acknowledged probe', async () => {
  const state=join(root,'late-tool'),bin=join(root,'late-bin'),marker=join(root,'late-marker');await mkdir(bin);
  const environment={...process.env,PATH:bin};
  const invoke=(...args:string[])=>exec(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,...args],{env:environment});
  await invoke('pair',await token());const configuration=await config(state);
  const child=spawn(process.execPath,['--import','tsx','apps/runner/src/cli-main.ts','--state-dir',state,'run-once'],{env:environment,stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);const exited=new Promise<number|null>(done=>child.once('exit',done));
  try {
    await expect.poll(()=>stdout,{timeout:10000}).toContain('"kind":"idle"');
    await writeFile(join(bin,'codex'),`#!${process.execPath}\nconst fs=await import('node:fs'); fs.writeFileSync(${JSON.stringify(marker)},'unacknowledged tool executed');process.exit(1);`,{mode:0o700});
    const suite=SuiteView.parse(await post('/api/suites',{definition:definition()}));
    const run=ConfiguredRunView.parse(await post('/api/configured-runs',{requestId:randomUUID(),contentId:suite.content.contentId,runtimeId:configuration.runtimeId,selection:{kind:'all'},source:'live',entrants:[{id:randomUUID(),harness:'codex',model:'late-tool',settings:{timeoutMs:15000}}]}));
    await expect.poll(()=>child.exitCode,{timeout:10000}).toBe(0);expect(await exited).toBe(0);
    const result=ConfiguredRunView.parse(await(await fetch(url+`/api/configured-runs/${run.runId}`)).json());
    expect(result.attempts[0]?.state).toMatchObject({kind:'terminal',outcome:{kind:'skipped',reason:'Harness executable is not configured'}});
    await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
  }finally{child.kill('SIGKILL');await exited;}
},30000);
