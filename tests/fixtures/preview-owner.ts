import { writeFile } from 'node:fs/promises';
import { isolatedChromium } from '../../apps/server/src/features/isolated-chromium.ts';

const file = process.argv[2];
if (!file) throw new Error('Missing readiness file');
const runtime = await isolatedChromium();
await runtime.browser.newPage();
await writeFile(file, 'ready');
setInterval(() => {}, 1000);
