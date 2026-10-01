import { z } from 'zod';
import { afterEach, expect, test } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureRuntime, readConfiguration, runtimeRoot } from '../apps/runner/src/configuration.ts';
import { reconnectDelay } from '../apps/runner/src/cli.ts';
import { runWorkerOnce } from '../apps/runner/src/execution.ts';
import { RuntimeConfiguration, EnrollmentExchange } from '../packages/contracts/src/access.ts';
import { ClaimRequest, RunAssignment, PreparationReport, AttemptReport } from '../packages/contracts/src/work.ts';
import { durableWrite } from '../apps/runner/src/spool.ts';
import { checkExecutable } from '../apps/runner/src/adapters.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))); });
async function root() { const directory = await mkdtemp(join(tmpdir(),'runtime-durable-')); roots.push(directory); return directory; }
async function endpoint(handler: (request: IncomingMessage,response: ServerResponse,body: unknown) => Promise<void>) {
  const server = createServer((request,response) => { void (async () => { const chunks: Buffer[]=[]; for await (const chunk of request) chunks.push(Buffer.from(chunk)); await handler(request,response,JSON.parse(Buffer.concat(chunks).toString('utf8'))); })(); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server'); return `http://127.0.0.1:${address.port}`;
}
function assignment(configuration: RuntimeConfiguration) {
  const taskId = randomUUID(); const entrantId=randomUUID();
  const definition={title:'offline',description:'',categories:[{id:randomUUID(),title:'tasks',tasks:[{id:taskId,title:'one',kind:'text-generation',prompt:'Hello',criterionIds:[]}]}],evaluation:{conversion:'rating-control-v1',criteria:[],rankingRules:[]},materials:{kind:'none'}};
  const content={schemaVersion:1,suiteId:randomUUID(),contentId:randomUUID(),revision:1,ordinal:1,createdAt:new Date().toISOString(),definition,digest:contentDigest({schemaVersion:1,definition})};
  const snapshot={protocol:1,content,runtimeId:configuration.runtimeId,selectedTaskIds:[taskId],entrants:[{id:entrantId,harness:'codex',model:'fixture',settings:{timeoutMs:5000}}],source:'fixture'};
  return RunAssignment.parse({kind:'assigned',requestId:randomUUID(),assignmentId:randomUUID(),runId:randomUUID(),snapshot:{...snapshot,digest:contentDigest(snapshot)},attempts:[0,1,2].map(ordinal=>({attemptId:randomUUID(),taskId,entrantId,ordinal}))});
}
test('enrollment lost acknowledgement reuses its persisted secret and server identity with private permissions',async () => {
  const stateRoot=await root(); let lost=true; const exchanges: unknown[]=[]; const installationId=randomUUID(); const runtimeId=randomUUID();
  const apiUrl=await endpoint(async (request,response,body) => {
    expect(request.url).toBe('/api/worker/enrollments'); expect(request.headers.authorization).toBeUndefined();
    const exchange=EnrollmentExchange.parse(body); exchanges.push(exchange);
    expect(JSON.parse(await readFile(join(stateRoot,'enrollment-pending.json'),'utf8')).exchange).toEqual(exchange);
    if(lost) { lost=false; request.socket.destroy(); return; }
    response.end(JSON.stringify({installationId,runtimeId,credentialId:exchange.credentialId,requestId:exchange.requestId}));
  });
  const command=Buffer.from(JSON.stringify({apiUrl,key:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString()})).toString('base64url');
  await expect(configureRuntime(stateRoot,command)).rejects.toThrow();
  const configuration=await configureRuntime(stateRoot,command);
  expect(exchanges[1]).toEqual(exchanges[0]); expect(configuration.runtimeId).toBe(runtimeId); expect(await readConfiguration(stateRoot)).toEqual(configuration);
  expect((await stat(stateRoot)).mode & 0o777).toBe(0o700); expect((await stat(join(stateRoot,'config.json'))).mode & 0o777).toBe(0o600);
  expect(await readdir(stateRoot)).not.toContain('enrollment-pending.json');
});
test('offline collection finishes every assigned attempt and restart retries exact reports in assignment order',async () => {
  const stateRoot=await root(); let offline=true; let claims=0; const delivered: string[]=[]; let work: ReturnType<typeof assignment>;
  const configuration=RuntimeConfiguration.parse({version:1,apiUrl:await endpoint(async (request,response,body) => {
    expect(request.headers.authorization).toBe(`Bearer ${configuration.credentialId}.${configuration.secret}`);
    if (request.url === '/api/worker/claims') { claims++; const claim = ClaimRequest.parse(body); response.end(JSON.stringify({...work,requestId:claim.requestId})); return; }
    if (offline) { response.statusCode=401; response.end('{}'); return; }
    const report=z.union([PreparationReport,AttemptReport]).parse(body); delivered.push('kind' in report ? `${report.kind}/${report.attemptId}` : 'preparation'); response.end(JSON.stringify({reportId:report.reportId,runId:report.runId,acceptedAt:new Date().toISOString()}));
  }),installationId:randomUUID(),runtimeId:randomUUID(),credentialId:randomUUID(),secret:'c'.repeat(64)});
  work=assignment(configuration); const options={configuration,stateRoot,executables:{}};
  await expect(runWorkerOnce(options)).rejects.toThrow('HTTP 401');
  const terminals=await Promise.all(work.attempts.map(slot=>readFile(join(runtimeRoot(stateRoot,configuration),'work',work.runId,slot.attemptId,'terminal.json'),'utf8')));
  expect(terminals.map(text=>JSON.parse(text).outcome.kind)).toEqual(['completed','completed','completed']);
  offline=false;
  expect(await runWorkerOnce(options)).toEqual({kind:'finished',runId:work.runId}); expect(claims).toBe(1);
  expect(delivered).toEqual(['preparation',...work.attempts.flatMap(slot=>[`started/${slot.attemptId}`,`terminal/${slot.attemptId}`])]);
  expect(await Promise.all(work.attempts.map(slot=>readFile(join(runtimeRoot(stateRoot,configuration),'work',work.runId,slot.attemptId,'terminal.json'),'utf8')))).toEqual(terminals);
});
test('reconnect failures progress to a bounded delay including rejected authentication',() => {
  expect([1,2,3,4,5,6,7,99].map(reconnectDelay)).toEqual([1000,2000,4000,8000,16000,32000,60000,60000]);
});

test('fresh enrollment replaces an expired pending exchange without replacing active credentials until acknowledgement',async () => {
  const stateRoot=await root(); const active=RuntimeConfiguration.parse({version:1,apiUrl:'https://old.example',installationId:randomUUID(),runtimeId:randomUUID(),credentialId:randomUUID(),secret:'d'.repeat(64)});
  await durableWrite(join(stateRoot,'config.json'),active);
  const apiUrl=await endpoint(async (_request,response,body) => { const exchange=EnrollmentExchange.parse(body); if(exchange.key === 'e'.repeat(64)) { response.statusCode=401; response.end('{}'); return; } response.end(JSON.stringify({installationId:randomUUID(),runtimeId:randomUUID(),credentialId:exchange.credentialId,requestId:exchange.requestId})); });
  const command=(key:string)=>Buffer.from(JSON.stringify({apiUrl,key,expiresAt:new Date(Date.now()+600000).toISOString()})).toString('base64url');
  await expect(configureRuntime(stateRoot,command('e'.repeat(64)))).rejects.toThrow('401'); expect(await readConfiguration(stateRoot)).toEqual(active);
  const fresh=await configureRuntime(stateRoot,command('f'.repeat(64))); expect(fresh.runtimeId).not.toBe(active.runtimeId); expect(await readConfiguration(stateRoot)).toEqual(fresh);
});
test('new destination never receives old results and targeted same identity recovers them',async () => {
  const stateRoot=await root(); let offline=true; let work:ReturnType<typeof assignment>; let delivered=0;
  const old=RuntimeConfiguration.parse({version:1,apiUrl:await endpoint(async (request,response,body)=>{
    expect(request.headers.authorization).toBe(`Bearer ${old.credentialId}.${old.secret}`);
    if(request.url === '/api/worker/claims') { response.end(JSON.stringify({...work,requestId:ClaimRequest.parse(body).requestId})); return; }
    if(offline){response.statusCode=401;response.end('{}');return;}
    const report=z.union([PreparationReport,AttemptReport]).parse(body);delivered++;response.end(JSON.stringify({reportId:report.reportId,runId:report.runId,acceptedAt:new Date().toISOString()}));
  }),installationId:randomUUID(),runtimeId:randomUUID(),credentialId:randomUUID(),secret:'1'.repeat(64)});
  work=assignment(old); await durableWrite(join(stateRoot,'config.json'),old);
  await expect(runWorkerOnce({configuration:old,stateRoot,executables:{}})).rejects.toThrow();
  let foreignRequests=0;
  const foreign=RuntimeConfiguration.parse({...old,apiUrl:await endpoint(async (request,response,body)=>{foreignRequests++;expect(request.url).toBe('/api/worker/claims');response.end(JSON.stringify({kind:'idle',requestId:ClaimRequest.parse(body).requestId}));}),installationId:randomUUID(),runtimeId:randomUUID(),credentialId:randomUUID()});
  await durableWrite(join(stateRoot,'config.json'),foreign);
  expect(await runWorkerOnce({configuration:foreign,stateRoot,executables:{}})).toEqual({kind:'idle'}); expect(foreignRequests).toBe(1); expect(delivered).toBe(0);
  await durableWrite(join(stateRoot,'config.json'),old); offline=false;
  expect(await runWorkerOnce({configuration:await readConfiguration(stateRoot),stateRoot,executables:{}})).toEqual({kind:'finished',runId:work.runId}); expect(delivered).toBe(7);
});
test('PATH harness discovery accepts executable files and rejects nonexecutables',async()=>{
  const directory=await root(); const executable=join(directory,'codex'); await writeFile(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const original=process.env.PATH; process.env.PATH=directory;
  try { expect(await checkExecutable('codex')).toBe(executable); await writeFile(join(directory,'claude'),'not executable',{mode:0o600}); await expect(checkExecutable('claude')).rejects.toThrow('not installed or executable'); }
  finally { process.env.PATH=original; }
});
test('rejected delivery backs off during long assigned execution while every result is collected',async()=>{
  const stateRoot=await root(); const executable=join(stateRoot,'slow-codex');
  await writeFile(executable,`#!${process.execPath}\nconst fs=require('node:fs');\nif(process.argv.includes('--version')) { process.stdout.write('slow-codex 1.0.0'); process.exit(); }\nfs.readFileSync(0,'utf8'); setTimeout(()=>{ fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],'collected'); process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n'); },1500);\n`,{mode:0o700});
  const rejected:number[]=[]; let work:ReturnType<typeof assignment>;
  const configuration=RuntimeConfiguration.parse({version:1,apiUrl:await endpoint(async(request,response,body)=>{ if(request.url === '/api/worker/claims') {response.end(JSON.stringify({...work,requestId:ClaimRequest.parse(body).requestId}));return;} rejected.push(Date.now());response.statusCode=401;response.end('{}'); }),installationId:randomUUID(),runtimeId:randomUUID(),credentialId:randomUUID(),secret:'2'.repeat(64)});
  const fixture=assignment(configuration);const {digest:_digest,...snapshot}=fixture.snapshot;const live={...snapshot,source:'live'};
  work=RunAssignment.parse({...fixture,snapshot:{...live,digest:contentDigest(live)}});
  await expect(runWorkerOnce({configuration,stateRoot,executables:{codex:executable}})).rejects.toThrow('401');
  expect(rejected.length).toBeGreaterThanOrEqual(3);expect(rejected.length).toBeLessThanOrEqual(4);
  expect((rejected[1]??0)-(rejected[0]??0)).toBeGreaterThanOrEqual(1000);expect((rejected[2]??0)-(rejected[1]??0)).toBeGreaterThanOrEqual(2000);
  for(const slot of work.attempts) expect(JSON.parse(await readFile(join(runtimeRoot(stateRoot,configuration),'work',work.runId,slot.attemptId,'terminal.json'),'utf8')).outcome.kind).toBe('completed');
},10000);
