import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { SafePath, safeFile, type TaskIO } from './materials.ts';

import { BrowserPlan } from '../../../packages/contracts/src/work.ts';
export { BrowserPlan };
export async function runBrowserScenario({ workspace, directory, browser: settings, plan, timeoutMs }: { workspace: string; directory: string; browser: NonNullable<TaskIO['browser']>; plan: BrowserPlan; timeoutMs: number }) {
  if (settings.kind === 'local') await safeFile(workspace, settings.entry);
  await mkdir(directory, { recursive: true });
  const server = createServer((request, response) => { void (async () => {
    try { const name = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).slice(1); const body = await safeFile(workspace, name || (settings.kind === 'local' ? settings.entry : 'index.html')); response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(name)] ?? 'application/octet-stream')); response.end(body); }
    catch { response.statusCode = 404; response.end(); }
  })(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser server did not bind');
  const startUrl = settings.kind === 'local' ? `http://127.0.0.1:${address.port}/${settings.entry}` : settings.startUrl;
  const origin = new URL(startUrl).origin;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: {width:1280,height:720}, recordVideo: { dir: directory, size: {width:1280,height:720} }, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => { void context.close(); }, timeoutMs);
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      await page.goto(startUrl, { timeout: Math.min(timeoutMs, 10_000) });
      for (const action of plan.steps) {
        page.setDefaultTimeout(Math.max(1, Math.min(10_000, deadline - Date.now())));
        if (Date.now() >= deadline) throw new Error('Browser scenario exceeded deadline');
        switch (action.kind) {
          case 'goto': await page.goto(new URL(action.url).origin === origin ? action.url : (() => { throw new Error('Cross-origin navigation is not allowed'); })()); break;
          case 'click': await page.locator(action.selector).click(); break;
          case 'fill': await page.locator(action.selector).fill(action.value); break;
          case 'screenshot': {const path = join(directory, SafePath.parse(action.path)); await mkdir(dirname(path),{recursive:true}); await page.screenshot({path}); break;}
          case 'expect-text': if (!(await page.locator(action.selector).innerText()).includes(action.text)) throw new Error('Browser text assertion failed'); break;
        }
      }
      await context.tracing.stop({ path: join(directory, 'trace.zip') });
      const video = page.video();
      await context.close();
      if (!video) throw new Error('Browser did not create a recording');
      const videoPath = await video.path();
      const trace = await readFile(join(directory, 'trace.zip'));
      const webm = await readFile(videoPath);
      if (trace.length < 100 || trace.readUInt32LE(0) !== 0x04034b50 || webm.length < 100 || webm.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('Browser recording is invalid');
      if ((await stat(videoPath)).size > 8_000_000 || trace.length > 8_000_000) throw new Error('Browser recording exceeds artifact limit');
      return { trace: join(directory, 'trace.zip'), video: videoPath };
    } finally { clearTimeout(timer); await context.close(); }
  } finally { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
