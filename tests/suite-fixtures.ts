import { randomUUID } from 'node:crypto';
import { Definition, SuiteContent } from '../packages/contracts/src/suites.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';

export function definition(): Definition {
  const criterionId = randomUUID();
  return Definition.parse({ title: 'Writing suite', description: 'Compare explanations', categories: [{ id: randomUUID(), title: 'Explanations', tasks: [{ id: randomUUID(), title: 'Indexes', kind: 'text-generation', prompt: 'Explain a database index.', criterionIds: [criterionId] }] }], evaluation: { conversion: 'rating-control-v1', criteria: [{ id: criterionId, title: 'Clarity', instructions: 'Prefer a clear explanation.', control: 'stars-5' }], rankingRules: [{ id: randomUUID(), title: 'Priorities', instructions: 'Prefer clarity when other qualities tie.' }] }, materials: { kind: 'none' } });
}
export function pinnedContent(value = definition()): SuiteContent {
  return SuiteContent.parse({ schemaVersion: 1, suiteId: randomUUID(), contentId: randomUUID(), revision: 1, ordinal: 1, createdAt: '2026-09-30T00:00:00.000Z', digest: contentDigest({ schemaVersion: 1, definition: value }), definition: value });
}
