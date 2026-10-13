import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConfigureRun,
  ConfiguredRunView,
  CreateConfiguredRun,
  RunPreview,
} from '../../../packages/contracts/src/configured-runs.ts';
import {
  DashboardRuns,
  DashboardRuntimes,
  type DashboardRun,
  type DashboardRuntime,
} from '../../../packages/contracts/src/dashboard.ts';
import { SuiteContent, SuiteHistory, SuiteList, assessDefinition } from '../../../packages/contracts/src/suites.ts';
import { ModelCatalog } from '../../../packages/contracts/src/model-catalog.ts';
import {
  Button,
  Checkbox,
  Dialog,
  Icon,
  IconButton,
  Input,
  RunCard,
  Select,
  Tabs,
  type IconName,
} from './design-system';
import { RunDetails, RunMatrix } from './run-details.tsx';
import { newEntrant, type EntrantDraft } from './run-entrants.tsx';
import { api, Okay, Empty, Confirm, errorMessage, Notice, runLabel, entrantTag } from './ui.tsx';
import './runs.css';
function duration(run: DashboardRun) {
  if (!run.startedAt) return undefined;
  const seconds = Math.max(
    0,
    Math.floor(((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000),
  );
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s${run.state === 'running' ? ' so far' : ''}`;
}
export function ConfiguredRuns() {
  const [runs, setRuns] = useState<DashboardRun[]>([]),
    [runtimes, setRuntimes] = useState<DashboardRuntime[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState(new URLSearchParams(location.search).get('q') ?? ''),
    [tab, setTab] = useState('all'),
    [dialog, setDialog] = useState(false),
    [repeat, setRepeat] = useState<ConfiguredRunView | null>(null),
    [detail, setDetail] = useState<ConfiguredRunView | null>(null),
    [cancel, setCancel] = useState<DashboardRun | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [runs, runtimes] = await Promise.all([
      api('/api/dashboard/runs', DashboardRuns),
      api('/api/dashboard/runtimes', DashboardRuntimes),
    ]);
    setRuns(runs);
    setRuntimes(runtimes);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('run');
    void Promise.all([
      refresh(),
      id ? api(`/api/configured-runs/${id}`, ConfiguredRunView).then(setDetail) : null,
    ]).catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => void refresh().catch((e) => setError(errorMessage(e))), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  const group = (r: DashboardRun) =>
    r.state === 'queued' || r.state === 'running' ? 'running' : r.state === 'done' ? 'finished' : 'failed';
  const filtered = runs.filter(
    (r) =>
      (tab === 'all' || group(r) === tab) &&
      [runLabel(r.number), r.title, r.runtimeName, ...r.entrants.map((e) => e.model)]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="page" aria-label="Run management">
      <div className="page-head">
        <h1>Runs</h1>
        {runs.length > 0 && !detail && (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setRepeat(null);
              setDialog(true);
            }}
          >
            New run
          </Button>
        )}
      </div>
      <Notice error={error} />
      {detail ? (
        <>
          <div className="actions">
            <Button
              onClick={() => {
                setDetail(null);
                history.replaceState(null, '', '?view=runs');
              }}
            >
              All runs
            </Button>
            <Button
              onClick={() =>
                void api(`/api/configured-runs/${detail.runId}`, ConfiguredRunView)
                  .then(setDetail)
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Refresh results
            </Button>
          </div>
          <RunDetails run={detail} />
        </>
      ) : !loaded ? (
        <p role="status">Loading runs…</p>
      ) : runs.length === 0 ? (
        <Empty
          icon="nav-runs"
          title="No runs yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setDialog(true)}>
              New run
            </Button>
          }
        >
          A run puts a suite’s tasks in front of your entrants on a runtime. When it finishes, you grade the results
          blind.
        </Empty>
      ) : (
        <>
          <div className="toolbar">
            <Tabs
              label="Filter runs"
              value={tab}
              onChange={setTab}
              items={['all', 'running', 'finished', 'failed'].map((id) => ({
                id,
                label: id[0]!.toUpperCase() + id.slice(1),
                count: runs.filter((r) => id === 'all' || group(r) === id).length,
              }))}
            />
            <Input
              icon="search"
              className="search-field"
              aria-label="Search runs"
              placeholder="Run ID, suite, runtime or model"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="card-list">
            {filtered.map((r) => (
              <RunCard
                key={r.id}
                runId={runLabel(r.number)}
                runHref={`/?view=runs&run=${r.id}`}
                evidence={r.source}
                canGrade={r.canGrade}
                state={r.state}
                suite={r.title}
                revision={r.revision}
                runtime={r.runtimeName}
                entrants={r.entrants.map(entrantTag)}
                tasks={r.tasks}
                started={r.startedAt ? { iso: r.startedAt, label: new Date(r.startedAt).toLocaleString() } : undefined}
                duration={duration(r)}
                gradings={r.gradings}
                suiteHref={`/?view=suites&suite=${r.suiteId}`}
                runtimeHref="/?view=runtimes"
                gradeHref={`/?view=grading&run=${r.id}${r.gradings ? '' : '&start=1'}`}
                onCancel={() => setCancel(r)}
                onRunAgain={() =>
                  void api(`/api/configured-runs/${r.id}`, ConfiguredRunView)
                    .then((run) => {
                      setRepeat(run);
                      setDialog(true);
                    })
                    .catch((e) => setError(errorMessage(e)))
                }
              />
            ))}
            {!filtered.length && <p className="panel muted">No runs match this filter.</p>}
          </div>
        </>
      )}
      {dialog && (
        <NewRun
          runtimes={runtimes}
          repeat={repeat}
          onClose={() => setDialog(false)}
          onCreated={() => {
            setDialog(false);
            void refresh().catch((e) => setError(errorMessage(e)));
          }}
        />
      )}
      {cancel && (
        <Confirm
          title={`Cancel ${runLabel(cancel.number)}?`}
          label="Cancel run"
          busy={busy}
          onClose={() => setCancel(null)}
          onConfirm={() => {
            setBusy(true);
            void api(`/api/configured-runs/${cancel.id}/cancel`, Okay, {})
              .then(() => {
                setCancel(null);
                return refresh();
              })
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          The runtime will stop this run when it receives the cancellation. Accepted results remain available.
        </Confirm>
      )}
    </section>
  );
}
function NewRun({
  runtimes,
  repeat,
  onClose,
  onCreated,
}: {
  runtimes: DashboardRuntime[];
  repeat: ConfiguredRunView | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [suites, setSuites] = useState<ReturnType<typeof SuiteList.parse>>([]),
    [versions, setVersions] = useState<SuiteContent[]>([]),
    [content, setContent] = useState<SuiteContent | null>(repeat?.snapshot.content ?? null),
    [suiteId, setSuiteId] = useState(repeat?.snapshot.content.suiteId ?? ''),
    [runtimeId, setRuntimeId] = useState(repeat?.snapshot.runtimeId ?? runtimes.find((r) => r.connected)?.id ?? ''),
    [entrants, setEntrants] = useState<EntrantDraft[]>(() =>
      repeat
        ? repeat.snapshot.entrants.map((e) => ({
            id: crypto.randomUUID(),
            harness: e.harness,
            model: e.model,
            timeout: String(e.settings.timeoutMs / 1000),
            effort:
              e.harness === 'codex'
                ? (e.settings.reasoningEffort ?? '')
                : e.harness === 'claude'
                  ? (e.settings.effort ?? '')
                  : (e.settings.variant ?? ''),
          }))
        : [newEntrant()],
    ),
    [source, setSource] = useState<'live' | 'fixture'>(repeat?.snapshot.source ?? 'live'),
    [selection, setSelection] = useState<ConfigureRun['selection']>(
      repeat ? { kind: 'subset', taskIds: repeat.snapshot.selectedTaskIds, categoryIds: [] } : { kind: 'all' },
    ),
    [catalog, setCatalog] = useState<ModelCatalog | null>(null),
    [preview, setPreview] = useState<RunPreview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const request = useRef<CreateConfiguredRun | null>(null),
    generation = useRef(0),
    inFlight = useRef(false);
  useEffect(() => {
    void api('/api/suites', SuiteList)
      .then((value) => {
        setSuites(value);
        if (!suiteId) setSuiteId(value[0]?.suiteId ?? '');
      })
      .catch((e) => setError(errorMessage(e)));
    void api('/api/model-catalog', ModelCatalog)
      .then(setCatalog)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!suiteId) return;
    let current = true;
    void api(`/api/suites/${suiteId}/history`, SuiteHistory)
      .then((value) => {
        if (!current) return;
        setVersions(value);
        setContent((old) => (old?.suiteId === suiteId ? old : (value[0] ?? null)));
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [suiteId]);
  function changed() {
    generation.current++;
    request.current = null;
    setPreview(null);
    setError('');
  }
  const runtime = runtimes.find((r) => r.id === runtimeId),
    queued = runtime?.state === 'offline' || runtime?.state === 'working';
  function knownModels(harness: EntrantDraft['harness']) {
    const readiness = runtime?.registration?.harnesses[harness === 'opencode' ? 'opencodeGo' : harness];
    return readiness?.kind === 'ready' ? (readiness.models ?? []) : [];
  }
  const tasks =
    content?.definition.categories
      .flatMap((c) => c.tasks)
      .filter(
        (t) =>
          selection.kind === 'all' ||
          selection.taskIds.includes(t.id) ||
          content.definition.categories.some(
            (c) => selection.categoryIds.includes(c.id) && c.tasks.some((x) => x.id === t.id),
          ),
      ) ?? [];
  const valid =
    content &&
    assessDefinition(content.definition).kind === 'ready' &&
    runtime &&
    tasks.length > 0 &&
    entrants.length > 0 &&
    entrants.every((e) => e.model.trim());
  function config() {
    return ConfigureRun.parse({
      contentId: content?.contentId,
      runtimeId,
      selection,
      source,
      entrants: entrants.map((e) => ({
        id: e.id,
        harness: e.harness,
        model: e.model,
        settings: {
          timeoutMs: Number(e.timeout) * 1000,
          ...(e.effort
            ? { [e.harness === 'codex' ? 'reasoningEffort' : e.harness === 'claude' ? 'effort' : 'variant']: e.effort }
            : {}),
        },
      })),
    });
  }
  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      request.current ??= { ...config(), requestId: crypto.randomUUID() };
      await api('/api/configured-runs', ConfiguredRunView, request.current);
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function update(i: number, e: EntrantDraft) {
    changed();
    setEntrants(entrants.map((value, index) => (index === i ? e : value)));
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="New run"
      size="lg"
    >
      <div className="new-run-body stack">
        <div className="new-run-scroll">
          <fieldset disabled={busy} className="stack">
            <div className="form-grid">
              <Select
                label="Suite"
                value={suiteId}
                options={suites.map((s) => ({ value: s.suiteId, label: s.title || 'Untitled suite' }))}
                onChange={(value) => {
                  changed();
                  setSuiteId(value);
                  setContent(null);
                  setSelection({ kind: 'all' });
                }}
              />
              <Select
                label="Revision"
                value={content?.contentId ?? ''}
                options={versions.map((v) => ({
                  value: v.contentId,
                  label: `Rev ${v.revision} · Content ${v.ordinal}`,
                }))}
                onChange={(value) => {
                  changed();
                  setContent(versions.find((v) => v.contentId === value) ?? null);
                  setSelection({ kind: 'all' });
                }}
              />
              <Select
                label="Runtime"
                value={runtimeId}
                options={runtimes.map((r) => ({
                  value: r.id,
                  label: `${r.name}${r.state === 'ready' ? '' : ` · ${r.state}`}`,
                }))}
                onChange={(value) => {
                  changed();
                  setRuntimeId(value);
                }}
              />
            </div>
            {!suites.length && (
              <p className="muted">
                Create a <a href="/?view=suites">suite</a> first.
              </p>
            )}
            {!runtimes.length && (
              <p className="muted">
                Connect a <a href="/?view=runtimes">runtime</a> first.
              </p>
            )}
            <div className="stack">
              <b>Entrants</b>
              {entrants.map((e, i) => (
                <div className="entrant-row" key={e.id}>
                  <Select
                    label={i === 0 ? 'Harness' : undefined}
                    id={`harness-${i}`}
                    value={e.harness}
                    options={[
                      { value: 'claude', label: 'Claude Code', app: 'claude' },
                      { value: 'codex', label: 'Codex', app: 'codex' },
                      { value: 'opencode', label: 'OpenCode', app: 'opencode' },
                    ]}
                    onChange={(value) => update(i, { ...e, harness: value as EntrantDraft['harness'], effort: '' })}
                  />
                  <Input
                    label={i === 0 ? 'Model' : undefined}
                    aria-label={`Model ${i + 1}`}
                    list={`catalog-${i}`}
                    value={e.model}
                    placeholder="Exact model identifier"
                    onChange={(event) => update(i, { ...e, model: event.target.value })}
                  />
                  <datalist id={`catalog-${i}`}>
                    {knownModels(e.harness).map((id) => (
                      <option key={id} value={id} />
                    ))}
                    {catalog?.models.map((m) => (
                      <option key={m.id} value={m.slug}>
                        {m.name}
                      </option>
                    ))}
                  </datalist>
                  <Select
                    label={i === 0 ? 'Effort' : undefined}
                    id={`effort-${i}`}
                    value={e.effort || 'auto'}
                    options={['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
                      value,
                      label: value === 'xhigh' ? 'Extra high' : value[0]!.toUpperCase() + value.slice(1),
                      icon: `effort-${value}` as IconName,
                      tone: value === 'auto' ? 'success' : value === 'max' ? 'danger' : 'warning',
                    }))}
                    onChange={(value) => update(i, { ...e, effort: value === 'auto' ? '' : value })}
                  />
                  <IconButton
                    icon="delete"
                    label={`Remove entrant ${i + 1}`}
                    variant="danger"
                    tooltip
                    onClick={() => {
                      changed();
                      setEntrants(entrants.filter((_, j) => i !== j));
                    }}
                  />
                </div>
              ))}
              <div>
                <Button
                  variant="quiet"
                  icon="plus"
                  size="sm"
                  disabled={entrants.length >= 16}
                  onClick={() => {
                    changed();
                    setEntrants([...entrants, newEntrant()]);
                  }}
                >
                  Add entrant
                </Button>
              </div>
            </div>
            <details>
              <summary>Tasks and execution options</summary>
              <div className="stack">
                <Checkbox
                  label="All tasks"
                  checked={selection.kind === 'all'}
                  onChange={(e) => {
                    changed();
                    setSelection(e.target.checked ? { kind: 'all' } : { kind: 'subset', categoryIds: [], taskIds: [] });
                  }}
                />
                {selection.kind === 'subset' &&
                  content?.definition.categories.map((c) => (
                    <div className="stack" key={c.id}>
                      <Checkbox
                        label={`All tasks in ${c.title}`}
                        checked={selection.categoryIds.includes(c.id)}
                        onChange={(e) => {
                          changed();
                          setSelection({
                            ...selection,
                            categoryIds: e.target.checked
                              ? [...selection.categoryIds, c.id]
                              : selection.categoryIds.filter((id) => id !== c.id),
                          });
                        }}
                      />
                      {c.tasks.map((t) => (
                        <Checkbox
                          key={t.id}
                          label={t.title}
                          disabled={selection.categoryIds.includes(c.id)}
                          checked={selection.categoryIds.includes(c.id) || selection.taskIds.includes(t.id)}
                          onChange={(e) => {
                            changed();
                            setSelection({
                              ...selection,
                              taskIds: e.target.checked
                                ? [...selection.taskIds, t.id]
                                : selection.taskIds.filter((id) => id !== t.id),
                            });
                          }}
                        />
                      ))}
                    </div>
                  ))}
                <Select
                  label="Execution mode"
                  options={[
                    { value: 'live', label: 'Live models' },
                    { value: 'fixture', label: 'Fixture · no model calls' },
                  ]}
                  value={source}
                  onChange={(value) => {
                    changed();
                    setSource(value as 'live' | 'fixture');
                  }}
                />
                {entrants.map((e, i) => (
                  <Input
                    key={e.id}
                    label={`Entrant ${i + 1} time limit (seconds)`}
                    type="number"
                    min={0.1}
                    max={3600}
                    value={e.timeout}
                    onChange={(event) => update(i, { ...e, timeout: event.target.value })}
                  />
                ))}
                <Button
                  disabled={!valid}
                  onClick={() => {
                    const version = generation.current;
                    void Promise.resolve()
                      .then(() => api('/api/configured-runs/preview', RunPreview, config()))
                      .then((value) => {
                        if (version === generation.current) setPreview(value);
                      })
                      .catch((e) => setError(errorMessage(e)));
                  }}
                >
                  Preview matrix
                </Button>
                {preview && <RunMatrix preview={preview} />}
              </div>
            </details>
          </fieldset>
        </div>
        <Notice error={error} />
        <div className="new-run-footer">
          <div>
            <p className="muted">
              {tasks.length} tasks × {entrants.length} entrants · {tasks.length * entrants.length} attempts
            </p>
            <p className="queue-hint">
              {queued ? (
                <>
                  <Icon name="queued" />
                  {runtime?.state === 'offline' ? 'Runtime is offline.' : 'Runtime is busy.'} This run will be queued.
                </>
              ) : source === 'fixture' ? (
                'Deterministic fixture · no model calls.'
              ) : (
                ''
              )}
            </p>
          </div>
          <div className="actions">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon="start" disabled={!valid || busy} onClick={() => void start()}>
              {busy ? 'Creating…' : queued ? 'Queue run' : 'Start run'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
