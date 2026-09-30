import { createHash, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { Report, RunId } from '../../../../packages/contracts/src/runner.ts';
import { Evaluation, Handle, SessionId } from '../../../../packages/contracts/src/evaluation.ts';
import { Conflict, NotFound } from '../errors.ts';

export const authorityHash = (authority: string) => createHash('sha256').update(authority).digest('hex');
const Mapping = z.tuple([z.object({ handle: Handle, index: z.union([z.literal(0), z.literal(1)]) }), z.object({ handle: Handle, index: z.union([z.literal(0), z.literal(1)]) })]);
const Stored = z.object({ id: SessionId, mapping: Mapping, selected_handle: Handle.nullable(), report: Report });

export async function createEvaluation(pool: pg.Pool, reviewId: string, authority: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [authorityHash(authority) + reviewId]);
    const records = await client.query('SELECT id, report FROM runs WHERE review_id = $1', [reviewId]);
    const run = z.array(z.object({ id: RunId, report: Report })).parse(records.rows)[0];
    if (!run) throw new NotFound();
    const runId = run.id;
    const previous = await client.query('SELECT id FROM evaluation_sessions WHERE run_id = $1 AND authority_hash = $2 LIMIT 1', [runId, authorityHash(authority)]);
    const known = z.array(z.object({ id: SessionId })).parse(previous.rows)[0];
    if (known) {
      await client.query('COMMIT');
      return known.id;
    }
    if (!run.report.entrants.every((e) => e.outcome.kind === 'succeeded')) throw new Conflict('This run has failed attempts and cannot be evaluated');
    const id = SessionId.parse(randomUUID());
    const reverse = randomInt(2) === 1;
    const mapping = [{ handle: randomUUID(), index: reverse ? 1 : 0 }, { handle: randomUUID(), index: reverse ? 0 : 1 }];
    await client.query('INSERT INTO evaluation_sessions(id, run_id, authority_hash, mapping) VALUES($1,$2,$3,$4)', [id, runId, authorityHash(authority), JSON.stringify(mapping)]);
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function present(row: z.infer<typeof Stored>): Evaluation {
  const card = (entry: z.infer<typeof Mapping>[number]) => {
    const outcome = row.report.entrants[entry.index].outcome;
    if (outcome.kind !== 'succeeded') throw new Conflict('This run cannot be evaluated');
    return { handle: entry.handle, text: outcome.text };
  };
  const base = { sessionId: row.id, task: row.report.task, source: row.report.source, cards: [card(row.mapping[0]), card(row.mapping[1])] };
  if (row.selected_handle === null) return Evaluation.parse({ ...base, kind: 'blind' });
  return Evaluation.parse({ ...base, kind: 'revealed', selected: row.selected_handle, identities: row.mapping.map((entry) => ({ handle: entry.handle, model: row.report.entrants[entry.index].model, cliVersion: row.report.entrants[entry.index].cliVersion })) });
}

export async function readEvaluation(pool: pg.Pool, id: z.infer<typeof SessionId>, authority: string) {
  const result = await pool.query('SELECT s.id, s.mapping, s.selected_handle, r.report FROM evaluation_sessions s JOIN runs r ON r.id = s.run_id WHERE s.id = $1 AND s.authority_hash = $2', [id, authorityHash(authority)]);
  const row = z.array(Stored).parse(result.rows)[0];
  if (!row) throw new NotFound();
  return present(row);
}

export async function saveChoice(pool: pg.Pool, id: z.infer<typeof SessionId>, authority: string, handle: z.infer<typeof Handle>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT s.id, s.mapping, s.selected_handle, r.report FROM evaluation_sessions s JOIN runs r ON r.id = s.run_id WHERE s.id = $1 AND s.authority_hash = $2 FOR UPDATE OF s', [id, authorityHash(authority)]);
    const row = z.array(Stored).parse(result.rows)[0];
    if (!row) throw new NotFound();
    if (!row.mapping.some((entry) => entry.handle === handle)) throw new NotFound();
    if (row.selected_handle !== null && row.selected_handle !== handle) throw new Conflict('A final choice has already been saved');
    await client.query('UPDATE evaluation_sessions SET selected_handle = $1, selected_at = COALESCE(selected_at, now()) WHERE id = $2', [handle, id]);
    await client.query('COMMIT');
    return present({ ...row, selected_handle: handle });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
