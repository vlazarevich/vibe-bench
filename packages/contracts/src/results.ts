import { z } from 'zod';
import { TaskKind } from './suites.ts';
export const ResultObservation = z
  .object({
    suiteId: z.string(),
    suite: z.string(),
    categoryId: z.string(),
    category: z.string(),
    taskId: z.string(),
    task: z.string(),
    taskType: TaskKind,
    runId: z.string(),
    model: z.string(),
    harness: z.enum(['codex', 'claude', 'opencode']),
    effort: z.string(),
    date: z.iso.date(),
    grade: z.number().min(0).max(100),
  })
  .strict();
export type ResultObservation = z.infer<typeof ResultObservation>;
export const ResultsQuery = z
  .object({ from: z.iso.date(), to: z.iso.date(), source: z.enum(['live', 'fixture']).default('live') })
  .strict()
  .refine((v) => v.from <= v.to, 'Choose a valid date range');
export const ResultsData = z.object({ observations: z.array(ResultObservation), truncated: z.boolean() }).strict();
export type ResultsData = z.infer<typeof ResultsData>;
export const taskGroups = [
  { id: 'text', label: 'Text', types: ['text-generation', 'text-editing'] },
  { id: 'image', label: 'Image', types: ['image-generation', 'image-editing', 'image-understanding'] },
  { id: 'coding', label: 'Coding', types: ['coding-bugfix', 'coding-feature'] },
  { id: 'design', label: 'Design', types: ['html-static', 'html-interactive'] },
  { id: 'agentic', label: 'Agentic', types: ['browser-scenario'] },
] as const;
/** Each suite category has equal weight, irrespective of its task/criterion/grade count. */
export function categoryAverage(
  observations: Pick<ResultObservation, 'suiteId' | 'categoryId' | 'grade'>[],
): number | null {
  const categories = new Map<string, { sum: number; count: number }>();
  for (const o of observations) {
    const key = JSON.stringify([o.suiteId, o.categoryId]);
    const c = categories.get(key) ?? { sum: 0, count: 0 };
    c.sum += o.grade;
    c.count++;
    categories.set(key, c);
  }
  return categories.size
    ? [...categories.values()].reduce((sum, c) => sum + c.sum / c.count, 0) / categories.size
    : null;
}
