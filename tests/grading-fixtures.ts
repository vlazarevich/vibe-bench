import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
import { createHash, randomUUID } from 'node:crypto';
import { Definition, SuiteView } from '../packages/contracts/src/suites.ts';
import { ConfiguredRunView, CreateConfiguredRun } from '../packages/contracts/src/configured-runs.ts';
import { ToolName } from '../packages/contracts/src/runtime.ts';
import { RunAssignment } from '../packages/contracts/src/work.ts';

export const canary = 'private-model-harness-marker';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=', 'base64');
export const webm = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJdEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggJH7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIKWqtf8ufcvucgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgSC6gSCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3PWY8CLY8WIKWqtf8ufcvtnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QJ7ngQCjvYEAAIDQAgCdASogACAAAEcIhYWIhYSIAgICdaoD+AIIIQg9AP7/TRL//FhX8WFfxYV/8WFf/PzO7cX85gCjlYEAyACxAQAFEKwAGAAYWC/0AAhwAKOVgQGQALEBAAUQrAAYABhYL/QACHAAo5WBAlgAsQEABRCsABgAGFgv9AAIcACjlYEDIACxAQAFEKwAGAAYWC/0AAhwABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=', 'base64');
export async function gradingFixture(url: string, cookie = '') {
  const configuration = await enrollRuntime(url, undefined, cookie);
  async function post(path: string, body: unknown) {
    const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(path.startsWith('/api/worker/') ? { authorization: runtimeAuthorization(configuration) } : { origin: url, cookie }) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
  const runtimeId = configuration.runtimeId;
  await post('/api/worker/registrations', { protocol: 1, runtimeId, observation: 1, observedAt: new Date().toISOString(), machine: { platform: 'linux', architecture: 'x64', logicalCpus: 2, memoryBytes: 1_000_000 }, tools: ToolName.options.map((name) => ({ name, availability: { kind: 'unavailable', reason: 'missing' } })), harnesses: { codex: { kind: 'not-ready' }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' });
  const criteria = ['stars-5', 'slider-10', 'thumbs'].map((control) => ({ id: randomUUID(), title: control, instructions: `Original ${control} guidance`, control }));
  const value = Definition.parse({ title: `Grading ${randomUUID().slice(0, 8)}`, description: 'Fixture grading', categories: [
    { id: randomUUID(), title: 'Writing', tasks: ['First task', 'Excluded task'].map((title) => ({ id: randomUUID(), title, prompt: `Original ${title} prompt`, kind: 'text-generation', criterionIds: criteria.map((criterion) => criterion.id) })) },
    { id: randomUUID(), title: 'Media', tasks: [{ id: randomUUID(), title: 'Image task', prompt: 'Make an image', kind: 'image-generation', criterionIds: criteria.map((criterion) => criterion.id) }, { id: randomUUID(), title: 'HTML task', prompt: 'Make a page', kind: 'html-static', criterionIds: [criteria[0]?.id] }, { id: randomUUID(), title: 'Browser task', prompt: 'Inspect browser recording', kind: 'browser-scenario', criterionIds: [criteria[0]?.id] }, { id: randomUUID(), title: 'Patch task', prompt: 'Fix code', kind: 'coding-bugfix', criterionIds: [criteria[0]?.id] }] },
  ], evaluation: { conversion: 'rating-control-v1', criteria, rankingRules: [] }, materials: { kind: 'none' } });
  const suite = SuiteView.parse(await post('/api/suites', { definition: value }));
  const tasks = value.categories.flatMap((category) => category.tasks).filter((task) => task.title !== 'Excluded task');
  const input = CreateConfiguredRun.parse({ requestId: randomUUID(), contentId: suite.content.contentId, runtimeId, selection: { kind: 'subset', categoryIds: [], taskIds: tasks.map((task) => task.id) }, source: 'fixture', entrants: Array.from({ length: 4 }, () => ({ id: randomUUID(), harness: 'codex', model: canary, settings: { timeoutMs: 3000, reasoningEffort: 'high' } })) });
  const run = ConfiguredRunView.parse(await post('/api/configured-runs', input));
  const assignment = RunAssignment.parse(await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId }));
  const identity = { protocol: 1, runtimeId, runId: run.runId, assignmentId: assignment.assignmentId };
  await post('/api/worker/preparations', { ...identity, reportId: randomUUID(), preparation: { kind: 'none' } });
  const artifacts: Array<{ id: string; bytes: Buffer; name: string }> = [];
  async function finish() {
    for (const [index, attempt] of assignment.attempts.entries()) {
      const task = tasks.find((task) => task.id === attempt.taskId);
      if (!task) throw new Error('Missing fixture task');
      if (index % 4 >= 2) {
        await post('/api/worker/attempts', { ...identity, reportId: randomUUID(), kind: 'terminal', attemptId: attempt.attemptId, outcome: { kind: index % 4 === 2 ? 'failed' : 'skipped', reason: canary, artifacts: [] }, artifacts: [], observed: { executableVersion: canary, model: canary } });
        continue;
      }
      await post('/api/worker/attempts', { ...identity, reportId: randomUUID(), kind: 'started', attemptId: attempt.attemptId, startedAt: new Date().toISOString() });
      function artifact(bytes: Buffer, kind: string, mediaType: string) {
        const id = randomUUID(), name = `${canary}-${kind}.bin`;
        artifacts.push({ id, name, bytes });
        return { id, name, kind, mediaType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
      }
      const diagnostic = artifact(Buffer.from(canary), 'diagnostic', 'text/plain');
      const output = task.kind === 'browser-scenario' ? artifact(webm, 'recording', 'video/webm') : task.kind === 'image-generation' ? artifact(png, 'image', 'image/png') : task.kind === 'html-static' ? artifact(Buffer.from('<script>document.title="executed"</script><h1>Submitted page</h1>'), 'html', 'text/html') : task.kind === 'coding-bugfix' ? artifact(Buffer.from('diff --git a/index.ts b/index.ts\n+return 42;'), 'code', `application/${canary}`) : null;
      const uploads = output ? [output, diagnostic] : [diagnostic];
      const result = output ? task.kind === 'browser-scenario' ? { kind: 'browser', recordingArtifactId: output.id, format: 'webm', screenshotArtifactIds: [] } : task.kind === 'image-generation' ? { kind: 'image', artifactIds: [output.id] } : task.kind === 'html-static' ? { kind: 'html', entryArtifactId: output.id, assetArtifactIds: [diagnostic.id] } : { kind: 'code', patchArtifactId: output.id, changedFiles: [{ path: `${canary}.ts`, change: 'modified' }] } : { kind: 'text' };
      await post('/api/worker/attempts', { ...identity, reportId: randomUUID(), kind: 'terminal', attemptId: attempt.attemptId, outcome: { kind: 'completed', result, summary: task.kind === 'text-generation' ? `<script>Escaped answer ${index % 4}</script>` : canary, artifacts: uploads.map(({ base64: _base64, ...metadata }) => metadata) }, artifacts: uploads, observed: { executableVersion: canary, model: canary } });
    }
  }
  return { suite, value, input, run, assignment, artifacts, finish, post };
}
