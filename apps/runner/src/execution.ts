import { randomUUID } from 'node:crypto';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { chromium } from '@playwright/test';
import { ClaimRequest, ClaimReceipt, RunAssignment, PreparationReport, AttemptReport, WorkReceipt, TaskIO } from '../../../packages/contracts/src/work.ts';
import { RuntimeId } from '../../../packages/contracts/src/runtime.ts';
import { contentDigest } from '../../../packages/contracts/src/canonical.ts';
import { acquireLocalLock } from '../../../scripts/local-lock.ts';
import { durableDirectory, durableWrite } from './spool.ts';
import { prepareMaterials, createWorkspace, safeFile } from './materials.ts';
import { executeAdapter, checkExecutable, Unavailable, type Executables } from './adapters.ts';
import { collectResults, diagnostics, metadata, declaredArtifacts, imageType } from './artifacts.ts';
import { onboardingUrl } from './onboarding.ts';
import { Interrupted } from './processes/run.ts';

const Delivery = z.discriminatedUnion('kind', [z.object({kind:z.literal('preparation'),body:PreparationReport}),z.object({kind:z.literal('attempt'),body:AttemptReport})]);
type WorkerOptions = { apiUrl: string; stateRoot: string; runtimeId: z.infer<typeof RuntimeId>; executables: Executables };
async function post(apiUrl: string, path: string, body: unknown) {
  const response = await fetch(new URL(path,onboardingUrl(apiUrl)),{redirect:'error',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
  if (!response.ok) throw new Error(`Worker delivery failed with HTTP ${response.status}`);
  const chunks: Uint8Array[] = []; let bytes = 0;
  if (!response.body) throw new Error('Worker response has no body');
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16_000_000) throw new Error('Worker response exceeds limit'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function deliver(options: WorkerOptions, directory: string, delivery: z.infer<typeof Delivery>) {
  const path = join(directory,`${delivery.body.reportId}.json`);
  await durableWrite(path,delivery,'create');
  const receiptPath = join(directory,`${delivery.body.reportId}.receipt.json`);
  if (await exists(receiptPath)) return;
  const receipt = WorkReceipt.parse(await post(options.apiUrl,delivery.kind === 'preparation' ? '/api/worker/preparations' : '/api/worker/attempts',delivery.body));
  if (receipt.reportId !== delivery.body.reportId || receipt.runId !== delivery.body.runId) throw new Error('Worker receipt identity mismatch');
  await durableWrite(receiptPath,receipt,'create');
}
async function retryDeliveries(options: WorkerOptions, directory: string) {
  await durableDirectory(directory);
  const pending: z.infer<typeof Delivery>[] = [];
  for (const name of await readdir(directory)) if (name.endsWith('.json') && !name.endsWith('.receipt.json')) pending.push(Delivery.parse(JSON.parse(await readFile(join(directory,name),'utf8'))));
  pending.sort((a,b) => (a.kind === 'preparation' ? 0 : a.body.kind === 'started' ? 1 : 2) - (b.kind === 'preparation' ? 0 : b.body.kind === 'started' ? 1 : 2));
  for (const delivery of pending) await deliver(options,directory,delivery);
}
export async function runWorkerOnce(options: WorkerOptions) {
  const root = resolve(options.stateRoot,'work'); await durableDirectory(root);
  const release = await acquireLocalLock(root);
  try {
    const outbound = join(root,'outbound'); await retryDeliveries(options,outbound);
    const claimPath = join(root,'claim.json');
    const claim = await exists(claimPath) ? ClaimRequest.parse(JSON.parse(await readFile(claimPath,'utf8'))) : ClaimRequest.parse({protocol:1,requestId:randomUUID(),runtimeId:options.runtimeId});
    if (claim.runtimeId !== options.runtimeId) throw new Error('Worker state belongs to another runtime');
    await durableWrite(claimPath,claim);
    const receipt = ClaimReceipt.parse(await post(options.apiUrl,'/api/worker/claims',claim));
    if (receipt.requestId !== claim.requestId) throw new Error('Claim receipt identity mismatch');
    await durableWrite(join(root,'claims',`${claim.requestId}.json`),receipt,'create');
    if (receipt.kind === 'idle') { await durableWrite(claimPath,{...claim,requestId:randomUUID()}); return {kind:'idle'} as const; }
    await executeAssignment(options,receipt,root,outbound);
    await durableWrite(claimPath,{...claim,requestId:randomUUID()});
    return {kind:'finished',runId:receipt.runId} as const;
  } finally { await release(); }
}
async function executeAssignment(options: WorkerOptions, assignment: RunAssignment, root: string, outbound: string) {
  const {digest,...snapshot} = assignment.snapshot;
  if (digest !== contentDigest(snapshot) || snapshot.content.digest !== contentDigest({schemaVersion:snapshot.content.schemaVersion,definition:snapshot.content.definition}) || snapshot.runtimeId !== options.runtimeId) throw new Error('Assignment snapshot integrity failed');
  const directory = join(root,assignment.runId); await durableDirectory(directory);
  const identity = {protocol:1,runtimeId:options.runtimeId,assignmentId:assignment.assignmentId,runId:assignment.runId} as const;
  let materials;
  const preparationPath = join(directory,'preparation.json');
  let preparation: PreparationReport;
  if (await exists(preparationPath)) preparation = PreparationReport.parse(JSON.parse(await readFile(preparationPath,'utf8')));
  else {
    try { materials = await prepareMaterials(snapshot.content.definition.materials,join(directory,'materials')); const {kind} = materials; preparation = PreparationReport.parse({...identity,reportId:randomUUID(),preparation:kind === 'none' ? materials : {kind,commit:materials.commit,manifestDigest:materials.manifestDigest,manifest:materials.manifest}}); }
    catch (error) { if (error instanceof Interrupted) throw error; preparation = PreparationReport.parse({...identity,reportId:randomUUID(),preparation:{kind:'failed',reason:'Repository preparation failed. See local Git diagnostics.'}}); }
    await durableWrite(preparationPath,preparation,'create');
  }
  await deliver(options,outbound,{kind:'preparation',body:preparation});
  if (preparation.preparation.kind !== 'failed' && !materials) materials = await prepareMaterials(snapshot.content.definition.materials,join(directory,'materials'));
  for (const slot of assignment.attempts) {
    const attemptDirectory = join(directory,slot.attemptId); await durableDirectory(attemptDirectory);
    const terminalPath = join(attemptDirectory,'terminal.json');
    if (await exists(terminalPath)) { await deliver(options,outbound,{kind:'attempt',body:AttemptReport.parse(JSON.parse(await readFile(terminalPath,'utf8')))}); continue; }
    const task = snapshot.content.definition.categories.flatMap((category) => category.tasks).find((task) => task.id === slot.taskId);
    const entrant = snapshot.entrants.find((entrant) => entrant.id === slot.entrantId);
    if (!task || !entrant || !snapshot.selectedTaskIds.includes(task.id)) throw new Error('Assignment attempt association failed');
    let observed: {executableVersion:string|null;model:string|null} = {executableVersion:null,model:null};
    let artifacts: Awaited<ReturnType<typeof diagnostics>> = [];
    let outcome: Extract<AttemptReport,{kind:'terminal'}>['outcome'];
    const startedPath = join(attemptDirectory,'started.json');
    let context: {io: TaskIO; workspace: string} | null = null;
    try {
      if (await exists(startedPath)) throw new Error('Attempt was started before interruption. Execution is uncertain and was not relaunched.');
      if (!materials) throw new Error('Repository preparation failed');
      const executable = snapshot.source === 'fixture' ? process.execPath : await checkExecutable(options.executables[entrant.harness]);
      const defaults = TaskIO.parse({inputs:[],outputs:task.kind === 'image-generation' ? [{path:'result.png',kind:'image'}] : ['html-static','html-interactive'].includes(task.kind) ? [{path:'index.html',kind:'html'}] : [],browser:null});
      const io = materials.kind === 'repository' ? materials.manifest.tasks[task.id] ?? defaults : defaults;
      if (entrant.harness === 'opencode' && snapshot.source === 'live' && !entrant.model.startsWith('opencode-go/')) throw new Unavailable('OpenCode Go requires an opencode-go provider model');
      if (task.kind === 'browser-scenario' || io.outputs.some((output) => output.kind === 'image')) await checkExecutable(chromium.executablePath());
      if (task.kind === 'browser-scenario' && !io.browser) throw new Unavailable('Browser scenario requires a declared starting context');
      if (['image-editing','image-understanding'].includes(task.kind) && !io.inputs.length) throw new Unavailable('Image task requires declared input images');
      const workspace = join(attemptDirectory,'workspace'); await createWorkspace(materials,workspace,attemptDirectory);
      context = {io,workspace};
      for (const input of io.inputs) {const bytes = await safeFile(workspace,input); if (['image-editing','image-understanding'].includes(task.kind)) await imageType(bytes);}
      const started = AttemptReport.parse({...identity,reportId:randomUUID(),kind:'started',attemptId:slot.attemptId,startedAt:new Date().toISOString()});
      await durableWrite(startedPath,started,'create'); await deliver(options,outbound,{kind:'attempt',body:started});
      const prompt = `${task.prompt}\n\nTask kind: ${task.kind}\nTask IO: ${JSON.stringify(io)}\n${task.kind === 'browser-scenario' ? 'Return only a JSON object with steps. Each step has kind click and selector, fill and selector/value, expect-text and selector/text, or screenshot and path. The runner opens the starting page before your steps. Do not create recordings yourself.' : 'Create the declared output files in this workspace. Return your final answer separately from tool logs.'}`;
      const adapter = await executeAdapter({entrant,executable,workspace,directory:attemptDirectory,prompt,images:['image-editing','image-understanding'].includes(task.kind) ? io.inputs.map((path) => join(workspace,path)) : [],writable:!['text-generation','text-editing','image-understanding','browser-scenario'].includes(task.kind),...(snapshot.source === 'fixture' ? {prefix:[fileURLToPath(new URL('../../../tests/fixtures/configured-harness.mjs',import.meta.url)),entrant.harness]} : {})});
      observed = adapter.observed;
      const collected = await collectResults({task,io,workspace,directory:attemptDirectory,materials,text:adapter.text,timeoutMs:entrant.settings.timeoutMs});
      artifacts = [...collected.artifacts,...await diagnostics(attemptDirectory)];
      outcome = {kind:'completed',summary:adapter.text,result:collected.result,artifacts:metadata(artifacts)};
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      artifacts = await diagnostics(attemptDirectory);
      if (context) for (const output of context.io.outputs) { try {const partial = await declaredArtifacts({...context.io,outputs:[output]},context.workspace); if (artifacts.length < 31 && artifacts.reduce((sum,item) => sum+item.bytes,0) + partial.reduce((sum,item) => sum+item.bytes,0) <= 8_000_000) artifacts.push(...partial);} catch {} }
      outcome = {kind:error instanceof Unavailable ? 'skipped' : 'failed',reason:(error instanceof Error ? error.message : 'Execution failed').slice(0,4000),artifacts:metadata(artifacts)};
    }
    const terminal = AttemptReport.parse({...identity,reportId:randomUUID(),kind:'terminal',attemptId:slot.attemptId,outcome,artifacts,observed});
    await durableWrite(terminalPath,terminal,'create'); await deliver(options,outbound,{kind:'attempt',body:terminal});
  }
}
