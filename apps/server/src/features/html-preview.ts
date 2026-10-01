import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { PreviewInput, PreviewFrame } from '../../../../packages/contracts/src/artifact-viewer.ts';
import { isolatedChromium } from './isolated-chromium.ts';

export type HtmlBundle = { entry: string; files: { name: string; mediaType: string; bytes: Buffer }[] };
type Session = { owner: string; runtime: Awaited<ReturnType<typeof isolatedChromium>>; page: Page; blocked: number; touched: number; busy: boolean };
export class PreviewUnavailable extends Error { constructor() { super('Interactive preview is unavailable. Download the source to inspect it.'); } }

export class HtmlPreviews {
  private sessions = new Map<string, Session>();
  private opening = 0;
  private closed = false;
  private timer = setInterval(() => { for (const [id, session] of this.sessions) if (Date.now() - session.touched > 30_000) void this.remove(id); }, 1000);
  constructor() { this.timer.unref(); }
  async open(owner: string, bundle: HtmlBundle) {
    if (this.closed || this.sessions.size + this.opening >= 2) throw new PreviewUnavailable();
    this.opening++;
    let runtime: Awaited<ReturnType<typeof isolatedChromium>> | undefined;
    try {
      runtime = await isolatedChromium();
      if (this.closed) throw new PreviewUnavailable();
      const context = await runtime.browser.newContext({ viewport: { width: 960, height: 640 }, serviceWorkers: 'block', acceptDownloads: false });
      const files = new Map(bundle.files.map((file) => [new URL(file.name.split('/').map(encodeURIComponent).join('/'), 'https://preview.invalid/').pathname, file]));
      const page = await context.newPage();
      const session: Session = { owner, runtime, page, blocked: 0, touched: Date.now(), busy: true };
      context.on('page', (popup) => { if (popup !== page) { session.blocked++; void popup.close(); } });
      await context.routeWebSocket('**/*', (socket) => { session.blocked++; socket.close(); });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const file = url.origin === 'https://preview.invalid' ? files.get(url.pathname) : undefined;
        if (!file) { session.blocked++; await route.abort(); return; }
        await route.fulfill({ body: file.bytes, contentType: file.mediaType.startsWith('text/') ? `${file.mediaType}; charset=utf-8` : file.mediaType, headers: { 'Content-Security-Policy': "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'", 'X-Content-Type-Options': 'nosniff' } });
      });
      page.setDefaultTimeout(3000);
      await page.goto(new URL(bundle.entry.split('/').map(encodeURIComponent).join('/'), 'https://preview.invalid/').href, { waitUntil: 'domcontentloaded', timeout: 5000 });
      const frame = await this.capture(session);
      if (this.closed) throw new PreviewUnavailable();
      session.busy = false;
      const previewId = randomUUID();
      this.sessions.set(previewId, session);
      runtime.browser.once('disconnected', () => { void this.remove(previewId); });
      return { previewId, frame };
    } catch { await runtime?.close(); throw new PreviewUnavailable(); }
    finally { this.opening--; }
  }
  async input(owner: string, id: string, input: PreviewInput): Promise<PreviewFrame> {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.busy) throw new PreviewUnavailable();
    const delay = Math.max(0, 150 - (Date.now() - session.touched));
    session.busy = true; session.touched = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          switch (input.kind) {
            case 'refresh': break;
            case 'click': await session.page.mouse.click(input.x, input.y); break;
            case 'type': await session.page.keyboard.insertText(input.text); break;
            case 'key': await session.page.keyboard.press(input.key); break;
            case 'scroll': await session.page.mouse.wheel(input.deltaX, input.deltaY); break;
          }
          return this.capture(session);
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PreviewUnavailable()), 5000); }),
      ]);
    } catch { await this.remove(id); throw new PreviewUnavailable(); }
    finally { clearTimeout(timer); session.busy = false; }
  }
  async close(owner: string, id: string) { if (this.sessions.get(id)?.owner === owner) await this.remove(id); }
  private async capture(session: Session): Promise<PreviewFrame> { return { png: (await session.page.screenshot({ type: 'png', timeout: 3000 })).toString('base64'), blockedRequests: session.blocked }; }
  private async remove(id: string) { const session = this.sessions.get(id); this.sessions.delete(id); await session?.runtime.close(); }
  async shutdown() { this.closed = true; clearInterval(this.timer); await Promise.all([...this.sessions.keys()].map((id) => this.remove(id))); }
}
