import { expect, test } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { HtmlPreviews, PreviewUnavailable, type HtmlBundle } from '../apps/server/src/features/html-preview.ts';
import { isolatedChromium } from '../apps/server/src/features/isolated-chromium.ts';
import { interactiveHtml, interactiveJs, png } from './artifact-fixtures.ts';

async function descendants(pid = process.pid): Promise<number[]> {
  try {
    const children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
    return [...children, ...(await Promise.all(children.map((child) => descendants(child)))).flat()];
  } catch { return []; }
}
async function stopped(pids: number[]) {
  expect(pids.length).toBeGreaterThan(0);
  await expect.poll(async () => (await Promise.all(pids.map(async (pid) => {
    try { return !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
  }))).some(Boolean), { timeout: 5000 }).toBe(false);
}
const bundle: HtmlBundle = { entry: 'nested/index.html', files: [
  { name: 'nested/index.html', mediaType: 'text/html', bytes: Buffer.from(interactiveHtml) },
  { name: 'nested/assets/style.css', mediaType: 'text/css', bytes: Buffer.from('body{background:rgb(12,80,140)}button{height:80px;width:180px}') },
  { name: 'nested/assets/app.js', mediaType: 'text/javascript', bytes: Buffer.from(interactiveJs) },
  { name: 'nested/assets/picture.png', mediaType: 'image/png', bytes: png },
] };
test('real isolated Chromium cannot reach host loopback or host files even without request interception', async () => {
  let hits = 0;
  const listener = createServer((_request, response) => { hits++; response.end('secret'); });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error();
  const runtime = await isolatedChromium();
  try {
    const page = await runtime.browser.newPage();
    await expect(page.goto(`http://127.0.0.1:${address.port}/canary`, { timeout: 1500 })).rejects.toThrow();
    await expect(page.goto('file:///etc/passwd')).rejects.toThrow();
    await expect(page.goto(`file://${process.cwd()}/package.json`)).rejects.toThrow();
    await expect(page.goto('file:///home/deck/.codex/config.toml')).rejects.toThrow();
    expect(hits).toBe(0);
  } finally { await runtime.close(); await new Promise<void>((resolve) => listener.close(() => resolve())); }
});
test('bundled local assets, click/type/key/scroll/refresh and capacity use real isolated browser frames', async () => {
  const previews = new HtmlPreviews();
  try {
    const first = await previews.open('owner', bundle);
    const firstProcesses = await descendants();
    expect(Buffer.from(first.frame.png, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(first.frame.blockedRequests).toBe(0);
    const clicked = await previews.input('owner', first.previewId, { kind: 'click', x: 50, y: 40 }); expect(clicked.png).not.toBe(first.frame.png);
    await previews.input('owner', first.previewId, { kind: 'key', key: 'Tab' });
    const typed = await previews.input('owner', first.previewId, { kind: 'type', text: 'Saved local interaction' }); expect(typed.png).not.toBe(clicked.png);
    await previews.input('owner', first.previewId, { kind: 'scroll', deltaX: 0, deltaY: 400 });
    await previews.input('owner', first.previewId, { kind: 'refresh' });
    await expect(previews.input('other', first.previewId, { kind: 'refresh' })).rejects.toThrow(PreviewUnavailable);
    const second = await previews.open('other', bundle);
    await expect(previews.open('third', bundle)).rejects.toThrow(PreviewUnavailable);
    await previews.close('owner', first.previewId);
    await stopped(firstProcesses);
    await expect(previews.input('owner', first.previewId, { kind: 'refresh' })).rejects.toThrow(PreviewUnavailable);
    await previews.close('other', second.previewId);
  } finally { await previews.shutdown(); }
});
test('hostile self-navigation and network channels cannot reach host endpoints', async () => {
  let hits = 0;
  const listener = createServer((_request, response) => { hits++; response.end('canary'); });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error();
  const url = `http://127.0.0.1:${address.port}/leak`;
  const previews = new HtmlPreviews();
  try {
    const hostile = `<script>fetch('${url}');new Image().src='${url}';new WebSocket('ws://127.0.0.1:${address.port}/socket');window.open('${url}');setTimeout(()=>location.href='${url}',100);</script><p>hostile</p>`;
    const opened = await previews.open('hostile', { entry: 'index.html', files: [{ name: 'index.html', mediaType: 'text/html', bytes: Buffer.from(hostile) }] }).catch((error: unknown) => { expect(error).toBeInstanceOf(PreviewUnavailable); return null; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (opened) await previews.input('hostile', opened.previewId, { kind: 'refresh' }).catch((error: unknown) => expect(error).toBeInstanceOf(PreviewUnavailable));
    expect(hits).toBe(0);
  } finally { await previews.shutdown(); await new Promise<void>((resolve) => listener.close(() => resolve())); }
});
test('busy scripts fail within deadlines and shutdown during launch leaves no usable session', async () => {
  const previews = new HtmlPreviews();
  try {
    const started = Date.now();
    const busy = previews.open('busy', { entry: 'index.html', files: [{ name: 'index.html', mediaType: 'text/html', bytes: Buffer.from('<script>while(true){}</script>') }] });
    let busyProcesses: number[] = [];
    await expect.poll(async () => { busyProcesses = await descendants(); return busyProcesses.length; }).toBeGreaterThan(0);
    await expect(busy).rejects.toThrow(PreviewUnavailable);
    await stopped(busyProcesses);
    expect(Date.now() - started).toBeLessThan(15000);
    await previews.open('existing', bundle);
    const shutdownProcesses = await descendants();
    const pending = previews.open('shutdown', bundle); await previews.shutdown();
    await stopped(shutdownProcesses);
    await expect(pending).rejects.toThrow(PreviewUnavailable);
    await expect(previews.open('closed', bundle)).rejects.toThrow(PreviewUnavailable);
  } finally { await previews.shutdown(); }
});
test('idle preview expires and releases its slot', async () => {
  const previews = new HtmlPreviews();
  try {
    const opened = await previews.open('idle', bundle);
    const idleProcesses = await descendants();
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    await stopped(idleProcesses);
    await expect(previews.input('idle', opened.previewId, { kind: 'refresh' })).rejects.toThrow(PreviewUnavailable);
    const next = await previews.open('next', bundle); await previews.close('next', next.previewId);
  } finally { await previews.shutdown(); }
});

test('refresh captures delayed scripts and normalized local unicode asset URLs', async () => {
  const previews = new HtmlPreviews();
  try {
    const opened = await previews.open('delayed', { entry: 'pages/index.html', files: [
      { name: 'pages/index.html', mediaType: 'text/html', bytes: Buffer.from('<link rel="stylesheet" href="../assets/café style.css?v=2"><button style="width:200px;height:100px" onclick="setTimeout(()=>document.body.style.background=\'red\',400)">Change later</button>') },
      { name: 'assets/café style.css', mediaType: 'text/css', bytes: Buffer.from('body{background:blue}') },
    ] });
    expect(opened.frame.blockedRequests).toBe(0);
    const initial = await previews.input('delayed', opened.previewId, { kind: 'click', x: 50, y: 50 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const refreshed = await previews.input('delayed', opened.previewId, { kind: 'refresh' });
    expect(refreshed.png).not.toBe(initial.png);
  } finally { await previews.shutdown(); }
});

test('simultaneous creation reserves only two browser slots before launch', async () => {
  const previews = new HtmlPreviews();
  try {
    const results = await Promise.allSettled(['one', 'two', 'three'].map((owner) => previews.open(owner, bundle)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const processes = await descendants(); await previews.shutdown(); await stopped(processes);
  } finally { await previews.shutdown(); }
});

test('killing the preview owner terminates its real namespace descendants', async () => {
  const directory = await mkdtemp(resolve('.artifacts/preview-owner-'));
  const ready = join(directory, 'ready');
  const owner = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/preview-owner.ts'), ready], { stdio: 'ignore' });
  try {
    await expect.poll(async () => { try { return await readFile(ready, 'utf8'); } catch { return ''; } }, { timeout: 15000 }).toBe('ready');
    if (!owner.pid) throw new Error('No owner process');
    const children = await descendants(owner.pid);
    owner.kill('SIGKILL');
    await stopped(children);
  } finally { owner.kill('SIGKILL'); }
});
