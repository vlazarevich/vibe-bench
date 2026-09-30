import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assessDefinition, Definition, RatingSelection, SaveSuite, TaskKind, toGrade } from '../packages/contracts/src/suites.ts';
import { canonicalJson, contentDigest } from '../packages/contracts/src/canonical.ts';
import { prepareSnapshot, Report, Snapshot } from '../packages/contracts/src/runner.ts';
import { Progress } from '../apps/runner/src/spool.ts';
import { definition, pinnedContent } from './suite-fixtures.ts';

test('all ten task modes and three controls can be authored with reusable criterion assignments', () => {
  const original = definition();
  const criterion = original.evaluation.criteria[0];
  const task = original.categories[0]?.tasks[0];
  if (!criterion || !task) throw new Error('Missing fixture');
  const value = Definition.parse({ ...original, categories: [{ id: randomUUID(), title: 'All modes', tasks: ['text-generation', 'text-editing', 'image-generation', 'image-editing', 'image-understanding', 'html-static', 'html-interactive', 'coding-bugfix', 'coding-feature', 'browser-scenario'].map((kind) => ({ ...task, id: randomUUID(), kind })) }], evaluation: { ...original.evaluation, criteria: [criterion, { ...criterion, id: randomUUID(), control: 'slider-10' }, { ...criterion, id: randomUUID(), control: 'thumbs' }] } });
  expect(value.categories[0]?.tasks.map((task) => task.kind)).toHaveLength(10);
  expect(assessDefinition(value)).toEqual({ kind: 'ready' });
  expect(assessDefinition({ ...value, evaluation: { ...value.evaluation, rankingRules: [] } })).toEqual({ kind: 'ready' });
});

test('empty drafts save structurally while readiness names missing fields', () => {
  const empty = Definition.parse({ title: ' ', description: '', categories: [], evaluation: { conversion: 'rating-control-v1', criteria: [], rankingRules: [] }, materials: { kind: 'none' } });
  expect(assessDefinition(empty)).toEqual({ kind: 'incomplete', issues: [{ path: ['title'], message: 'Enter a suite title' }, { path: ['categories'], message: 'Add a category' }, { path: ['evaluation', 'criteria'], message: 'Add an evaluation criterion' }] });
  const value = definition();
  const category = value.categories[0], criterion = value.evaluation.criteria[0], task = category?.tasks[0], rule = value.evaluation.rankingRules[0];
  if (!category || !criterion || !task || !rule) throw new Error('Missing fixture');
  const incomplete = Definition.parse({ ...value, categories: [{ ...category, title: '', tasks: [{ ...task, title: '', prompt: ' ', criterionIds: [] }] }, { id: randomUUID(), title: 'Empty', tasks: [] }], evaluation: { ...value.evaluation, criteria: [{ ...criterion, title: '', instructions: '' }], rankingRules: [{ ...rule, title: '', instructions: '' }] }, materials: { kind: 'repository', url: '', requestedRef: '' } });
  const result = assessDefinition(incomplete);
  expect(result.kind).toBe('incomplete');
  if (result.kind !== 'incomplete') throw new Error('Expected incomplete draft');
  expect(result.issues.map((issue) => issue.path.join('.'))).toEqual(['categories.0.title', 'categories.0.tasks.0.title', 'categories.0.tasks.0.prompt', 'categories.0.tasks.0.criterionIds', 'categories.1.tasks', 'evaluation.criteria.0.title', 'evaluation.criteria.0.instructions', 'evaluation.rankingRules.0.title', 'evaluation.rankingRules.0.instructions', 'materials.url', 'materials.requestedRef']);
});

test('structurally invalid IDs, references, choices, controls, enums, URLs and excess bytes are rejected', () => {
  const value = definition();
  const category = value.categories[0], task = category?.tasks[0], criterion = value.evaluation.criteria[0];
  if (!category || !task || !criterion) throw new Error('Missing fixture');
  for (const invalid of [
    { ...value, extra: true }, { ...value, categories: [category, category] },
    { ...value, categories: [{ ...category, tasks: [task, task] }] },
    { ...value, categories: [{ ...category, tasks: [{ ...task, id: 'bad' }] }] },
    { ...value, categories: [{ ...category, tasks: [{ ...task, kind: 'video' }] }] },
    { ...value, categories: [{ ...category, tasks: [{ ...task, criterionIds: [randomUUID()] }] }] },
    { ...value, categories: [{ ...category, tasks: [{ ...task, criterionIds: [criterion.id, criterion.id] }] }] },
    { ...value, evaluation: { ...value.evaluation, criteria: [{ ...criterion, control: 'points' }] } },
    { ...value, materials: { kind: 'repository', url: 'https://secret@github.com/a/b', requestedRef: 'main' } },
    { ...value, materials: { kind: 'repository', url: 'ssh://git:secret@host/a', requestedRef: 'main' } },
    { ...value, materials: { kind: 'repository', url: 'bad-url', requestedRef: 'main' } },
    { ...value, categories: [{ ...category, tasks: Array.from({ length: 10 }, () => ({ ...task, id: randomUUID(), prompt: '界'.repeat(20_000) })) }] },
  ]) expect(Definition.safeParse(invalid).success).toBe(false);
  expect(Definition.safeParse({ ...value, materials: { kind: 'repository', url: 'ssh://git@github.com/org/materials.git', requestedRef: 'refs/tags/v1' } }).success).toBe(true);
  expect(SaveSuite.safeParse({ expectedContentId: randomUUID(), definition: value }).success).toBe(false);
  expect(SaveSuite.safeParse({ change: 'minor', definition: value }).success).toBe(false);
  expect(SaveSuite.safeParse({ expectedContentId: randomUUID(), change: 'automatic', definition: value }).success).toBe(false);
});

test('rating conversion obeys the authored control with no implicit ungraded zero', () => {
  expect([1, 2, 3, 4, 5].map((value) => toGrade(RatingSelection.parse({ control: 'stars-5', value })))).toEqual([20, 40, 60, 80, 100]);
  expect(Array.from({ length: 11 }, (_, value) => toGrade(RatingSelection.parse({ control: 'slider-10', value })))).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  expect([false, true].map((value) => toGrade(RatingSelection.parse({ control: 'thumbs', value })))).toEqual([0, 100]);
  for (const value of [null, {}, { control: 'stars-5', value: 0 }, { control: 'stars-5', value: 6 }, { control: 'stars-5', value: 2.5 }, { control: 'slider-10', value: -1 }, { control: 'slider-10', value: 11 }, { control: 'slider-10', value: 0.5 }, { control: 'thumbs', value: 1 }]) expect(RatingSelection.safeParse(value).success).toBe(false);
});

test('canonical content digest ignores object key order and preserves array order and values', () => {
  expect(contentDigest({ b: [1, 2], a: 'x' })).toBe(contentDigest({ a: 'x', b: [1, 2] }));
  expect(contentDigest([1, 2])).not.toBe(contentDigest([2, 1]));
  expect(contentDigest({ a: 'x' })).not.toBe(contentDigest({ a: 'y' }));
  expect(canonicalJson({ b: null, a: [true, 'x'] })).toBe('{"a":[true,"x"],"b":null}');
});

test('snapshot validates exact task, content digest, readiness, supported execution, models and settings', () => {
  const content = pinnedContent(), task = content.definition.categories[0]?.tasks[0];
  if (!task) throw new Error('Missing task');
  const options = { task: { title: 'Ignored local task', prompt: 'Ignored' }, pinned: { content, taskId: task.id }, models: ['gpt-6-luna', 'gpt-6-sol'] satisfies ['gpt-6-luna', 'gpt-6-sol'], timeoutMs: 10_000 };
  const snapshot = prepareSnapshot(options);
  expect(snapshot.task).toEqual({ title: 'Indexes', prompt: 'Explain a database index.' });
  expect(Snapshot.safeParse({ ...snapshot, digest: '0'.repeat(64) }).success).toBe(false);
  const { digest: _digest, ...body } = snapshot;
  const changed = { ...body, task: { ...body.task, prompt: 'Tampered' } };
  expect(Snapshot.safeParse({ ...changed, digest: contentDigest(changed) }).success).toBe(false);
  expect(() => prepareSnapshot({ ...options, models: ['gpt-6-luna', 'gpt-6-luna'] })).toThrow();
  expect(() => prepareSnapshot({ ...options, timeoutMs: 0 })).toThrow();
  for (const kind of TaskKind.options.filter((kind) => kind !== 'text-generation')) {
    const definition = { ...content.definition, categories: [{ ...content.definition.categories[0], id: randomUUID(), title: 'Modes', tasks: [{ ...task, kind }] }] };
    expect(() => prepareSnapshot({ ...options, pinned: { content: pinnedContent(Definition.parse(definition)), taskId: task.id } })).toThrow('only text-generation');
  }
  expect(() => prepareSnapshot({ ...options, pinned: { content: pinnedContent({ ...content.definition, materials: { kind: 'repository', url: 'https://example.com/a', requestedRef: 'main' } }), taskId: task.id } })).toThrow('only text-generation');
  expect(() => prepareSnapshot({ ...options, pinned: { content: pinnedContent({ ...content.definition, title: '' }), taskId: task.id } })).toThrow('Complete the suite');
  expect(() => prepareSnapshot({ ...options, pinned: { content: { ...content, digest: '0'.repeat(64) }, taskId: task.id } })).toThrow('digest');
});

test('protocol 1 reports and progress remain readable; protocol 2 rejects mismatched report inputs', () => {
  const entrants = ['gpt-6-luna', 'gpt-6-sol'].map((model) => ({ attemptId: randomUUID(), model, cliVersion: 'fixture', outcome: { kind: 'succeeded', text: 'Answer' } }));
  const legacy = { protocol: 1, reportId: randomUUID(), runId: randomUUID(), source: 'fixture', createdAt: new Date().toISOString(), task: { title: 'Task', prompt: 'Prompt' }, entrants };
  expect(Report.parse(legacy).protocol).toBe(1);
  expect(Progress.parse({ protocol: 1, reportId: legacy.reportId, runId: legacy.runId, source: legacy.source, createdAt: legacy.createdAt, task: legacy.task, attempts: entrants.map((entrant) => ({ kind: 'finished', result: entrant })) }).protocol).toBe(1);
  const snapshot = prepareSnapshot({ task: legacy.task, models: ['gpt-6-luna', 'gpt-6-sol'], timeoutMs: 1000 });
  expect(Report.parse({ ...legacy, protocol: 2, snapshot }).protocol).toBe(2);
  expect(Report.safeParse({ ...legacy, protocol: 2, snapshot, task: { title: 'Wrong', prompt: 'Prompt' } }).success).toBe(false);
  expect(Report.safeParse({ ...legacy, protocol: 2, snapshot, entrants: [...entrants].reverse() }).success).toBe(false);
});
