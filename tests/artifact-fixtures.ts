import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { ConfiguredRunView, type ResultDescriptor } from '../packages/contracts/src/configured-runs.ts';
import { SuiteView, TaskKind } from '../packages/contracts/src/suites.ts';
import { RunAssignment } from '../packages/contracts/src/work.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';
import { ToolName } from '../packages/contracts/src/runtime.ts';
import { artifact, metadata } from '../apps/runner/src/artifacts.ts';
import { definition } from './suite-fixtures.ts';

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=', 'base64');
export const interactiveHtml = '<!doctype html><link rel="stylesheet" href="assets/style.css?v=1"><button id="counter">Count 0</button><input aria-label="name"><p id="echo"></p><img src="assets/picture.png"><script src="assets/app.js"></script>';
export const interactiveJs = 'let n=0;document.querySelector("button").onclick=()=>document.querySelector("button").textContent="Count "+(++n);document.querySelector("input").oninput=e=>document.querySelector("#echo").textContent=e.target.value;';
export async function seedArtifactRun(url: string) {
  async function post(path: string, body: unknown) {
    const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(path.startsWith('/api/worker/') ? {} : { origin: url }) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
  await mkdir('.artifacts', { recursive: true });
  const directory = await mkdtemp(resolve('.artifacts/viewer-recording-'));
  const browser = await chromium.launch();
  let recording: Buffer;
  try {
    const context = await browser.newContext({ recordVideo: { dir: directory, size: { width: 320, height: 240 } } });
    const page = await context.newPage(); await page.setContent('<body style="background:green">Recorded browser result</body>');
    await page.screenshot(); await page.waitForTimeout(150);
    const video = page.video(); if (!video) throw new Error('No recording');
    await context.close(); recording = await readFile(await video.path());
  } finally { await browser.close(); }
  const runtimeId = randomUUID();
  await post('/api/worker/registrations', { protocol: 1, runtimeId, observation: 1, observedAt: new Date().toISOString(), capacity: { slots: 2 }, machine: { platform: 'linux', architecture: 'x64', logicalCpus: 2, memoryBytes: 4_000_000_000 }, tools: ToolName.options.map((name) => ({ name, availability: { kind: 'unavailable', reason: 'missing' } })), harnesses: { codex: { kind: 'not-ready' }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' });
  const value = definition();
  const kinds = ['text-generation', 'image-generation', 'coding-feature', 'html-interactive', 'browser-scenario'].map((kind) => TaskKind.parse(kind));
  const tasks = kinds.map((kind) => ({ id: randomUUID(), title: kind, kind, prompt: 'Artifact viewer fixture', criterionIds: value.evaluation.criteria.map((criterion) => criterion.id) }));
  const suite = SuiteView.parse(await post('/api/suites', { definition: { ...value, title: `Artifact suite ${randomUUID()}`, categories: [{ id: randomUUID(), title: 'Results', tasks }], materials: { kind: 'repository', url: 'https://example.invalid/repo.git', requestedRef: 'main' } } }));
  const run = ConfiguredRunView.parse(await post('/api/configured-runs', { requestId: randomUUID(), contentId: suite.content.contentId, runtimeId, selection: { kind: 'all' }, source: 'fixture', entrants: [{ id: randomUUID(), harness: 'codex', model: 'viewer-fixture', settings: { timeoutMs: 3000 } }] }));
  const assignment = RunAssignment.parse(await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId }));
  const manifest = { version: 1, tasks: Object.fromEntries(tasks.map((task) => [task.id, { inputs: [], outputs: [{ path: 'extra.txt', kind: 'text' }, { path: 'binary.dat', kind: 'code' }], browser: null }])) };
  const identity = () => ({ protocol: 1, reportId: randomUUID(), runtimeId, assignmentId: assignment.assignmentId, runId: run.runId });
  await post('/api/worker/preparations', { ...identity(), preparation: { kind: 'repository', commit: 'a'.repeat(40), manifestDigest: contentDigest(manifest), manifest } });
  const records = [];
  for (const attempt of assignment.attempts) {
    const task = tasks.find((task) => task.id === attempt.taskId); if (!task) throw new Error('Missing task');
    const artifacts = [artifact('extra.txt', 'text', 'text/plain', Buffer.from('Declared extra <b>plain text</b>')), artifact('binary.dat', 'code', 'application/octet-stream', Buffer.from([0xff, 0, 0x81])), artifact('diagnostics/log.html', 'diagnostic', 'text/html', Buffer.from('<script>window.viewerEscaped=false</script>'))];
    let result: ResultDescriptor;
    switch (task.kind) {
      case 'text-generation': artifacts.push(artifact('answer.txt', 'text', 'text/plain', Buffer.from('Full answer <script>window.viewerEscaped=false</script>\n' + 'Complete answer. '.repeat(9000)))); result = { kind: 'text' }; break;
      case 'image-generation': { const image = artifact('output.png', 'image', 'image/png', png); artifacts.push(image); result = { kind: 'image', artifactIds: [image.id] }; break; }
      case 'coding-feature': {
        const patch = artifact('changes.patch', 'code', 'text/plain', Buffer.from('diff --git a/src/result.ts b/src/result.ts\n--- a/src/result.ts\n+++ b/src/result.ts\n-old\n+export const result = "<b>escaped</b>";\n'));
        artifacts.push(patch, artifact('src/result.ts', 'code', 'application/octet-stream', Buffer.from('export const result = "<b>escaped</b>";')));
        result = { kind: 'code', patchArtifactId: patch.id, changedFiles: [{ path: 'src/result.ts', change: 'added' }, { path: 'removed.txt', change: 'deleted' }, { path: 'binary.dat', change: 'modified' }] }; break;
      }
      case 'html-interactive': {
        const entry = artifact('index.html', 'html', 'text/html', Buffer.from(interactiveHtml));
        const assets = [artifact('assets/style.css', 'text', 'text/css', Buffer.from('body {background: rgb(20, 80, 130);} button {width: 180px;height:80px;font-size:24px;}')), artifact('assets/app.js', 'code', 'text/javascript', Buffer.from(interactiveJs)), artifact('assets/picture.png', 'image', 'image/png', png)];
        artifacts.push(entry, ...assets); result = { kind: 'html', entryArtifactId: entry.id, assetArtifactIds: assets.map((asset) => asset.id) }; break;
      }
      case 'browser-scenario': { const video = artifact('recording.webm', 'recording', 'video/webm', recording), screenshot = artifact('screenshot.png', 'image', 'image/png', png); artifacts.push(video, screenshot); result = { kind: 'browser', recordingArtifactId: video.id, format: 'webm', screenshotArtifactIds: [screenshot.id] }; break; }
      default: throw new Error('Unexpected task');
    }
    await post('/api/worker/attempts', { ...identity(), kind: 'started', attemptId: attempt.attemptId, startedAt: new Date().toISOString() });
    await post('/api/worker/attempts', { ...identity(), kind: 'terminal', attemptId: attempt.attemptId, outcome: { kind: 'completed', result, summary: 'Short summary only', artifacts: metadata(artifacts) }, artifacts, observed: { executableVersion: 'fixture', model: null } });
    records.push({ attemptId: attempt.attemptId, kind: result.kind, artifacts, resultUrl: `/api/configured-runs/${run.runId}/attempts/${attempt.attemptId}/result` });
  }
  return { run, records };
}
