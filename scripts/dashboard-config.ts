import { resolve } from 'node:path';
import { z } from 'zod';

const Port = z.coerce.number().int().min(0).max(65535);
const DatabaseUrl = z
  .string()
  .trim()
  .refine((value) => /^postgres(?:ql)?:\/\/./.test(value), 'Database URL must use postgres:// or postgresql://');

export type DashboardConfig = {
  database: { kind: 'external'; url: string } | { kind: 'embedded'; root: string };
  host: string;
  port: number;
  worker: { host: string; port: number } | undefined;
};

/** Reads dashboard process settings. DATABASE_URL (or POSTGRES_URL) selects external PostgreSQL; otherwise embedded state lives under VIBE_LOCAL_ROOT. */
export function dashboardConfig(env: NodeJS.ProcessEnv = process.env): DashboardConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const url = value('DATABASE_URL') ?? value('POSTGRES_URL');
  const worker =
    value('VIBE_WORKER_HOST') === undefined && value('VIBE_WORKER_PORT') === undefined
      ? undefined
      : z
          .object({ host: z.string().min(1), port: Port.min(1) })
          .parse({ host: value('VIBE_WORKER_HOST'), port: value('VIBE_WORKER_PORT') });
  const host = z.string().min(1).parse(value('VIBE_HOST') ?? '127.0.0.1');
  // Host checks only stop DNS rebinding; scripts can send any Host, so a network dashboard listener needs the password.
  if (!loopback(host) && value('VIBE_APP_PASSWORD') === undefined)
    throw new Error(`VIBE_HOST=${host} accepts network connections; set VIBE_APP_PASSWORD or bind a loopback address`);
  return {
    database:
      url === undefined
        ? { kind: 'embedded', root: resolve(value('VIBE_LOCAL_ROOT') ?? '.local') }
        : { kind: 'external', url: DatabaseUrl.parse(url) },
    host,
    port: Port.parse(value('VIBE_PORT') ?? 0),
    worker,
  };
}

function loopback(host: string) {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}
