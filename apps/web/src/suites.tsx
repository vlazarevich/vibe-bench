import { useEffect, useState, useRef } from 'react';
import { z } from 'zod';
import {
  assessDefinition,
  CategoryId,
  Criterion,
  CriterionId,
  Definition,
  RankingRuleId,
  RatingControl,
  SuiteContent,
  SuiteHistory,
  SuiteList,
  SuiteView,
  TaskDefinition,
  TaskId,
  TaskKind,
} from '../../../packages/contracts/src/suites.ts';
import {
  Button,
  Icon,
  IconButton,
  Input,
  Select,
  Tabs,
  TreeList,
  MasterDetail,
  Chip,
  Rating,
  Slider,
  Thumbs,
  Dialog,
  type TableColumn,
  type IconName,
} from './design-system';
import { api, Confirm, errorMessage, Notice } from './ui.tsx';
import './suites.css';
const blank = (): Definition => ({
  title: '',
  description: '',
  categories: [],
  evaluation: { conversion: 'rating-control-v1', criteria: [], rankingRules: [] },
  materials: { kind: 'none' },
});
export const taskLabels: Record<z.infer<typeof TaskKind>, string> = {
  'text-generation': 'Text generation',
  'text-editing': 'Text editing',
  'image-generation': 'Image generation',
  'image-editing': 'Image editing',
  'image-understanding': 'Image understanding',
  'html-static': 'Static HTML page design',
  'html-interactive': 'Interactive HTML page design',
  'coding-bugfix': 'Coding bugfix',
  'coding-feature': 'Coding new feature',
  'browser-scenario': 'Browser use scenario',
};
export const taskIcon = (kind: z.infer<typeof TaskKind>): IconName =>
  `type-${kind === 'browser-scenario' ? 'browser-use' : kind}` as IconName;
const controls: Record<z.infer<typeof RatingControl>, string> = {
  'stars-5': 'Stars',
  'slider-10': 'Slider (0–10)',
  'slider-100': 'Slider',
  thumbs: 'Thumbs up or down',
};
const controlIcon = (control: z.infer<typeof RatingControl>): IconName =>
  control === 'stars-5' ? 'star-outline' : control === 'thumbs' ? 'like' : 'slider';
function Preview({ criterion }: { criterion: z.infer<typeof Criterion> }) {
  const [value, setValue] = useState<number | null>(null);
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null);
  return (
    <div className="criterion-preview stack">
      <div className="eyebrow">What graders see</div>
      {criterion.control === 'stars-5' ? (
        <Rating label={criterion.title || 'Criterion'} value={value ?? 0} onChange={setValue} />
      ) : criterion.control === 'thumbs' ? (
        <Thumbs label={criterion.title || 'Criterion'} value={thumb} onChange={setThumb} />
      ) : (
        <Slider
          label={criterion.title || 'Criterion'}
          value={value ?? 0}
          unset={value === null}
          max={criterion.control === 'slider-10' ? 10 : 100}
          onValueChange={setValue}
          format={(v) => `${v} / ${criterion.control === 'slider-10' ? 10 : 100}`}
        />
      )}
    </div>
  );
}
export function Suites() {
  const [list, setList] = useState<z.infer<typeof SuiteList>>([]),
    [saved, setSaved] = useState<SuiteView | null>(null),
    [draft, setDraft] = useState<Definition | null>(null),
    [versions, setVersions] = useState<z.infer<typeof SuiteHistory>>([]);
  const [tab, setTab] = useState('info'),
    [selected, setSelected] = useState(''),
    [criterionId, setCriterionId] = useState(''),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [historical, setHistorical] = useState<SuiteContent | null>(null),
    [showHistory, setShowHistory] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; label: string; action: () => void } | null>(null);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved?.content.definition);
  const opening = useRef(0);
  async function refresh() {
    setList(await api('/api/suites', SuiteList));
  }
  async function open(id: string) {
    const generation = ++opening.current;
    setBusy(true);
    setError('');
    try {
      const [value, history] = await Promise.all([
        api(`/api/suites/${id}`, SuiteView),
        api(`/api/suites/${id}/history`, SuiteHistory),
      ]);
      if (generation !== opening.current) return;
      setSaved(value);
      setDraft(value.content.definition);
      setVersions(history);
      setSelected('');
      setCriterionId('');
      setStatus('');
      window.history.replaceState(null, '', `?view=suites&suite=${id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function guard(action: () => void) {
    if (dirty) setConfirm({ title: 'Discard unsaved changes?', label: 'Discard changes', action });
    else action();
  }
  useEffect(() => {
    void refresh()
      .then(() => {
        const id = new URLSearchParams(location.search).get('suite');
        if (id) return open(id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save(change: 'minor' | 'revision' = 'minor') {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      const definition = Definition.parse(draft);
      const value = await api(
        saved ? `/api/suites/${saved.content.suiteId}` : '/api/suites',
        SuiteView,
        saved ? { expectedContentId: saved.content.contentId, change, definition } : { definition },
      );
      setSaved(value);
      setDraft(value.content.definition);
      setStatus(
        value.assessment.kind === 'ready'
          ? 'Suite saved.'
          : 'Draft saved. Complete the remaining fields before running.',
      );
      setVersions(await api(`/api/suites/${value.content.suiteId}/history`, SuiteHistory));
      await refresh();
      window.history.replaceState(null, '', `?view=suites&suite=${value.content.suiteId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const criterion = draft?.evaluation.criteria.find((c) => c.id === criterionId) ?? draft?.evaluation.criteria[0];
  const category = draft?.categories.find((c) => c.id === selected || c.tasks.some((t) => t.id === selected));
  const task = category?.tasks.find((t) => t.id === selected);
  function updateCriterion(next: z.infer<typeof Criterion>) {
    if (draft)
      setDraft({
        ...draft,
        evaluation: {
          ...draft.evaluation,
          criteria: draft.evaluation.criteria.map((c) => (c.id === next.id ? next : c)),
        },
      });
  }
  function updateTask(next: z.infer<typeof TaskDefinition>) {
    if (draft)
      setDraft({
        ...draft,
        categories: draft.categories.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === next.id ? next : t)) })),
      });
  }
  function addTask(categoryId: string) {
    if (!draft) return;
    const task = {
      id: TaskId.parse(crypto.randomUUID()),
      title: 'New task',
      kind: 'text-generation' as const,
      prompt: '',
      criterionIds: [],
    };
    setDraft({
      ...draft,
      categories: draft.categories.map((c) => (c.id === categoryId ? { ...c, tasks: [...c.tasks, task] } : c)),
    });
    setSelected(task.id);
  }
  const rows = [
    ...(draft && !saved
      ? [
          {
            suiteId: 'new',
            title: draft.title || 'Untitled suite',
            revision: 1,
            ordinal: 1,
            categories: 0,
            tasks: 0,
            lastRun: null,
          },
        ]
      : []),
    ...list.map((s) =>
      saved?.content.suiteId === s.suiteId && draft ? { ...s, title: draft.title || 'Untitled suite' } : s,
    ),
  ];
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: 'title', label: 'Name', width: '50%' },
    { key: 'revision', label: 'Revision', width: '120px', mono: true },
    {
      key: 'tasks',
      label: 'Tasks',
      width: '180px',
      render: (row) => `${row.categories ?? 0} categories / ${row.tasks ?? 0} tasks`,
    },
    {
      key: 'lastRun',
      label: 'Last run',
      width: '160px',
      render: (row) => (row.lastRun ? new Date(row.lastRun).toLocaleDateString() : '—'),
    },
  ];
  const assessment = draft ? Definition.safeParse(draft) : null;
  const ready = assessment?.success ? assessDefinition(assessment.data) : null;
  return (
    <section className="page suites-page" aria-label="Suite authoring">
      <div className="page-head">
        <h1>Suites</h1>
        <Button
          variant="primary"
          icon="plus"
          disabled={busy}
          onClick={() =>
            guard(() => {
              setDraft(blank());
              setSaved(null);
              setTab('info');
              setVersions([]);
              setError('');
              setStatus('');
            })
          }
        >
          New suite
        </Button>
      </div>
      <Notice error={error} />
      {status && (
        <p role="status" className="small muted">
          {status}
        </p>
      )}
      <MasterDetail
        columns={columns}
        rows={rows}
        rowKey={(s) => s.suiteId}
        caption="Suites"
        selectedKey={draft ? (saved?.content.suiteId ?? 'new') : null}
        onSelectedChange={(id) =>
          guard(() => {
            if (id && id !== 'new') void open(id);
            else {
              setDraft(null);
              setSaved(null);
              window.history.replaceState(null, '', '?view=suites');
            }
          })
        }
        detailTitle={draft?.title || 'Untitled suite'}
        detailMeta={`Rev ${saved?.content.revision ?? 1}`}
        detailPadding="none"
        height="100%"
      >
        {draft && (
          <>
            <div className="suite-toolbar">
              <Tabs
                label="Suite sections"
                items={[
                  { id: 'info', label: 'Info' },
                  { id: 'criteria', label: 'Criteria', count: draft.evaluation.criteria.length },
                  { id: 'tasks', label: 'Tasks', count: draft.categories.reduce((n, c) => n + c.tasks.length, 0) },
                ]}
                value={tab}
                onChange={setTab}
              />
              <div className="actions">
                {dirty && <Icon name="pen" tooltip="Unsaved changes" />}
                <IconButton
                  label={saved ? 'Save minor change' : 'Create suite'}
                  icon="save"
                  tooltip
                  disabled={busy || !dirty}
                  onClick={() => void save('minor')}
                />
                <IconButton
                  label="Save new revision"
                  icon="save-revision"
                  tooltip
                  variant="primary"
                  disabled={busy || !dirty}
                  onClick={() => void save('revision')}
                />
                {saved && (
                  <IconButton icon="more" label="History and recovery" tooltip onClick={() => setShowHistory(true)} />
                )}
              </div>
            </div>
            <fieldset disabled={busy} className="suite-body">
              {tab === 'info' ? (
                <div className="suite-content stack">
                  <Input
                    label="Name"
                    aria-label="Suite title"
                    value={draft.title}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <Input
                    label="Description"
                    multiline
                    rows={4}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                  <Input
                    label="Sources"
                    icon="link"
                    mono
                    value={draft.materials.kind === 'repository' ? draft.materials.url : ''}
                    placeholder="https://github.com/org/repo"
                    hint="The repository with task files. Task paths are relative to it."
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        materials: e.target.value
                          ? {
                              kind: 'repository',
                              url: e.target.value,
                              requestedRef:
                                draft.materials.kind === 'repository' ? draft.materials.requestedRef : 'HEAD',
                            }
                          : { kind: 'none' },
                      })
                    }
                  />
                  {draft.materials.kind === 'repository' && (
                    <Input
                      label="Requested ref"
                      value={draft.materials.requestedRef}
                      onChange={(e) => {
                        if (draft.materials.kind === 'repository')
                          setDraft({ ...draft, materials: { ...draft.materials, requestedRef: e.target.value } });
                      }}
                    />
                  )}
                  <details>
                    <summary>Ranking guidance</summary>
                    <div className="stack">
                      {draft.evaluation.rankingRules.map((rule, i) => (
                        <div className="stack" key={rule.id}>
                          <Input
                            label="Rule title"
                            value={rule.title}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                evaluation: {
                                  ...draft.evaluation,
                                  rankingRules: draft.evaluation.rankingRules.map((r, j) =>
                                    i === j ? { ...r, title: e.target.value } : r,
                                  ),
                                },
                              })
                            }
                          />
                          <Input
                            label="Rule guidance"
                            multiline
                            value={rule.instructions}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                evaluation: {
                                  ...draft.evaluation,
                                  rankingRules: draft.evaluation.rankingRules.map((r, j) =>
                                    i === j ? { ...r, instructions: e.target.value } : r,
                                  ),
                                },
                              })
                            }
                          />
                          <Button
                            variant="danger"
                            onClick={() =>
                              setConfirm({
                                title: 'Delete ranking rule?',
                                label: 'Delete rule',
                                action: () =>
                                  setDraft({
                                    ...draft,
                                    evaluation: {
                                      ...draft.evaluation,
                                      rankingRules: draft.evaluation.rankingRules.filter((r) => r.id !== rule.id),
                                    },
                                  }),
                              })
                            }
                          >
                            Delete rule
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="quiet"
                        icon="plus"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            evaluation: {
                              ...draft.evaluation,
                              rankingRules: [
                                ...draft.evaluation.rankingRules,
                                { id: RankingRuleId.parse(crypto.randomUUID()), title: '', instructions: '' },
                              ],
                            },
                          })
                        }
                      >
                        Add ranking rule
                      </Button>
                    </div>
                  </details>
                  {ready?.kind === 'incomplete' && (
                    <details className="readiness">
                      <summary>Incomplete definition · {ready.issues.length} fields to complete</summary>
                      <ul>
                        {ready.issues.map((i, n) => (
                          <li key={n}>{i.message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : tab === 'criteria' ? (
                <div className="suite-split">
                  <div className="suite-tree">
                    <TreeList
                      label="Criteria"
                      nodes={draft.evaluation.criteria.map((c) => ({
                        id: c.id,
                        label: c.title || 'Untitled criterion',
                        icon: controlIcon(c.control),
                      }))}
                      selectedId={criterion?.id}
                      onSelect={(n) => setCriterionId(n.id)}
                    />
                    <Button
                      variant="quiet"
                      icon="plus"
                      size="sm"
                      onClick={() => {
                        const c = {
                          id: CriterionId.parse(crypto.randomUUID()),
                          title: 'New criterion',
                          instructions: '',
                          control: 'stars-5' as const,
                        };
                        setDraft({
                          ...draft,
                          evaluation: { ...draft.evaluation, criteria: [...draft.evaluation.criteria, c] },
                        });
                        setCriterionId(c.id);
                      }}
                    >
                      Add criterion
                    </Button>
                  </div>
                  <div className="suite-content stack">
                    {criterion ? (
                      <>
                        <Input
                          label="Name"
                          aria-label="Criterion title"
                          value={criterion.title}
                          onChange={(e) => updateCriterion({ ...criterion, title: e.target.value })}
                        />
                        <Input
                          label="Guidance"
                          multiline
                          rows={5}
                          value={criterion.instructions}
                          onChange={(e) => updateCriterion({ ...criterion, instructions: e.target.value })}
                        />
                        <Select
                          label="Rating control"
                          value={criterion.control}
                          options={RatingControl.options
                            .filter((v) => v !== 'slider-10' || criterion.control === 'slider-10')
                            .map((value) => ({ value, label: controls[value] }))}
                          onChange={(value) => updateCriterion({ ...criterion, control: RatingControl.parse(value) })}
                        />
                        <Preview key={criterion.id + criterion.control} criterion={criterion} />
                        <div>
                          <Button
                            variant="danger"
                            size="sm"
                            icon="delete"
                            onClick={() =>
                              setConfirm({
                                title: 'Delete criterion?',
                                label: 'Delete criterion',
                                action: () =>
                                  setDraft({
                                    ...draft,
                                    evaluation: {
                                      ...draft.evaluation,
                                      criteria: draft.evaluation.criteria.filter((c) => c.id !== criterion.id),
                                    },
                                    categories: draft.categories.map((c) => ({
                                      ...c,
                                      tasks: c.tasks.map((t) => ({
                                        ...t,
                                        criterionIds: t.criterionIds.filter((id) => id !== criterion.id),
                                      })),
                                    })),
                                  }),
                              })
                            }
                          >
                            Delete criterion
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="muted">No criteria yet. Add one to tell graders what to score.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="suite-split">
                  <div className="suite-tree">
                    <TreeList
                      label="Tasks"
                      nodes={draft.categories.map((c) => ({
                        id: c.id,
                        label: c.title || 'Untitled category',
                        icon: 'folder',
                        count: c.tasks.length,
                        children: c.tasks.map((t) => ({
                          id: t.id,
                          label: t.title || 'Untitled task',
                          icon: taskIcon(t.kind),
                        })),
                      }))}
                      selectedId={selected}
                      onSelect={(n) => setSelected(n.id)}
                      defaultExpanded={draft.categories.map((c) => c.id)}
                      onAdd={(n) => addTask(n.id)}
                      addLabel={(n) => `Add task to ${n.label}`}
                    />
                    <Button
                      variant="quiet"
                      size="sm"
                      icon="plus"
                      onClick={() => {
                        const c = { id: CategoryId.parse(crypto.randomUUID()), title: 'New category', tasks: [] };
                        setDraft({ ...draft, categories: [...draft.categories, c] });
                        setSelected(c.id);
                      }}
                    >
                      Add category
                    </Button>
                  </div>
                  <div className="suite-content stack">
                    {task ? (
                      <>
                        <Input
                          label="Title"
                          aria-label="Task title"
                          value={task.title}
                          onChange={(e) => updateTask({ ...task, title: e.target.value })}
                        />
                        <Select
                          label="Task type"
                          options={TaskKind.options.map((value) => ({
                            value,
                            label: taskLabels[value],
                            icon: taskIcon(value),
                          }))}
                          value={task.kind}
                          onChange={(value) => updateTask({ ...task, kind: TaskKind.parse(value) })}
                        />
                        <Input
                          label="Instructions"
                          multiline
                          rows={8}
                          value={task.prompt}
                          onChange={(e) => updateTask({ ...task, prompt: e.target.value })}
                        />
                        <Input
                          label="Path"
                          mono
                          value={task.path ?? ''}
                          onChange={(e) => updateTask({ ...task, path: e.target.value })}
                          hint={
                            draft.materials.kind === 'repository'
                              ? `Relative to ${draft.materials.url}`
                              : 'Set Sources on the Info tab first.'
                          }
                        />
                        <details>
                          <summary>Repository manifest key</summary>
                          <code>{task.id}</code>
                          <p className="muted small">
                            Use this task ID in vibe-bench.json to declare inputs, outputs, browser context, or
                            verification commands.
                          </p>
                        </details>
                        <div className="stack">
                          <b>Criteria</b>
                          <div className="actions">
                            {draft.evaluation.criteria.map((c) => (
                              <Chip
                                key={c.id}
                                selected={task.criterionIds.includes(c.id)}
                                onSelectedChange={(selected) =>
                                  updateTask({
                                    ...task,
                                    criterionIds: selected
                                      ? [...task.criterionIds, c.id]
                                      : task.criterionIds.filter((id) => id !== c.id),
                                  })
                                }
                                trailingIcon={controlIcon(c.control)}
                                trailingIconLabel={controls[c.control]}
                              >
                                {c.title || 'Untitled criterion'}
                              </Chip>
                            ))}
                          </div>
                          <p className="muted small">Graders score this task on the selected criteria.</p>
                        </div>
                        <div>
                          <Button
                            variant="danger"
                            size="sm"
                            icon="delete"
                            onClick={() =>
                              setConfirm({
                                title: 'Delete task?',
                                label: 'Delete task',
                                action: () => {
                                  setDraft({
                                    ...draft,
                                    categories: draft.categories.map((c) => ({
                                      ...c,
                                      tasks: c.tasks.filter((t) => t.id !== task.id),
                                    })),
                                  });
                                  setSelected(category?.id ?? '');
                                },
                              })
                            }
                          >
                            Delete task
                          </Button>
                        </div>
                      </>
                    ) : category ? (
                      <>
                        <Input
                          label="Title"
                          aria-label="Category title"
                          value={category.title}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              categories: draft.categories.map((c) =>
                                c.id === category.id ? { ...c, title: e.target.value } : c,
                              ),
                            })
                          }
                        />
                        <div className="actions">
                          <Button icon="plus" onClick={() => addTask(category.id)}>
                            Add task
                          </Button>
                          <Button
                            variant="danger"
                            icon="delete"
                            onClick={() =>
                              setConfirm({
                                title: 'Delete category and its tasks?',
                                label: 'Delete category',
                                action: () => {
                                  setDraft({
                                    ...draft,
                                    categories: draft.categories.filter((c) => c.id !== category.id),
                                  });
                                  setSelected('');
                                },
                              })
                            }
                          >
                            Delete category
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="muted">No task selected. Add a category, then add tasks to it with +.</p>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          </>
        )}
      </MasterDetail>
      {confirm && (
        <Confirm
          title={confirm.title}
          label={confirm.label}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            confirm.action();
            setConfirm(null);
          }}
        >
          This changes your local draft. Saved revisions remain available.
        </Confirm>
      )}
      {showHistory && saved && (
        <Dialog open title="History and recovery" onClose={() => setShowHistory(false)}>
          <div className="stack">
            <Button
              onClick={() => {
                setShowHistory(false);
                void open(saved.content.suiteId);
              }}
            >
              Reload latest and discard local edits
            </Button>
            {versions.map((v) => (
              <Button key={v.contentId} onClick={() => setHistorical(v)}>
                Revision {v.revision} · Content {v.ordinal}
              </Button>
            ))}
            {historical && (
              <section aria-label="Historical content">
                <h3>{historical.definition.title}</h3>
                <p>{historical.definition.description}</p>
                {historical.definition.categories.map((c) => (
                  <div key={c.id}>
                    <h3>{c.title}</h3>
                    {c.tasks.map((t) => (
                      <div key={t.id}>
                        <b>{t.title}</b>
                        <p>{t.prompt}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
