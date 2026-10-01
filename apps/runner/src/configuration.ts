import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { EnrollmentCommand, EnrollmentExchange, EnrollmentReceipt, RuntimeConfiguration } from '../../../packages/contracts/src/access.ts';
import { acquireLocalLock } from '../../../scripts/local-lock.ts';
import { durableDirectory, durableWrite } from './spool.ts';

const PendingEnrollment = z.object({ command: EnrollmentCommand, exchange: EnrollmentExchange }).strict();
export function runtimeRoot(stateRoot: string, configuration: RuntimeConfiguration) {
  return resolve(stateRoot, 'installations', configuration.installationId, configuration.runtimeId);
}
export async function readConfiguration(stateRoot: string) {
  return RuntimeConfiguration.parse(JSON.parse(await readFile(join(stateRoot, 'config.json'), 'utf8')));
}
export async function workerPost(configuration: RuntimeConfiguration, path: string, body: unknown) {
  return post(configuration.apiUrl, path, body, `${configuration.credentialId}.${configuration.secret}`);
}
async function post(apiUrl: string, path: string, body: unknown, credential?: string): Promise<unknown> {
  const response = await fetch(new URL(path, apiUrl), { redirect: 'error', method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Runtime request rejected with HTTP ${response.status}`); }
  if (!response.body) throw new Error('Runtime response has no body');
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16_000_000) { throw new Error('Runtime response exceeds limit'); } chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function configureRuntime(stateRoot: string, encoded?: string) {
  await durableDirectory(resolve(stateRoot));
  await chmod(resolve(stateRoot), 0o700);
  const release = await acquireLocalLock(resolve(stateRoot));
  try {
    const pendingPath = join(stateRoot, 'enrollment-pending.json');
    let pending: z.infer<typeof PendingEnrollment>;
    if (encoded) {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 16_000) throw new Error('Invalid enrollment command');
      const command = EnrollmentCommand.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
      try { pending = PendingEnrollment.parse(JSON.parse(await readFile(pendingPath, 'utf8'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; pending = { command, exchange: EnrollmentExchange.parse({ requestId: randomUUID(), key: command.key, credentialId: randomUUID(), secret: randomBytes(32).toString('hex') }) }; }
      if (JSON.stringify(pending.command) !== JSON.stringify(command)) throw new Error('A different enrollment is pending. Retry config without an argument to recover it.');
    } else pending = PendingEnrollment.parse(JSON.parse(await readFile(pendingPath, 'utf8')));
    await durableWrite(pendingPath, pending);
    const receipt = EnrollmentReceipt.parse(await post(pending.command.apiUrl, '/api/worker/enrollments', pending.exchange));
    if (receipt.requestId !== pending.exchange.requestId || receipt.credentialId !== pending.exchange.credentialId) throw new Error('Enrollment receipt identity mismatch');
    const configuration = RuntimeConfiguration.parse({ version: 1, apiUrl: pending.command.apiUrl, installationId: receipt.installationId, runtimeId: receipt.runtimeId, credentialId: receipt.credentialId, secret: pending.exchange.secret });
    await durableDirectory(runtimeRoot(stateRoot, configuration));
    await durableWrite(join(stateRoot, 'config.json'), configuration);
    await rm(pendingPath);
    return configuration;
  } finally { await release(); }
}
