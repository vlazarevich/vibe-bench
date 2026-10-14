import { useEffect, useMemo, useState } from 'react';
import { ModelCatalog, ModelClass, matchCatalogModel } from '../../../packages/contracts/src/model-catalog.ts';
import {
  ResultsData,
  taskGroups,
  categoryAverage,
  type ResultObservation,
} from '../../../packages/contracts/src/results.ts';
import {
  DateRangePicker,
  FilterPanel,
  StatTile,
  Tabs,
  ScoreTable,
  IconButton,
  Popover,
  Checklist,
  type DateRange,
  type DatePreset,
  type FilterSection,
  type FilterValue,
  type ScoreColumn,
  type ScoreRow,
  type IconName,
  type ScoreCellProps,
} from './design-system';
import { api, Empty, errorMessage, Notice } from './ui.tsx';
import { taskIcon, taskLabels } from './suites.tsx';
import './results.css';
const day = (date: Date) => date.toISOString().slice(0, 10);
const unique = <T,>(values: T[]) => [...new Set(values)];
const groupIcons: Record<string, IconName> = {
  Text: 'type-text-generation',
  Image: 'type-image-generation',
  Coding: 'type-coding-feature',
  Design: 'type-html-static',
  Agentic: 'type-browser-use',
};
export function Results() {
  const today = day(new Date()),
    now = new Date(),
    utc = (year: number, month: number, date = 1) => day(new Date(Date.UTC(year, month, date))),
    offset = (n: number) => day(new Date(Date.now() + n * 86400000)),
    year = now.getUTCFullYear(),
    month = now.getUTCMonth(),
    monday = (now.getUTCDay() + 6) % 7;
  const presets: DatePreset[] = [
    ['today', 'Today', today, today],
    ['yesterday', 'Yesterday', offset(-1), offset(-1)],
    ['week', 'This week', offset(-monday), today],
    ['last-week', 'Last week', offset(-monday - 7), offset(-monday - 1)],
    ['7', 'Last 7 days', offset(-6), today],
    ['30', 'Last 30 days', offset(-29), today],
    ['month', 'This month', utc(year, month), today],
    ['last-month', 'Last month', utc(year, month - 1), utc(year, month, 0)],
    ['quarter', 'This quarter', utc(year, Math.floor(month / 3) * 3), today],
    ['year', 'This year', utc(year, 0), today],
    ['last-year', 'Last year', utc(year - 1, 0), utc(year - 1, 11, 31)],
    ['all', 'All time', '2000-01-01', today],
  ].map(([id, label, from, to]) => ({ id: id!, label: label!, phrase: label!.toLowerCase(), from: from!, to: to! }));
  const [range, setRange] = useState<DateRange>({ from: offset(-29), to: today, preset: '30' }),
    [data, setData] = useState<ResultsData | null>(null),
    [catalog, setCatalog] = useState<ModelCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [filters, setFilters] = useState<FilterValue>({}),
    [tab, setTab] = useState('model'),
    [expanded, setExpanded] = useState<string[] | null>(null),
    [visibleModels, setVisibleModels] = useState<string[] | null>(null);
  useEffect(() => {
    void api('/api/model-catalog', ModelCatalog)
      .then(setCatalog)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void api(`/api/results?from=${range.from}&to=${range.to}&source=live`, ResultsData)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [range.from, range.to]);
  const observations = data?.observations ?? [];
  const models = unique(observations.map((o) => o.model)).sort();
  const metadata = new Map(models.map((model) => [model, matchCatalogModel(model, catalog?.models ?? [])]));
  const allFamilies = unique(models.map((m) => metadata.get(m)?.family ?? 'Unknown'));
  const sections: FilterSection[] = [
    {
      id: 'family',
      label: 'Family',
      kind: 'checklist',
      group: 'Models',
      items: allFamilies.map((id) => ({
        id,
        label: id,
        app: id === 'Anthropic' ? 'claude' : id === 'OpenAI' ? 'codex' : undefined,
        icon: 'model',
        meta: models.filter((m) => (metadata.get(m)?.family ?? 'Unknown') === id).length,
      })),
    },
    {
      id: 'class',
      label: 'Model class',
      kind: 'checklist',
      items: [...ModelClass.options, 'Unknown'].map((id) => ({
        id,
        label: id,
        icon: id === 'Unknown' ? 'model' : (`size-${id.toLowerCase()}` as IconName),
      })),
    },
    {
      id: 'license',
      label: 'License',
      kind: 'segmented',
      options: [
        { value: 'all', label: 'All' },
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
      ],
    },
    {
      id: 'harness',
      label: 'Harness',
      kind: 'checklist',
      items: [
        { id: 'claude', label: 'Claude Code', app: 'claude' },
        { id: 'codex', label: 'Codex', app: 'codex' },
        { id: 'opencode', label: 'OpenCode', app: 'opencode' },
      ],
    },
    {
      id: 'effort',
      label: 'Effort',
      kind: 'checklist',
      items: unique(['auto', 'low', 'medium', 'high', 'xhigh', 'max', ...observations.map((o) => o.effort)]).map(
        (id) => ({
          id,
          label: id === 'xhigh' ? 'Extra high' : id[0]!.toUpperCase() + id.slice(1),
          icon: (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(id)
            ? `effort-${id}`
            : 'settings') as IconName,
        }),
      ),
    },
    {
      id: 'suite',
      label: 'Suite',
      kind: 'checklist',
      group: 'Tasks',
      items: unique(observations.map((o) => o.suiteId)).map((id) => ({
        id,
        label: observations.find((o) => o.suiteId === id)!.suite,
        icon: 'nav-suites',
      })),
    },
    {
      id: 'type',
      label: 'Task type',
      kind: 'checklist',
      search: false,
      groupSelect: true,
      groupIcons,
      items: taskGroups.flatMap((g) =>
        g.types.map((id) => ({ id, label: taskLabels[id], group: g.label, icon: taskIcon(id) })),
      ),
    },
  ];
  const selected = (key: string, value: string) =>
    !Array.isArray(filters[key]) || filters[key].length === 0 || filters[key].includes(value);
  const filtered = observations.filter((o) => {
    const m = metadata.get(o.model);
    return (
      selected('family', m?.family ?? 'Unknown') &&
      selected('class', m?.modelClass ?? 'Unknown') &&
      (!filters.license || filters.license === 'all' || filters.license === m?.license) &&
      selected('harness', o.harness) &&
      selected('effort', o.effort) &&
      selected('suite', o.suiteId) &&
      selected('type', o.taskType)
    );
  });
  const filteredModels = unique(filtered.map((o) => o.model)).sort();
  const columns: ScoreColumn[] =
    tab === 'model'
      ? taskGroups.map((g) => ({ id: g.id, label: g.label, icon: groupIcons[g.label] }))
      : filteredModels
          .filter((m) => visibleModels === null || visibleModels.includes(m))
          .map((m) => ({ id: m, label: metadata.get(m)?.name ?? m, icon: 'model' }));
  const period = `${range.from} – ${range.to} (UTC)`;
  function cell(obs: ResultObservation[], label: string): ScoreCellProps {
    const start = Date.parse(range.from),
      days = Math.round((Date.parse(range.to) - start) / 86400000) + 1,
      bins = Math.min(12, days);
    const trend = Array.from({ length: bins }, (_, i) =>
      categoryAverage(
        obs.filter(
          (o) => Math.min(bins - 1, Math.floor(((Date.parse(o.date) - start) / 86400000 / days) * bins)) === i,
        ),
      ),
    );
    return {
      score: categoryAverage(obs),
      count: obs.length,
      trend,
      label,
      period,
      details: [
        { label: 'Tasks', value: unique(obs.map((o) => `${o.suiteId}:${o.taskId}`)).length },
        { label: 'Entrants', value: unique(obs.map((o) => `${o.model}:${o.harness}:${o.effort}`)).length },
      ],
    };
  }
  function cells(obs: ResultObservation[], label: string) {
    return columns.map((c) =>
      cell(
        obs.filter((o) =>
          tab === 'model'
            ? taskGroups.find((g) => g.id === c.id)!.types.some((t) => t === o.taskType)
            : o.model === c.id,
        ),
        `${label} on ${c.label}`,
      ),
    );
  }
  const rows = useMemo(() => {
    let rows: ScoreRow[] = [];
    if (tab === 'model')
      rows = unique(filteredModels.map((m) => metadata.get(m)?.family ?? 'Unknown')).map((f) => {
        const family = filtered.filter((o) => (metadata.get(o.model)?.family ?? 'Unknown') === f);
        return {
          id: `family:${f}`,
          label: f,
          app: f === 'Anthropic' ? 'claude' : f === 'OpenAI' ? 'codex' : undefined,
          icon: 'model',
          meta: `${unique(family.map((o) => o.model)).length} ${unique(family.map((o) => o.model)).length === 1 ? 'model' : 'models'}`,
          cells: cells(family, f),
          children: unique(family.map((o) => o.model)).map((m) => {
            const model = family.filter((o) => o.model === m),
              label = metadata.get(m)?.name ?? m;
            return {
              id: `model:${m}`,
              label,
              icon: 'model',
              cells: cells(model, label),
              children: unique(model.map((o) => `${o.harness}:${o.effort}`)).map((e) => {
                const obs = model.filter((o) => `${o.harness}:${o.effort}` === e),
                  first = obs[0]!;
                return {
                  id: `entrant:${m}:${e}`,
                  label: first.harness === 'claude' ? 'Claude Code' : first.harness === 'codex' ? 'Codex' : 'OpenCode',
                  app: first.harness,
                  badge: {
                    icon: (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(first.effort)
                      ? `effort-${first.effort}`
                      : 'settings') as IconName,
                    label: `${first.effort} effort`,
                  },
                  cells: cells(obs, e),
                };
              }),
            };
          }),
        };
      });
    else if (tab === 'suite')
      rows = unique(filtered.map((o) => o.suiteId)).map((id) => {
        const suite = filtered.filter((o) => o.suiteId === id),
          label = suite[0]!.suite;
        return {
          id: `suite:${id}`,
          label,
          icon: 'nav-suites',
          cells: cells(suite, label),
          children: unique(suite.map((o) => o.categoryId)).map((categoryId) => {
            const category = suite.filter((o) => o.categoryId === categoryId),
              label = category[0]!.category;
            return {
              id: `category:${id}:${categoryId}`,
              label,
              icon: 'folder',
              cells: cells(category, label),
              children: unique(category.map((o) => o.taskId)).map((taskId) => {
                const task = category.filter((o) => o.taskId === taskId),
                  label = task[0]!.task;
                return {
                  id: `task:${id}:${taskId}`,
                  label,
                  icon: taskIcon(task[0]!.taskType),
                  cells: cells(task, label),
                };
              }),
            };
          }),
        };
      });
    else
      rows = taskGroups.map((g) => {
        const obs = filtered.filter((o) => g.types.some((t) => t === o.taskType));
        return {
          id: `group:${g.id}`,
          label: g.label,
          icon: groupIcons[g.label],
          cells: cells(obs, g.label),
          children: g.types.map((type) => ({
            id: type,
            label: taskLabels[type],
            icon: taskIcon(type),
            cells: cells(
              obs.filter((o) => o.taskType === type),
              taskLabels[type],
            ),
          })),
        };
      });
    const flatten = (r: ScoreRow[]): ScoreRow[] => r.flatMap((row) => [row, ...flatten(row.children ?? [])]),
      all = flatten(rows);
    if (tab === 'model') {
      columns.forEach((_, i) => {
        const best = Math.max(...all.map((r) => ((r.cells[i]?.count ?? 0) >= 20 ? (r.cells[i]?.score ?? -1) : -1)));
        all.forEach((r) => {
          const c = r.cells[i];
          if (c) c.best = (c.count ?? 0) >= 20 && c.score === best;
        });
      });
    } else
      all.forEach((r) => {
        const best = Math.max(...r.cells.map((c) => ((c.count ?? 0) >= 20 ? (c.score ?? -1) : -1)));
        r.cells.forEach((c) => {
          c.best = (c.count ?? 0) >= 20 && c.score === best;
        });
      });
    return rows;
  }, [data, filters, tab, visibleModels, catalog, range.from, range.to]);
  const allGroups = (rows: ScoreRow[]): string[] =>
    rows.flatMap((r) => (r.children?.length ? [r.id, ...allGroups(r.children)] : []));
  const open = expanded ?? rows.map((r) => r.id);
  return (
    <div className="results-layout">
      <FilterPanel
        sections={sections}
        value={filters}
        onChange={(value) => {
          setFilters(value);
          setExpanded(null);
        }}
        defaultOpen={['family', 'license', 'harness']}
      />
      <section className="results-content">
        <div className="page-head">
          <h1>Results</h1>
          <DateRangePicker
            value={range}
            onChange={setRange}
            presets={presets}
            today={today}
            variant="button"
            align="end"
            label="Results period"
          />
        </div>
        <Notice error={error} />
        <div className="results-stats">
          {[
            { label: 'suites', value: unique(filtered.map((o) => o.suiteId)).length, icon: 'nav-suites' },
            { label: 'tasks', value: unique(filtered.map((o) => `${o.suiteId}:${o.taskId}`)).length, icon: 'task' },
            { label: 'runs', value: unique(filtered.map((o) => o.runId)).length, icon: 'nav-runs' },
            { label: 'grades', value: filtered.length, icon: 'nav-grade' },
          ].map((stat) => (
            <StatTile
              key={stat.label}
              label={stat.value === 1 ? stat.label.slice(0, -1) : stat.label}
              value={stat.value.toLocaleString()}
              icon={stat.icon as IconName}
            />
          ))}
        </div>
        <div className="toolbar">
          <Tabs
            label="Results views"
            items={[
              { id: 'model', label: 'By model' },
              { id: 'suite', label: 'By suite' },
              { id: 'task', label: 'By task' },
            ]}
            value={tab}
            onChange={(value) => {
              setTab(value);
              setExpanded(null);
            }}
          />
          <div className="actions">
            {tab !== 'model' && (
              <Popover
                label="Visible models"
                trigger={<IconButton icon="columns" label="Choose model columns" tooltip />}
              >
                <Checklist
                  label="Visible models"
                  items={filteredModels.map((id) => ({ id, label: metadata.get(id)?.name ?? id }))}
                  value={visibleModels ?? filteredModels}
                  onChange={setVisibleModels}
                />
              </Popover>
            )}
            <IconButton
              icon="expand-all"
              label="Expand all rows"
              tooltip
              onClick={() => setExpanded(allGroups(rows))}
            />
            <IconButton icon="collapse-all" label="Collapse all rows" tooltip onClick={() => setExpanded([])} />
          </div>
        </div>
        {loading ? (
          <p role="status">Loading results…</p>
        ) : filtered.length ? (
          <ScoreTable
            columns={columns}
            rows={rows}
            label="Results scores"
            corner={tab === 'model' ? 'Models' : tab === 'suite' ? 'Suites' : 'Task types'}
            expanded={open}
            onExpandedChange={setExpanded}
            firstWidth={300}
            colWidth={112}
          />
        ) : (
          <Empty title={observations.length ? 'No matching grades' : 'No submitted grades yet'} icon="nav-reports">
            {observations.length
              ? 'Try changing the filters or period.'
              : 'Finish a run and submit a grading to compare model scores.'}
          </Empty>
        )}
        {data?.truncated && (
          <p className="results-foot small muted" role="alert">
            Showing the first 100,000 grades. Choose a shorter period.
          </p>
        )}
      </section>
    </div>
  );
}
