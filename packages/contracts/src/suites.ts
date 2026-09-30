import { z } from 'zod';

export const SuiteId = z.uuid().brand<'SuiteId'>();
export const ContentId = z.uuid().brand<'ContentId'>();
export const CategoryId = z.uuid().brand<'CategoryId'>();
export const TaskId = z.uuid().brand<'TaskId'>();
export const CriterionId = z.uuid().brand<'CriterionId'>();
export const RankingRuleId = z.uuid().brand<'RankingRuleId'>();
export const TaskKind = z.enum(['text-generation', 'text-editing', 'image-generation', 'image-editing', 'image-understanding', 'html-static', 'html-interactive', 'coding-bugfix', 'coding-feature', 'browser-scenario']);
export const RatingControl = z.enum(['stars-5', 'slider-10', 'thumbs']);
export const RatingSelection = z.discriminatedUnion('control', [
  z.object({ control: z.literal('stars-5'), value: z.number().int().min(1).max(5) }).strict(),
  z.object({ control: z.literal('slider-10'), value: z.number().int().min(0).max(10) }).strict(),
  z.object({ control: z.literal('thumbs'), value: z.boolean() }).strict(),
]);
export function toGrade(selection: z.infer<typeof RatingSelection>): number {
  switch (selection.control) {
    case 'stars-5': return selection.value * 20;
    case 'slider-10': return selection.value * 10;
    case 'thumbs': return selection.value ? 100 : 0;
  }
}
const title = z.string().max(120);
const instructions = z.string().max(20_000);
const repositoryUrl = z.string().max(2000).refine((value) => {
  if (!value.trim()) return true;
  try { const url = new URL(value); return ['https:', 'http:', 'ssh:'].includes(url.protocol) && (!url.username || (url.protocol === 'ssh:' && url.username === 'git')) && !url.password; } catch { return false; }
}, 'Use an HTTP(S) or SSH repository URL without embedded credentials');
export const Materials = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('repository'), url: repositoryUrl, requestedRef: z.string().max(500) }).strict(),
]);
export const Criterion = z.object({ id: CriterionId, title, instructions, control: RatingControl }).strict();
export const RankingRule = z.object({ id: RankingRuleId, title, instructions }).strict();
export const TaskDefinition = z.object({ id: TaskId, title, kind: TaskKind, prompt: instructions, criterionIds: z.array(CriterionId).max(100) }).strict();
export const Category = z.object({ id: CategoryId, title, tasks: z.array(TaskDefinition).max(100) }).strict();
export const Definition = z.object({
  title, description: instructions, categories: z.array(Category).max(100),
  evaluation: z.object({ conversion: z.literal('rating-control-v1'), criteria: z.array(Criterion).max(100), rankingRules: z.array(RankingRule).max(100) }).strict(),
  materials: Materials,
}).strict().superRefine((definition, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(definition)).length > 500_000) ctx.addIssue({ code: 'custom', message: 'Suite content must fit within 500,000 UTF-8 bytes' });
  const ids = new Set<string>();
  function unique(id: string, path: Array<string | number>) {
    if (ids.has(id)) ctx.addIssue({ code: 'custom', path, message: 'IDs must be unique within a suite' });
    ids.add(id);
  }
  const criteria = new Set(definition.evaluation.criteria.map((criterion) => criterion.id));
  definition.evaluation.criteria.forEach((criterion, i) => unique(criterion.id, ['evaluation', 'criteria', i, 'id']));
  definition.evaluation.rankingRules.forEach((rule, i) => unique(rule.id, ['evaluation', 'rankingRules', i, 'id']));
  definition.categories.forEach((category, i) => {
    unique(category.id, ['categories', i, 'id']);
    category.tasks.forEach((task, j) => {
      unique(task.id, ['categories', i, 'tasks', j, 'id']);
      const assigned = new Set<string>();
      task.criterionIds.forEach((id, k) => {
        if (!criteria.has(id) || assigned.has(id)) ctx.addIssue({ code: 'custom', path: ['categories', i, 'tasks', j, 'criterionIds', k], message: 'Assign each existing criterion at most once' });
        assigned.add(id);
      });
    });
  });
});
export type Definition = z.infer<typeof Definition>;
export const Issue = z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }).strict();
export const Assessment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }).strict(),
  z.object({ kind: z.literal('incomplete'), issues: z.array(Issue).min(1) }).strict(),
]);
export function assessDefinition(definition: Definition): z.infer<typeof Assessment> {
  const issues: z.infer<typeof Issue>[] = [];
  const require = (present: boolean, path: Array<string | number>, message: string) => { if (!present) issues.push({ path, message }); };
  require(Boolean(definition.title.trim()), ['title'], 'Enter a suite title');
  require(definition.categories.length > 0, ['categories'], 'Add a category');
  require(definition.evaluation.criteria.length > 0, ['evaluation', 'criteria'], 'Add an evaluation criterion');
  definition.categories.forEach((category, i) => {
    const path = ['categories', i];
    require(Boolean(category.title.trim()), [...path, 'title'], 'Enter a category title');
    require(category.tasks.length > 0, [...path, 'tasks'], 'Add a task to this category');
    category.tasks.forEach((task, j) => {
      const taskPath = [...path, 'tasks', j];
      require(Boolean(task.title.trim()), [...taskPath, 'title'], 'Enter a task title');
      require(Boolean(task.prompt.trim()), [...taskPath, 'prompt'], 'Enter a task prompt');
      require(task.criterionIds.length > 0, [...taskPath, 'criterionIds'], 'Assign an evaluation criterion');
    });
  });
  for (const key of ['criteria', 'rankingRules'] satisfies Array<'criteria' | 'rankingRules'>) {
    definition.evaluation[key].forEach((item, i) => {
      require(Boolean(item.title.trim()), ['evaluation', key, i, 'title'], 'Enter a title');
      require(Boolean(item.instructions.trim()), ['evaluation', key, i, 'instructions'], 'Enter written guidance');
    });
  }
  if (definition.materials.kind === 'repository') {
    require(Boolean(definition.materials.url.trim()), ['materials', 'url'], 'Enter a repository URL');
    require(Boolean(definition.materials.requestedRef.trim()), ['materials', 'requestedRef'], 'Enter a repository ref');
  }
  return issues.length ? { kind: 'incomplete', issues } : { kind: 'ready' };
}
export const SuiteContent = z.object({ schemaVersion: z.literal(1), suiteId: SuiteId, contentId: ContentId, revision: z.number().int().positive(), ordinal: z.number().int().positive(), createdAt: z.iso.datetime(), digest: z.string().regex(/^[a-f0-9]{64}$/), definition: Definition }).strict();
export type SuiteContent = z.infer<typeof SuiteContent>;
export const SuiteView = z.object({ content: SuiteContent, assessment: Assessment }).strict();
export type SuiteView = z.infer<typeof SuiteView>;
export const CreateSuite = z.object({ definition: Definition }).strict();
export const SaveSuite = z.object({ expectedContentId: ContentId, change: z.enum(['minor', 'revision']), definition: Definition }).strict();
export const SuiteHistory = z.array(SuiteContent);
export const SuiteList = z.array(z.object({ suiteId: SuiteId, title, revision: z.number().int().positive(), ordinal: z.number().int().positive() }).strict());
export const PinnedSuiteTask = z.object({ content: SuiteContent, taskId: TaskId }).strict();
export type PinnedSuiteTask = z.infer<typeof PinnedSuiteTask>;
