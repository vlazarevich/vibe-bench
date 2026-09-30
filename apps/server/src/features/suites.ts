import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { assessDefinition, CreateSuite, SaveSuite, SuiteContent, SuiteId, ContentId, SuiteList } from '../../../../packages/contracts/src/suites.ts';
import { contentDigest } from '../../../../packages/contracts/src/canonical.ts';
import { Conflict, NotFound } from '../errors.ts';

const Row = z.object({ id: ContentId, suite_id: SuiteId, ordinal: z.number(), revision: z.number(), schema_version: z.literal(1), digest: z.string(), definition: SuiteContent.shape.definition, created_at: z.date() });
function content(row: unknown): SuiteContent {
  const value = Row.parse(row);
  return SuiteContent.parse({ schemaVersion: value.schema_version, suiteId: value.suite_id, contentId: value.id, ordinal: value.ordinal, revision: value.revision, digest: value.digest, definition: value.definition, createdAt: value.created_at.toISOString() });
}
function view(value: SuiteContent) { return { content: value, assessment: assessDefinition(value.definition) }; }

export async function listSuites(pool: pg.Pool) {
  const result = await pool.query(`SELECT c.suite_id AS "suiteId", c.definition->>'title' AS title, c.revision, c.ordinal
    FROM suites s JOIN suite_contents c ON c.id = s.current_content_id ORDER BY c.created_at DESC`);
  return SuiteList.parse(result.rows);
}
export async function readSuite(pool: pg.Pool, suiteId: z.infer<typeof SuiteId>) {
  const result = await pool.query('SELECT c.* FROM suites s JOIN suite_contents c ON c.id = s.current_content_id WHERE s.id = $1', [suiteId]);
  if (!result.rowCount) throw new NotFound();
  return view(content(result.rows[0]));
}
export async function readSuiteContent(pool: pg.Pool, suiteId: z.infer<typeof SuiteId>, contentId: z.infer<typeof ContentId>) {
  const result = await pool.query('SELECT * FROM suite_contents WHERE suite_id = $1 AND id = $2', [suiteId, contentId]);
  if (!result.rowCount) throw new NotFound();
  return content(result.rows[0]);
}
export async function suiteHistory(pool: pg.Pool, suiteId: z.infer<typeof SuiteId>) {
  const result = await pool.query('SELECT * FROM suite_contents WHERE suite_id = $1 ORDER BY ordinal DESC', [suiteId]);
  if (!result.rowCount) throw new NotFound();
  return result.rows.map(content);
}
export async function createSuite(pool: pg.Pool, input: z.infer<typeof CreateSuite>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const suiteId = randomUUID(), contentId = randomUUID();
    await client.query('INSERT INTO suites(id, current_content_id) VALUES($1, $2)', [suiteId, contentId]);
    const result = await client.query('INSERT INTO suite_contents(id, suite_id, ordinal, revision, schema_version, digest, definition) VALUES($1, $2, 1, 1, 1, $3, $4) RETURNING *', [contentId, suiteId, contentDigest({ schemaVersion: 1, definition: input.definition }), input.definition]);
    await client.query('COMMIT');
    return view(content(result.rows[0]));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function saveSuite(pool: pg.Pool, suiteId: z.infer<typeof SuiteId>, input: z.infer<typeof SaveSuite>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const head = await client.query('SELECT current_content_id FROM suites WHERE id = $1 FOR UPDATE', [suiteId]);
    if (!head.rowCount) throw new NotFound();
    const current = z.object({ current_content_id: ContentId }).parse(head.rows[0]);
    if (current.current_content_id !== input.expectedContentId) throw new Conflict('This suite changed since you opened it. Your edits are retained. Reload the latest version before saving again.');
    const previous = content((await client.query('SELECT * FROM suite_contents WHERE id = $1', [current.current_content_id])).rows[0]);
    const result = await client.query('INSERT INTO suite_contents(id, suite_id, ordinal, revision, schema_version, digest, definition) VALUES($1, $2, $3, $4, 1, $5, $6) RETURNING *', [randomUUID(), suiteId, previous.ordinal + 1, previous.revision + (input.change === 'revision' ? 1 : 0), contentDigest({ schemaVersion: 1, definition: input.definition }), input.definition]);
    const next = content(result.rows[0]);
    await client.query('UPDATE suites SET current_content_id = $1 WHERE id = $2', [next.contentId, suiteId]);
    await client.query('COMMIT');
    return view(next);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
