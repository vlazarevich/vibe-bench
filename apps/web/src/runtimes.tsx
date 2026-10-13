import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { DashboardRuntimes, type DashboardRuntime } from '../../../packages/contracts/src/dashboard.ts';
import { Button, Dialog, Input, RuntimeCard, Tabs, Icon, type Capability } from './design-system';
import { api, Okay, Empty, Confirm, errorMessage, Notice, runLabel } from './ui.tsx';
const Enrollment = z.object({ command: z.string(), expiresAt: z.iso.datetime(), runtimeId: z.string() });
function capabilities(runtime: DashboardRuntime): Capability[] {
  return (['codex', 'claude', 'opencode'] as const).map((app) => {
    const tool = runtime.registration?.tools.find((t) => t.name === app);
    const readiness = runtime.registration?.harnesses[app === 'opencode' ? 'opencodeGo' : app];
    return {
      app,
      ...(readiness?.kind === 'ready'
        ? {
            auth: readiness.accountType
              ? {
                  type: readiness.accountType === 'subscription' ? ('Subscription' as const) : ('API key' as const),
                  detail:
                    readiness.accountType === 'subscription'
                      ? 'Signed in with subscription'
                      : 'Provider authentication',
                }
              : undefined,
            models:
              readiness.modelDetails ??
              readiness.models?.map((id) => ({ id, name: id.split('/').at(-1) ?? id, modalities: [] })),
          }
        : {}),
      state:
        tool?.availability.kind === 'available' ? (readiness?.kind === 'ready' ? 'ready' : 'installed') : 'missing',
      version: tool?.availability.kind === 'available' ? (tool.availability.version ?? undefined) : undefined,
    };
  });
}
export function Runtimes() {
  const [items, setItems] = useState<DashboardRuntime[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [tab, setTab] = useState('all'),
    [busy, setBusy] = useState(false),
    [enrollment, setEnrollment] = useState<z.infer<typeof Enrollment> | null>(null),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState<{ kind: 'revoke' | 'delete'; runtime: DashboardRuntime } | null>(null);
  const refresh = useCallback(async () => {
    setItems(await api('/api/dashboard/runtimes', DashboardRuntimes));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => void refresh().catch((e) => setError(errorMessage(e))), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function connect(runtime?: DashboardRuntime) {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      setEnrollment(
        await api('/api/runtime-enrollments', Enrollment, {
          target: runtime ? { kind: 'replace', runtimeId: runtime.id } : { kind: 'new' },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const connected = enrollment
    ? items.find(
        (r) =>
          r.id === enrollment.runtimeId &&
          r.connected &&
          r.registration &&
          r.lastSeen &&
          Date.parse(r.lastSeen) > Date.parse(enrollment.expiresAt) - 15 * 60_000,
      )
    : null;
  const filtered = items.filter(
    (r) => (tab === 'all' || r.state === tab) && `${r.name} ${r.os}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="page">
      <div className="page-head">
        <h1>Runtimes</h1>
        {items.length > 0 && (
          <Button variant="primary" icon="plus" disabled={busy} onClick={() => void connect()}>
            Connect runtime
          </Button>
        )}
      </div>
      <Notice error={error} />
      {!loaded ? (
        <p role="status">Loading runtimes…</p>
      ) : items.length === 0 ? (
        <Empty
          icon="runtime"
          title="Connect your first runtime"
          action={
            <Button variant="primary" icon="plus" disabled={busy} onClick={() => void connect()}>
              Connect runtime
            </Button>
          }
        >
          A runtime is a machine that runs tasks for your runs. Connect one with a single command.
        </Empty>
      ) : (
        <>
          <div className="toolbar">
            <Tabs
              label="Filter runtimes"
              value={tab}
              onChange={setTab}
              items={['all', 'working', 'ready', 'offline'].map((id) => ({
                id,
                label: id[0]!.toUpperCase() + id.slice(1),
                count: items.filter((r) => id === 'all' || r.state === id).length,
              }))}
            />
            <Input
              className="search-field"
              icon="search"
              aria-label="Filter runtimes"
              placeholder="Filter by name or OS"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="card-list">
            {filtered.map((r) => (
              <RuntimeCard
                key={r.id}
                name={r.name}
                state={r.state}
                connected={r.connected}
                os={r.os}
                capabilities={capabilities(r)}
                progress={
                  r.run
                    ? {
                        done: r.run.done,
                        total: r.run.total,
                        runLabel: runLabel(r.run.number),
                        runHref: `/?view=runs&run=${r.run.id}`,
                      }
                    : undefined
                }
                lastSeen={r.lastSeen ? { iso: r.lastSeen, relative: new Date(r.lastSeen).toLocaleString() } : undefined}
                onRevoke={() => setConfirm({ kind: 'revoke', runtime: r })}
                onDelete={() => setConfirm({ kind: 'delete', runtime: r })}
                onConnect={() => void connect(r)}
              />
            ))}
            {!filtered.length && <p className="panel muted">No runtimes match this filter.</p>}
          </div>
        </>
      )}
      {enrollment && (
        <Dialog
          open
          title={connected ? 'Runtime connected' : 'Connect a runtime'}
          onClose={() => setEnrollment(null)}
          size="md"
        >
          <div className="stack">
            {connected ? (
              <>
                <div className="actions">
                  <Icon name="passed" size={32} />
                  <h2>{connected.name} is connected</h2>
                </div>
                <p>{connected.os}</p>
                <p className="muted">
                  Capabilities have been received. Run <code>vibe-runner run</code> on this machine to execute queued
                  work.
                </p>
                <div className="actions end">
                  <Button variant="primary" onClick={() => setEnrollment(null)}>
                    Done
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Install the Linux runtime from{' '}
                  <a href="https://github.com/vlazarevich/vibe-bench/releases" target="_blank" rel="noreferrer">
                    Releases
                  </a>
                  , then run this command on the machine you want to connect.
                </p>
                <Input label="Enrollment command" mono multiline readOnly value={enrollment.command} rows={4} />
                <Button
                  icon="copy"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(enrollment.command)
                      .then(() => setCopied(true))
                      .catch(() => setError('Select and copy the command manually.'))
                  }
                >
                  {copied ? 'Copied' : 'Copy command'}
                </Button>
                <p className="small muted">
                  The token works once and expires at {new Date(enrollment.expiresAt).toLocaleTimeString()} (15
                  minutes). Install and sign in to the harnesses separately.
                </p>
                <p role="status" className="actions">
                  <Icon name="queued" />
                  {Date.parse(enrollment.expiresAt) < Date.now()
                    ? 'Token expired. Close this dialog and connect again.'
                    : 'Waiting for the runtime to check in…'}
                </p>
              </>
            )}
          </div>
        </Dialog>
      )}
      {confirm && (
        <Confirm
          title={`${confirm.kind === 'revoke' ? 'Revoke' : 'Delete'} ${confirm.runtime.name}?`}
          label={confirm.kind === 'revoke' ? 'Revoke runtime' : 'Delete runtime'}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setBusy(true);
            void api(`/api/runtimes/${confirm.runtime.id}/${confirm.kind}`, Okay, {})
              .then(() => {
                setConfirm(null);
                return refresh();
              })
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          {confirm.kind === 'revoke'
            ? 'This disconnects the runtime and abandons unfinished assigned work.'
            : 'This disconnects and removes the runtime from the list.'}{' '}
          Saved runs and accepted results remain available.
        </Confirm>
      )}
    </section>
  );
}
