import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { z } from 'zod';

export async function isolatedChromium() {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-preview-'));
  const executable = join(directory, 'chromium');
  const pidFile = join(directory, 'browser.pid');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const browserDirectory = dirname(await realpath(chromium.executablePath()));
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > ${quote(pidFile)}\nexec /usr/bin/bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --ro-bind /usr/lib /usr/lib --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind ${quote(browserDirectory)} /browser --ro-bind /usr/share/fonts /usr/share/fonts --ro-bind /etc/fonts /etc/fonts --proc /proc --dev /dev --tmpfs /tmp --tmpfs /home --setenv HOME /tmp --setenv TMPDIR /tmp --chdir /tmp /browser/chrome "$@"\n`, { mode: 0o700 });
    browser = await chromium.launch({ executablePath: executable, env: { PATH: '/usr/bin', HOME: '/tmp', TMPDIR: '/tmp' }, timeout: 10_000, args: ['--disable-background-networking', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    const launched = browser;
    const pid = z.coerce.number().int().positive().parse(await readFile(pidFile, 'utf8'));
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      clearTimeout(lifetime);
      try {
        if (launched.isConnected()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        await launched.close();
      } finally { await rm(directory, { recursive: true, force: true }); }
    })();
    const lifetime = setTimeout(() => { void close().catch(() => undefined); }, 120_000);
    lifetime.unref();
    return { browser, close };
  } catch (error) { await browser?.close(); await rm(directory, { recursive: true, force: true }); throw error; }
}
