import { z } from 'zod';
import { RuntimeId } from './runtime.ts';

export const InstallationId = z.uuid().brand<'InstallationId'>();
export const CredentialId = z.uuid().brand<'CredentialId'>();
export const Secret = z.string().regex(/^[a-f0-9]{64}$/);
export const ApiUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.origin === value && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}, 'Use an HTTPS origin or loopback HTTP origin');
export const EnrollmentCommand = z.object({ apiUrl: ApiUrl, key: Secret, expiresAt: z.iso.datetime() }).strict();
export const CreateEnrollment = z.object({ target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('new') }).strict(), z.object({ kind: z.literal('replace'), runtimeId: RuntimeId }).strict()]) }).strict();
export const EnrollmentExchange = z.object({ requestId: z.uuid(), key: Secret, credentialId: CredentialId, secret: Secret }).strict();
export type EnrollmentExchange = z.infer<typeof EnrollmentExchange>;
export const EnrollmentReceipt = z.object({ installationId: InstallationId, runtimeId: RuntimeId, credentialId: CredentialId, requestId: z.uuid() }).strict();
export const RuntimeConfiguration = z.object({ version: z.literal(1), apiUrl: ApiUrl, installationId: InstallationId, runtimeId: RuntimeId, credentialId: CredentialId, secret: Secret }).strict();
export type RuntimeConfiguration = z.infer<typeof RuntimeConfiguration>;
export const SessionStatus = z.object({ passwordRequired: z.boolean(), authenticated: z.boolean() }).strict();
export const RuntimeAccess = z.array(z.object({ runtimeId: RuntimeId, active: z.boolean() }).strict());
