import { randomUUID } from 'node:crypto';
import { readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';
import { chromium } from '@playwright/test';
import { ClaimRequest, ClaimReceipt, RunAssignment, PreparationReport, AttemptReport, WorkReceipt, TaskIO } from '../../../packages/contracts/src/work.ts';
import { contentDigest } from '../../../packages/contracts/src/canonical.ts';
import { acquireLocalLock } from '../../../scripts/local-lock.ts';
import { durableDirectory, durableWrite } from './spool.ts';
import { prepareMaterials, PreparedMaterials, createWorkspace, safeFile } from './materials.ts';
import { executeAdapter, checkExecutable, Unavailable, type Executables } from './adapters.ts';
import { collectResults, diagnostics, metadata, declaredArtifacts, imageType } from './artifacts.ts';
import { runtimeRoot, workerPost, reconnectDelay } from './configuration.ts';
import { RuntimeConfiguration } from '../../../packages/contracts/src/access.ts';
import { Interrupted } from './processes/run.ts';

type WorkerOptions = { configuration: RuntimeConfiguration; stateRoot: string; executables: Executables };
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function readAssignment(path: string) { return RunAssignment.parse(JSON.parse(await readFile(path, 'utf8'))); }
async function uploadAssignment(options: WorkerOptions, assignment: RunAssignment, root: string, accepted: () => void = () => {}) {
  const directory = join(root, assignment.runId);
  const reports: { kind: 'preparation' | 'attempt'; path: string; terminalPath?: string }[] = [{kind:'preparation',path:join(directory,'preparation.json')}];
  for (const slot of assignment.attempts) reports.push({kind:'attempt',path:join(directory,slot.attemptId,'started.json'),terminalPath:join(directory,slot.attemptId,'terminal.json')},{kind:'attempt',path:join(directory,slot.attemptId,'terminal.json')});
  for (const report of reports) {
    if (!await exists(report.path)) {
      if (report.terminalPath && await exists(report.terminalPath)) continue;
      return;
    }
    const body = report.kind === 'preparation' ? PreparationReport.parse(JSON.parse(await readFile(report.path,'utf8'))) : AttemptReport.parse(JSON.parse(await readFile(report.path,'utf8')));
    if (body.runtimeId !== options.configuration.runtimeId || body.assignmentId !== assignment.assignmentId || body.runId !== assignment.runId) throw new Error('Saved report identity mismatch');
    const receiptPath = join(directory, 'receipts', `${body.reportId}.json`);
    if (await exists(receiptPath)) {
      const saved = WorkReceipt.parse(JSON.parse(await readFile(receiptPath,'utf8')));
      if (saved.reportId !== body.reportId || saved.runId !== body.runId) throw new Error('Saved receipt identity mismatch');
      continue;
    }
    const receipt = WorkReceipt.parse(await workerPost(options.configuration,report.kind === 'preparation' ? '/api/worker/preparations' : '/api/worker/attempts',body));
    if (receipt.reportId !== body.reportId || receipt.runId !== body.runId) throw new Error('Worker receipt identity mismatch');
    await durableWrite(receiptPath,receipt,'create');
    accepted();
  }
}
export async function runWorkerOnce(options: WorkerOptions) {
  const root = join(runtimeRoot(options.stateRoot, options.configuration), 'work'); await durableDirectory(root);
  const release = await acquireLocalLock(root);
  try {
    const currentPath = join(root, 'assignment.json');
    const claimPath = join(root,'claim.json');
    let assignment: RunAssignment;
    if (await exists(currentPath)) assignment = await readAssignment(currentPath);
    else {
      const claim = await exists(claimPath) ? ClaimRequest.parse(JSON.parse(await readFile(claimPath,'utf8'))) : ClaimRequest.parse({protocol:1,requestId:randomUUID(),runtimeId:options.configuration.runtimeId});
      if (claim.runtimeId !== options.configuration.runtimeId) throw new Error('Worker state belongs to another runtime');
      await durableWrite(claimPath,claim);
      const receipt = ClaimReceipt.parse(await workerPost(options.configuration,'/api/worker/claims',claim));
      if (receipt.requestId !== claim.requestId) throw new Error('Claim receipt identity mismatch');
      await durableWrite(join(root,'claims',`${claim.requestId}.json`),receipt,'create');
      if (receipt.kind === 'idle') { await durableWrite(claimPath,{...claim,requestId:randomUUID()}); return {kind:'idle'} as const; }
      assignment = receipt;
      await durableWrite(currentPath, assignment);
      await durableWrite(join(root,assignment.runId,'assignment.json'),assignment,'create');
    }
    let uploading: Promise<void> | null = null;
    let failures = 0; let retryAt = 0; let uploadError: unknown;
    const accepted = () => { failures = 0; retryAt = 0; uploadError = undefined; };
    const upload = () => {
      if (uploading || Date.now() < retryAt) return;
      uploading = uploadAssignment(options, assignment, root, accepted).catch((error: unknown) => {
        uploadError = error; failures++; retryAt = Date.now() + reconnectDelay(failures);
        process.stderr.write(`Saved result delivery unavailable. Retrying in ${reconnectDelay(failures) / 1000}s.\n`);
      }).finally(() => { uploading = null; });
    };
    const timer = setInterval(upload, 250);
    upload();
    try { await executeAssignment(options, assignment, root); }
    finally { clearInterval(timer); await uploading; }
    if (uploadError !== undefined && Date.now() < retryAt) throw uploadError;
    await uploadAssignment(options, assignment, root, accepted);
    await durableWrite(claimPath,{protocol:1,requestId:randomUUID(),runtimeId:options.configuration.runtimeId});
    await rm(currentPath);
    return {kind:'finished',runId:assignment.runId} as const;
  } finally { await release(); }
}
async function executeAssignment(options: WorkerOptions, assignment: RunAssignment, root: string) {
  const {digest,...snapshot} = assignment.snapshot;
  if (digest !== contentDigest(snapshot) || snapshot.content.digest !== contentDigest({schemaVersion:snapshot.content.schemaVersion,definition:snapshot.content.definition}) || snapshot.runtimeId !== options.configuration.runtimeId) throw new Error('Assignment snapshot integrity failed');
  const directory = join(root,assignment.runId); await durableDirectory(directory);
  const identity = {protocol:1,runtimeId:options.configuration.runtimeId,assignmentId:assignment.assignmentId,runId:assignment.runId} as const;
  if ((await Promise.all(assignment.attempts.map(slot => exists(join(directory,slot.attemptId,'terminal.json'))))).every(Boolean)) return;
  let materials: PreparedMaterials | undefined;
  const preparationPath = join(directory,'preparation.json');
  let preparation: PreparationReport;
  if (await exists(preparationPath)) preparation = PreparationReport.parse(JSON.parse(await readFile(preparationPath,'utf8')));
  else {
    try { materials = await prepareMaterials(snapshot.content.definition.materials,join(directory,'materials')); const {kind} = materials; preparation = PreparationReport.parse({...identity,reportId:randomUUID(),preparation:kind === 'none' ? materials : {kind,commit:materials.commit,manifestDigest:materials.manifestDigest,manifest:materials.manifest}}); }
    catch (error) { if (error instanceof Interrupted) throw error; preparation = PreparationReport.parse({...identity,reportId:randomUUID(),preparation:{kind:'failed',reason:'Repository preparation failed. See local Git diagnostics.'}}); }
    await durableWrite(preparationPath,preparation,'create');
  }
  if (preparation.preparation.kind !== 'failed' && !materials) {
    materials = PreparedMaterials.parse(JSON.parse(await readFile(join(directory,'materials','prepared.json'),'utf8')));
    if (materials.kind !== preparation.preparation.kind || materials.kind === 'repository' && preparation.preparation.kind === 'repository' && (materials.commit !== preparation.preparation.commit || materials.manifestDigest !== preparation.preparation.manifestDigest || contentDigest(materials.manifest) !== materials.manifestDigest)) throw new Error('Saved materials do not match immutable preparation');
  }
  for (const slot of assignment.attempts) {
    const attemptDirectory = join(directory,slot.attemptId); await durableDirectory(attemptDirectory);
    const terminalPath = join(attemptDirectory,'terminal.json');
    if (await exists(terminalPath)) { AttemptReport.parse(JSON.parse(await readFile(terminalPath,'utf8'))); continue; }
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
      const executable = snapshot.source === 'fixture' ? process.execPath : await checkExecutable(options.executables[entrant.harness] ?? entrant.harness);
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
      await durableWrite(startedPath,started,'create');
      const prompt = `${task.prompt}\n\nTask kind: ${task.kind}\nTask IO: ${JSON.stringify(io)}\n${task.kind === 'browser-scenario' ? 'Return only a JSON object with steps. Each step has kind click and selector, fill and selector/value, expect-text and selector/text, or screenshot and path. The runner opens the starting page before your steps. Do not create recordings yourself.' : 'Create the declared output files in this workspace. Return your final answer separately from tool logs.'}`;
      const adapter = await executeAdapter({entrant,executable,workspace,directory:attemptDirectory,prompt,images:['image-editing','image-understanding'].includes(task.kind) ? io.inputs.map((path) => join(workspace,path)) : [],writable:!['text-generation','text-editing','image-understanding','browser-scenario'].includes(task.kind),...(snapshot.source === 'fixture' ? {prefix:isSea() ? ['--internal-configured-fixture',entrant.harness] : [fileURLToPath(new URL('../../../tests/fixtures/configured-harness.mjs',import.meta.url)),entrant.harness]} : {})});
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
    await durableWrite(terminalPath,terminal,'create');
  }
}
