import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { EnrollmentCommand, EnrollmentExchange, EnrollmentReceipt, RuntimeConfiguration } from '../../../packages/contracts/src/access.ts';
import { acquireLocalLock } from '../../../scripts/local-lock.ts';
import { durableDirectory, durableWrite } from './spool.ts';

export function runtimeRoot(stateRoot: string, configuration: RuntimeConfiguration) {
  return resolve(stateRoot, 'installations', configuration.installationId, configuration.runtimeId);
}
export async function stateLock(stateRoot: string, { wait = false }: { wait?: boolean } = {}) {
  await durableDirectory(resolve(stateRoot));
  await chmod(resolve(stateRoot), 0o700);
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { return await acquireLocalLock(resolve(stateRoot)); }
    catch (error) {
      if (!(error instanceof Error && error.message === 'Local server is already running for this state directory')) throw error;
      if (!wait) throw new Error('Runner state is busy. Stop the runner first if execution is active, or wait for pairing or capability refresh to finish and retry.');
      if (Date.now() >= deadline) throw new Error('Runner state remained busy for two minutes. Wait for pairing or capability refresh to finish and retry.');
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}
export async function executionLock(stateRoot: string) {
  const path = join(stateRoot, 'execution-lock');
  await durableDirectory(path);
  try { return await acquireLocalLock(path); }
  catch (error) {
    if (error instanceof Error && error.message.includes('already running')) throw new Error('Execution is active. Stop the runner first.');
    throw error;
  }
}
export async function clearState(stateRoot: string) {
  for (const name of await readdir(stateRoot)) await rm(join(stateRoot, name), { recursive: true, force: true });
}
export async function readConfiguration(stateRoot: string) {
  try { return RuntimeConfiguration.parse(JSON.parse(await readFile(join(stateRoot, 'config.json'), 'utf8'))); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') error.message = 'Unpaired. Create an enrollment token in the dashboard and run vibe-runner pair TOKEN.';
    throw error;
  }
}
export class RequestRejected extends Error {
  constructor(readonly status: number) { super(`Dashboard request rejected with HTTP ${status}. ${status === 401 ? 'Pair again with a valid enrollment token.' : 'Check the dashboard and retry.'}`); }
}
export async function workerPost(configuration: RuntimeConfiguration, path: string, body?: unknown): Promise<unknown> {
  return request(configuration.apiUrl, path, body, `${configuration.credentialId}.${configuration.secret}`);
}
async function request(apiUrl: string, path: string, body?: unknown, credential?: string): Promise<unknown> {
  const response = await fetch(new URL(path, apiUrl), { redirect: 'error', method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); throw new RequestRejected(response.status); }
  if (!response.body) throw new Error('Dashboard response has no body');
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16_000_000) throw new Error('Dashboard response exceeds limit'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function configureRuntime(stateRoot: string, encoded: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 16_000) throw new Error('Invalid enrollment token. Copy the complete token from the dashboard.');
  let command: ReturnType<typeof EnrollmentCommand.parse>;
  try { command = EnrollmentCommand.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))); }
  catch { throw new Error('Invalid enrollment token. Copy the complete token from the dashboard.'); }
  if (Date.parse(command.expiresAt) <= Date.now()) throw new Error('Enrollment token expired. Create a new token in the dashboard.');
  const exchange = EnrollmentExchange.parse({ requestId: randomUUID(), key: command.key, credentialId: randomUUID(), secret: randomBytes(32).toString('hex') });
  const receipt = EnrollmentReceipt.parse(await request(command.apiUrl, '/api/worker/enrollments', exchange));
  if (receipt.requestId !== exchange.requestId || receipt.credentialId !== exchange.credentialId) throw new Error('Enrollment receipt identity mismatch');
  const configuration = RuntimeConfiguration.parse({ version: 1, apiUrl: command.apiUrl, installationId: receipt.installationId, runtimeId: receipt.runtimeId, credentialId: receipt.credentialId, secret: exchange.secret });
  await durableDirectory(runtimeRoot(stateRoot, configuration));
  await durableWrite(join(stateRoot, 'config.json'), configuration);
  return configuration;
}
export function reconnectDelay(failures: number) { return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, failures - 1))); }
