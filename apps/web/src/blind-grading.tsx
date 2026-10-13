import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  BlindGradingRuns,
  BlindGradingSession,
  BlindGradingTask,
  GradingInvitation,
  GradingLifecycle,
  GradingOverview,
  Judgment,
  RevealedEntrants,
  type SaveJudgment,
} from '../../../packages/contracts/src/blind-grading.ts';
import { DashboardRuns, type DashboardRun } from '../../../packages/contracts/src/dashboard.ts';
import {
  Button,
  Dialog,
  Input,
  Popover,
  ResultPanel,
  Segmented,
  TreeList,
  ProgressBar,
  TaskTypeTag,
  type Entrant,
} from './design-system';
import { GradingControls } from './grading-controls.tsx';
import { RequestedResultViewer } from './result-viewer.tsx';
import { api, Empty, Notice, errorMessage, runLabel } from './ui.tsx';
import './blind-grading.css';
const letter = (i: number) => String.fromCharCode(65 + i);
export function BlindGrading() {
  const params = new URLSearchParams(location.search),
    id = params.get('grading'),
    runId = params.get('run'),
    reviewId = params.get('review');
  const [session, setSession] = useState<BlindGradingSession | null>(null),
    [task, setTask] = useState<BlindGradingTask | null>(null),
    [lifecycle, setLifecycle] = useState<z.infer<typeof GradingLifecycle> | null>(null),
    [revealed, setRevealed] = useState<z.infer<typeof RevealedEntrants>>([]),
    [overview, setOverview] = useState<z.infer<typeof GradingOverview>>([]),
    [run, setRun] = useState<DashboardRun | null>(null),
    [invitation, setInvitation] = useState<z.infer<typeof GradingInvitation> | null>(null),
    [legacyRuns, setLegacyRuns] = useState<z.infer<typeof BlindGradingRuns>>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [startOpen, setStartOpen] = useState(params.has('start')),
    [name, setName] = useState(() => localStorage.getItem('vb-grader-name') ?? ''),
    [layout, setLayout] = useState('compare'),
    [left, setLeft] = useState(0),
    [right, setRight] = useState(1),
    [submitOpen, setSubmitOpen] = useState(false),
    [copied, setCopied] = useState(false),
    [pending, setPending] = useState<Set<string>>(new Set());
  const startRequest = useRef(crypto.randomUUID()),
    startBusy = useRef(false),
    progressGeneration = useRef(0),
    taskGeneration = useRef(0);
  useEffect(() => {
    void (async () => {
      if (id) {
        const [session, lifecycle] = await Promise.all([
          api(`/api/blind-grading/${id}`, BlindGradingSession),
          api(`/api/blind-grading/${id}/lifecycle`, GradingLifecycle),
        ]);
        setSession(session);
        setLifecycle(lifecycle);
        const selected = params.get('task') ?? session.categories[0]?.tasks[0]?.handle;
        if (selected) await loadTask(session.id, selected);
        if (lifecycle.submittedAt) setRevealed(await api(`/api/blind-grading/${id}/reveal`, RevealedEntrants));
      } else if (runId) {
        const [runs, gradings] = await Promise.all([
          api('/api/dashboard/runs', DashboardRuns),
          api(`/api/configured-runs/${runId}/gradings`, GradingOverview),
        ]);
        const run = runs.find((r) => r.id === runId);
        if (!run) throw new Error('Run not found');
        setRun(run);
        setOverview(gradings);
        setInvitation(await api(`/api/grading-invitations/${run.reviewId}`, GradingInvitation));
      } else if (reviewId) setInvitation(await api(`/api/grading-invitations/${reviewId}`, GradingInvitation));
      else setLegacyRuns(await api('/api/blind-grading/runs', BlindGradingRuns));
    })()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }, []);
  async function loadTask(sessionId: string, handle: string) {
    const version = ++taskGeneration.current;
    setBusy(true);
    try {
      const value = await api(`/api/blind-grading/${sessionId}/tasks/${handle}`, BlindGradingTask);
      if (version !== taskGeneration.current) return;
      setTask(value);
      setLeft(0);
      setRight(1);
      setLayout(
        ['html-static', 'html-interactive', 'coding-bugfix', 'coding-feature', 'browser-scenario'].includes(value.kind)
          ? 'single'
          : 'compare',
      );
      history.replaceState(
        null,
        '',
        `?view=grading&grading=${sessionId}&task=${handle}${params.has('shared') ? '&shared=1' : ''}`,
      );
    } finally {
      if (version === taskGeneration.current) setBusy(false);
    }
  }
  async function refreshProgress() {
    if (!session) return;
    const version = ++progressGeneration.current;
    const value = await api(`/api/blind-grading/${session.id}`, BlindGradingSession);
    if (version === progressGeneration.current) setSession(value);
  }
  async function reload() {
    if (!session || !task) return;
    const value = await api(`/api/blind-grading/${session.id}/tasks/${task.handle}`, BlindGradingTask);
    setTask(value);
    await refreshProgress();
  }
  async function save(command: SaveJudgment) {
    if (!session) throw new Error('No grading session');
    const value = await api(`/api/blind-grading/${session.id}/judgments`, Judgment, command);
    setTask((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((c) =>
              c.kind === 'completed' && c.handle === value.card
                ? { ...c, judgments: c.judgments.map((j) => (j.criterion === value.criterion ? value : j)) }
                : c,
            ),
          }
        : current,
    );
    try {
      await refreshProgress();
    } catch {
      setError('Grade saved, but progress could not be refreshed. Reload to refresh.');
    }
  }
  async function start(review: string) {
    if (startBusy.current) return;
    startBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api('/api/blind-grading', BlindGradingSession, {
        reviewId: review,
        requestId: startRequest.current,
        graderName: name,
      });
      localStorage.setItem('vb-grader-name', name);
      location.assign(`?view=grading&grading=${value.id}${reviewId ? '&shared=1' : ''}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      startBusy.current = false;
    }
  }
  const flat = session?.categories.flatMap((c) => c.tasks) ?? [],
    index = flat.findIndex((t) => t.handle === task?.handle),
    done = flat.reduce((n, t) => n + t.progress.graded + t.progress.skipped, 0),
    total = flat.reduce((n, t) => n + t.progress.graded + t.progress.skipped + t.progress.ungraded, 0),
    submitted = !!lifecycle?.submittedAt;
  const onPending = (key: string, value: boolean) =>
    setPending((old) => {
      const next = new Set(old);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  const graded = (i: number) => {
    const card = task?.cards[i];
    return (
      card?.kind === 'completed' &&
      card.judgments.length > 0 &&
      card.judgments.every((j) => j.value.kind !== 'ungraded')
    );
  };
  function panel(selected: number, other: number, set: (n: number) => void) {
    const card = task?.cards[selected];
    if (!card || !task || !session) return null;
    const identity = revealed.find((r) => r.card === card.handle);
    const entrant: Entrant | undefined = identity
      ? {
          app: identity.harness,
          model: identity.model,
          effort: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(identity.effort)
            ? (identity.effort as Entrant['effort'])
            : 'auto',
        }
      : undefined;
    return (
      <ResultPanel
        letter={letter(selected)}
        revealed={entrant}
        done={graded(selected)}
        results={
          layout === 'single' || task.cards.length > 2
            ? task.cards.map((_, i) => ({
                letter: letter(i),
                done: graded(i),
                disabled: layout === 'compare' && i === other,
              }))
            : undefined
        }
        onSelect={(value) => {
          if (!pending.size) set(value.charCodeAt(0) - 65);
        }}
        scores={
          card.kind === 'completed'
            ? card.judgments.map((j) => {
                const criterion = task.criteria.find((c) => c.handle === j.criterion);
                return criterion ? (
                  <GradingControls
                    key={j.card + j.criterion}
                    criterion={criterion}
                    judgment={j}
                    save={save}
                    reload={reload}
                    readOnly={submitted}
                    onPending={onPending}
                  />
                ) : null;
              })
            : undefined
        }
      >
        {card.kind === 'completed' ? (
          <RequestedResultViewer resultUrl={`/api/blind-grading/${session.id}/cards/${card.handle}/result`} />
        ) : (
          <p className="notice">
            Execution {card.kind === 'failed' ? 'failed' : 'was skipped'}. No grade can be saved.
          </p>
        )}
      </ResultPanel>
    );
  }
  const startButton = invitation && (
    <Popover
      label={`Grade ${run ? runLabel(run.number) : invitation.title}`}
      title={`Grade ${run ? runLabel(run.number) : invitation.title}`}
      open={startOpen}
      onOpenChange={setStartOpen}
      trigger={
        <Button variant="primary" icon="nav-grade" disabled={busy || !invitation.ready}>
          Start grading
        </Button>
      }
    >
      <div className="stack">
        <Input label="Your name (optional)" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" disabled={busy} onClick={() => void start(invitation.reviewId)}>
          Start
        </Button>
      </div>
    </Popover>
  );
  return (
    <section className={`page grading-page${session ? ' is-active' : ''}`} aria-label="Configured-run grading">
      {!session && run && (
        <div className="breadcrumb">
          <a href="/?view=runs">Runs</a>
          <span>/</span>
          <span>{runLabel(run.number)}</span>
        </div>
      )}
      <div className="page-head">
        <div className="stack">
          <h1>{session ? (submitted ? 'Submitted grading' : 'Grading') : 'Grading'}</h1>
          <p className="muted">
            {session?.title ?? invitation?.title}
            {run ? ` · Rev ${run.revision}` : ''}
          </p>
        </div>
        {!session && invitation && (
          <Button
            icon="link"
            onClick={() =>
              void navigator.clipboard
                .writeText(`${location.origin}/?view=grading&review=${invitation.reviewId}`)
                .then(() => setCopied(true))
                .catch(() => setError('Could not copy the grading link.'))
            }
          >
            {copied ? 'Copied' : 'Copy grading link'}
          </Button>
        )}
        {session && (
          <div className="stack">
            <span className="small muted">
              {done} of {total} criteria {submitted ? 'submitted' : 'scored or skipped'}
            </span>
            <ProgressBar value={done} max={total || 1} label="Grading progress" />
          </div>
        )}
      </div>
      <Notice error={error} />
      {error.includes('progress could not be refreshed') && (
        <Button onClick={() => void refreshProgress().then(() => setError(''))}>Refresh progress</Button>
      )}
      {busy && <p role="status">Loading grading…</p>}
      {!session &&
        invitation &&
        (overview.length ? (
          <>
            <div className="actions end">{startButton}</div>
            <div className="panel">
              <table aria-label="Gradings">
                <thead>
                  <tr>
                    <th>Grader</th>
                    <th>Submitted</th>
                    <th>Progress</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((g) => (
                    <tr key={g.id}>
                      <td>{g.graderName || 'Anonymous'}</td>
                      <td>{g.submittedAt ? new Date(g.submittedAt).toLocaleString() : 'Draft'}</td>
                      <td>
                        {g.graded} / {g.total}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (g.own) location.assign(`?view=grading&grading=${g.id}`);
                            else
                              void api(
                                `/api/configured-runs/${runId}/gradings/${g.id}/view`,
                                z.object({ id: z.string() }),
                                {},
                              )
                                .then((v) => location.assign(`?view=grading&grading=${v.id}`))
                                .catch((e) => setError(errorMessage(e)));
                          }}
                        >
                          {g.submittedAt ? 'View grading' : 'Continue grading'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty icon="nav-grade" title={reviewId ? 'Grade these results' : 'No gradings yet'} action={startButton}>
            Grade the results yourself, or copy the grading link and send it to someone. Each grading is blind: model
            names stay hidden until it’s submitted.
          </Empty>
        ))}
      {!session &&
        !invitation &&
        !busy &&
        legacyRuns.map((r) => (
          <div className="panel toolbar" key={r.reviewId}>
            <h2>{r.title}</h2>
            <Button disabled={!r.ready} onClick={() => setInvitation(r)}>
              Grade results
            </Button>
          </div>
        ))}
      {session && task && (
        <>
          <div className="grading-workspace">
            <nav className="grading-tree" aria-label="Grading tasks">
              <TreeList
                label="Grading tasks"
                nodes={session.categories.map((c) => ({
                  id: c.handle,
                  label: c.title,
                  icon: 'folder',
                  children: c.tasks.map((t) => ({
                    id: t.handle,
                    label: t.title,
                    status: t.progress.ungraded === 0 ? 'passed' : 'queued',
                    count: t.progress.graded,
                  })),
                }))}
                selectedId={task.handle}
                defaultExpanded={session.categories.map((c) => c.handle)}
                onSelect={(n) => {
                  if (flat.some((t) => t.handle === n.id) && !pending.size)
                    void loadTask(session.id, n.id).catch((e) => setError(errorMessage(e)));
                }}
              />
            </nav>
            <div className="grading-task">
              <div className="toolbar">
                <h2>{task.title}</h2>
                <Segmented
                  label="Grading layout"
                  options={[
                    { value: 'single', label: 'One at a time', icon: 'layout-single' },
                    { value: 'compare', label: 'Compare', icon: 'layout-side' },
                  ]}
                  value={layout}
                  onChange={(value) => {
                    if (!pending.size) {
                      if (value === 'compare' && left === right) setRight(left === 0 ? 1 : 0);
                      setLayout(value);
                    }
                  }}
                />
              </div>
              <TaskTypeTag type={task.kind === 'browser-scenario' ? 'browser-use' : task.kind} />
              <details className="task-prompt">
                <summary>Task instructions</summary>
                <p>{task.prompt}</p>
                {task.criteria.map((c) => (
                  <p key={c.handle}>
                    <b>{c.title}:</b> {c.instructions}
                  </p>
                ))}
              </details>
              <div className={`grading-panels ${layout === 'compare' && task.cards.length > 1 ? 'compare' : ''}`}>
                {panel(left, right, setLeft)}
                {layout === 'compare' && task.cards.length > 1 && panel(right, left, setRight)}
              </div>
            </div>
          </div>
          <footer className="sticky-footer">
            <div className="actions">
              <Button
                icon="prev"
                disabled={index <= 0 || busy || pending.size > 0}
                onClick={() =>
                  void loadTask(session.id, flat[index - 1]!.handle).catch((e) => setError(errorMessage(e)))
                }
              >
                Previous task
              </Button>
              <span className="muted">
                {index + 1} / {flat.length}
              </span>
              <Button
                icon="next"
                disabled={index >= flat.length - 1 || busy || pending.size > 0}
                onClick={() =>
                  void loadTask(session.id, flat[index + 1]!.handle).catch((e) => setError(errorMessage(e)))
                }
              >
                Next task
              </Button>
            </div>
            {submitted ? (
              <Button href="/?view=runs">Back to Runs</Button>
            ) : (
              <Button
                variant="primary"
                icon="check"
                disabled={pending.size > 0 || busy}
                onClick={() => setSubmitOpen(true)}
              >
                Submit grading
              </Button>
            )}
          </footer>
        </>
      )}
      {session?.source === 'fixture' && <p className="small muted">Fixture results · no model calls.</p>}
      {submitOpen && session && (
        <Dialog open title="Submit grading?" onClose={() => setSubmitOpen(false)} size="sm">
          <div className="stack">
            <p>
              {total - done > 0
                ? `${total - done} criteria are still ungraded. You can submit a partial grading.`
                : 'All criteria are scored or skipped.'}{' '}
              Submitting freezes your scores and reveals the entrants.
            </p>
            <div className="actions end">
              <Button onClick={() => setSubmitOpen(false)}>Keep grading</Button>
              <Button
                variant="primary"
                disabled={busy || pending.size > 0}
                onClick={() => {
                  setBusy(true);
                  void api(`/api/blind-grading/${session.id}/submit`, GradingLifecycle, {})
                    .then(async (value) => {
                      setLifecycle(value);
                      setRevealed(await api(`/api/blind-grading/${session.id}/reveal`, RevealedEntrants));
                      setSubmitOpen(false);
                    })
                    .catch((e) => setError(errorMessage(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Submit
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
