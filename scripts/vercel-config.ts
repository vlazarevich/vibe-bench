import { z } from 'zod';
import { ApiUrl } from '../packages/contracts/src/access.ts';

/** Hosted entry points never fall back to a local database or passwordless access. */
export function vercelConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = (name: string) => env[name]?.trim() || undefined;
  const databaseUrl = z.string().refine((url) => /^postgres(?:ql)?:\/\/./.test(url), 'Set DATABASE_URL or POSTGRES_URL to an external PostgreSQL URL')
    .parse(value('DATABASE_URL') ?? value('POSTGRES_URL'));
  const password = z.string().min(1, 'Set VIBE_APP_PASSWORD for the hosted dashboard').parse(value('VIBE_APP_PASSWORD'));
  const domain = value('VERCEL_ENV') === 'production'
    ? value('VERCEL_PROJECT_PRODUCTION_URL') ?? value('VERCEL_URL')
    : value('VERCEL_URL');
  const publicUrl = ApiUrl.parse(value('VIBE_PUBLIC_URL') ?? (domain ? `https://${domain}` : undefined));
  if (!publicUrl.startsWith('https://')) throw new Error('The Vercel dashboard requires an HTTPS public URL');
  if (value('VIBE_WORKER_HOST') || value('VIBE_WORKER_PORT'))
    throw new Error('Vercel uses the dashboard function for /api/worker/; remove VIBE_WORKER_HOST and VIBE_WORKER_PORT');
  return { databaseUrl, password, publicUrl };
}
