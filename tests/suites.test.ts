import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assessDefinition, Definition, RatingSelection, SaveSuite, toGrade } from '../packages/contracts/src/suites.ts';
import { canonicalJson, contentDigest } from '../packages/contracts/src/canonical.ts';
import { definition } from './suite-fixtures.ts';

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
