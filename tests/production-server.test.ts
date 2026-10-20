import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { dashboardConfig } from '../scripts/dashboard-config.ts';
import { startDatabase, unusedPort } from '../scripts/local-database.ts';
// @ts-expect-error The build script is plain ESM shared with the CLI.
import { buildServer } from '../scripts/build-server.mjs';

const exec = promisify(execFile);
let root: string;
let server: string;
let database: Awaited<ReturnType<typeof startDatabase>>;

beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(resolve('.artifacts/production-server-'));
  server = await buildServer({ output: join(root, 'dist/server') });
  await mkdir(join(root, 'dist/web'));
  await writeFile(join(root, 'dist/web/index.html'), '<!doctype html><title>bundled web root</title>');
  database = await startDatabase(join(root, 'external-postgres'));
}, 120_000);

afterAll(async () => { await database?.stop(); });

const env = (extra: Record<string, string>) => {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VIBE_|DATABASE_URL$|POSTGRES_URL$)/.test(name)));
  return { ...inherited, ...extra };
};

async function launch(extra: Record<string, string>) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(server, 'serve.mjs')], { cwd: root, env: env({ ...extra, VIBE_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += String(data); });
  child.stderr.on('data', (data) => { output += String(data); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(`${origin}/api/health`)).status === 200) break; } catch {}
    if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error(`Server did not become healthy: ${output}`); }
    await setTimeout(100);
  }
  return { child, origin, output: () => output };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  child.kill('SIGTERM');
  return exited;
}

async function freshDatabase(name: string) {
  const admin = new pg.Client({ connectionString: database.url });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(database.url);
  url.pathname = `/${name}`;
  return url.href;
}

test('reads external and embedded database settings', () => {
  expect(dashboardConfig({ DATABASE_URL: 'postgres://u:p@db/x', POSTGRES_URL: 'postgres://other/y' })).toMatchObject({ database: { kind: 'external', url: 'postgres://u:p@db/x' }, host: '127.0.0.1', port: 0 });
  expect(dashboardConfig({ DATABASE_URL: ' ', POSTGRES_URL: 'postgresql://neon/z?sslmode=require' }).database).toEqual({ kind: 'external', url: 'postgresql://neon/z?sslmode=require' });
  expect(dashboardConfig({ VIBE_LOCAL_ROOT: '/srv/vibe', VIBE_HOST: '0.0.0.0', VIBE_PORT: '8080', VIBE_APP_PASSWORD: 'secret' })).toEqual({ database: { kind: 'embedded', root: '/srv/vibe' }, host: '0.0.0.0', port: 8080, worker: undefined });
  expect(dashboardConfig({ VIBE_WORKER_HOST: '127.0.0.1', VIBE_WORKER_PORT: '8081' }).worker).toEqual({ host: '127.0.0.1', port: 8081 });
  expect(() => dashboardConfig({ VIBE_HOST: '0.0.0.0' })).toThrow(/set VIBE_APP_PASSWORD/);
  expect(() => dashboardConfig({ VIBE_HOST: '192.168.1.5', VIBE_APP_PASSWORD: '  ' })).toThrow(/set VIBE_APP_PASSWORD/);
  for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1']) expect(dashboardConfig({ VIBE_HOST: ` ${host} ` }).host).toBe(host);
  expect(dashboardConfig({ VIBE_WORKER_HOST: '0.0.0.0', VIBE_WORKER_PORT: '8081' }).worker).toEqual({ host: '0.0.0.0', port: 8081 });
  expect(() => dashboardConfig({ DATABASE_URL: 'mysql://db/x' })).toThrow(/postgres/);
  expect(() => dashboardConfig({ VIBE_PORT: '70000' })).toThrow();
  expect(() => dashboardConfig({ VIBE_WORKER_PORT: '8081' })).toThrow();
});

test('bundled dashboards share an external database without local state', async () => {
  const url = await freshDatabase('shared_dashboard');
  const unusedState = join(root, 'never-created');
  const settings = { DATABASE_URL: url, VIBE_LOCAL_ROOT: unusedState };
  const [first, second] = await Promise.all([launch(settings), launch(settings)]);
  try {
    expect(first.output()).toContain('Database: external PostgreSQL');
    for (const { origin } of [first, second]) {
      expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ ok: true });
      expect(await (await fetch(`${origin}/`)).text()).toContain('bundled web root');
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try { expect((await client.query('SELECT count(*)::int AS count FROM schema_migrations')).rows).toEqual([{ count: 11 }]); }
    finally { await client.end(); }
    await expect(access(unusedState)).rejects.toThrow();
  } finally {
    expect(await stop(first.child)).toBe(0);
    expect(await stop(second.child)).toBe(0);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { expect((await client.query('SELECT 1 AS alive')).rows).toEqual([{ alive: 1 }]); } finally { await client.end(); }
}, 180_000);

test('bundled migration command upgrades an external database idempotently', async () => {
  const url = await freshDatabase('migrated_dashboard');
  const migrate = join(server, 'migrate.mjs');
  for (let run = 0; run < 2; run++) expect((await exec(process.execPath, [migrate], { cwd: root, env: env({ DATABASE_URL: url }) })).stdout).toContain('migrations are current');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { expect((await client.query('SELECT count(*)::int AS count FROM schema_migrations')).rows).toEqual([{ count: 11 }]); }
  finally { await client.end(); }
  await expect(exec(process.execPath, [migrate], { cwd: root, env: env({}) })).rejects.toThrow(/Set DATABASE_URL/);
}, 60_000);

test('bundled dashboard owns embedded PostgreSQL state', async () => {
  const state = join(root, 'embedded-state');
  const owner = await launch({ VIBE_LOCAL_ROOT: state });
  try {
    expect(owner.output()).toContain(`State: ${state}`);
    await access(join(state, 'postgres', 'PG_VERSION'));
    await expect(launch({ VIBE_LOCAL_ROOT: state })).rejects.toThrow(/already running/);
  } finally { expect(await stop(owner.child)).toBe(0); }
  await expect(access(join(state, 'postgres', 'postmaster.pid'))).rejects.toThrow();
}, 180_000);

test('terminated idle database connections do not stop the dashboard', async () => {
  const url = await freshDatabase('terminated_connections');
  const dashboard = await launch({ DATABASE_URL: url });
  try {
    const admin = new pg.Client({ connectionString: database.url });
    await admin.connect();
    try {
      const terminated = await admin.query("SELECT count(*)::int AS count FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'terminated_connections' AND pid <> pg_backend_pid()) AS ended");
      expect(terminated.rows[0].count).toBeGreaterThan(0);
    } finally { await admin.end(); }
    await setTimeout(200);
    expect(dashboard.child.exitCode).toBeNull();
    expect(await (await fetch(`${dashboard.origin}/api/health`)).json()).toEqual({ ok: true });
    expect(dashboard.output()).toContain('PostgreSQL idle connection closed');
  } finally { expect(await stop(dashboard.child)).toBe(0); }
}, 120_000);
