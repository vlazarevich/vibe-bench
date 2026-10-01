import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EnrollmentCommand, EnrollmentReceipt, RuntimeConfiguration } from '../packages/contracts/src/access.ts';

export async function enrollRuntime(apiUrl: string, runtimeId?: string, cookie = '') {
  const created = await fetch(`${apiUrl}/api/runtime-enrollments`, { method: 'POST', headers: { origin: apiUrl, 'content-type': 'application/json', cookie }, body: JSON.stringify({ target: runtimeId ? { kind: 'replace', runtimeId } : { kind: 'new' } }) });
  if (!created.ok) throw new Error(`Enrollment creation failed ${created.status}`);
  const { command } = z.object({ command: z.string() }).parse(await created.json());
  const payload = EnrollmentCommand.parse(JSON.parse(Buffer.from(command.split(' ')[2] ?? '', 'base64url').toString()));
  const exchange = { requestId: randomUUID(), key: payload.key, credentialId: randomUUID(), secret: randomBytes(32).toString('hex') };
  const response = await fetch(`${apiUrl}/api/worker/enrollments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exchange) });
  if (!response.ok) throw new Error(`Enrollment exchange failed ${response.status}`);
  const receipt = EnrollmentReceipt.parse(await response.json());
  return RuntimeConfiguration.parse({ version: 1, apiUrl, installationId: receipt.installationId, runtimeId: receipt.runtimeId, credentialId: receipt.credentialId, secret: exchange.secret });
}
export const runtimeAuthorization = (configuration: RuntimeConfiguration) => `Bearer ${configuration.credentialId}.${configuration.secret}`;
