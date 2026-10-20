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
  const value = (name: string) => (env[name]?.trim() ? env[name] : undefined);
  const url = value('DATABASE_URL') ?? value('POSTGRES_URL');
  const worker =
    value('VIBE_WORKER_HOST') === undefined && value('VIBE_WORKER_PORT') === undefined
      ? undefined
      : z
          .object({ host: z.string().min(1), port: Port.min(1) })
          .parse({ host: value('VIBE_WORKER_HOST'), port: value('VIBE_WORKER_PORT') });
  return {
    database:
      url === undefined
        ? { kind: 'embedded', root: resolve(value('VIBE_LOCAL_ROOT') ?? '.local') }
        : { kind: 'external', url: DatabaseUrl.parse(url) },
    host: z.string().min(1).parse(value('VIBE_HOST') ?? '127.0.0.1'),
    port: Port.parse(value('VIBE_PORT') ?? 0),
    worker,
  };
}
