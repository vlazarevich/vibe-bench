import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unusedPort } from './scripts/local-database.ts';
process.env.VIBE_BROWSER_PORT ??= String(await unusedPort());
const port = Number(process.env.VIBE_BROWSER_PORT);
process.env.VIBE_BROWSER_ROOT ??= resolve(`.artifacts/browser-${randomUUID()}`);
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 60_000,
  outputDir: '.artifacts/browser-results', reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx scripts/local.ts', url: `http://127.0.0.1:${port}/api/health`, timeout: 90_000, reuseExistingServer: false, env: { VIBE_PORT: String(port), VIBE_LOCAL_ROOT: process.env.VIBE_BROWSER_ROOT } },
});
