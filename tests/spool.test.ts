import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { durableWrite } from '../apps/runner/src/spool.ts';

test('concurrent immutable writes converge and conflicting writes preserve the original', async () => {
  await mkdir('.artifacts', { recursive: true });
  const directory = await mkdtemp(resolve('.artifacts/spool-'));
  const path = join(directory, 'receipt.json');
  const receipt = { accepted: true, reportId: 'same-report' };
  await Promise.all(Array.from({ length: 16 }, () => durableWrite(path, receipt, 'create')));
  await expect(durableWrite(path, { accepted: true, reportId: 'different-report' }, 'create')).rejects.toThrow('conflicts');
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(receipt);
  expect(await readdir(directory)).toEqual(['receipt.json']);
});
