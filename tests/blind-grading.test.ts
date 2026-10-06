import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { BlindGradingRuns, BlindGradingSession, BlindGradingTask, Judgment } from '../packages/contracts/src/blind-grading.ts';
import { gradingFixture, canary, png, webm } from './grading-fixtures.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/grading-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });
async function request(path: string, cookie = '', body?: unknown) {
  return fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...(body === undefined ? {} : { origin: url, 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function readyFixture() {
  const fixture = await gradingFixture(url); await fixture.finish();
  const runs = BlindGradingRuns.parse(await (await request('/api/blind-grading/runs')).json());
  const run = runs.find((run) => run.title === fixture.value.title); if (!run) throw new Error('Missing review');
  const opened = await request('/api/blind-grading', '', { reviewId: run.reviewId });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const cookie = opened.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { ...fixture, review: run, cookie, session: BlindGradingSession.parse(await opened.json()) };
}
async function task(session: BlindGradingSession, cookie: string, index = 0) {
  const selected = session.categories.flatMap((category) => category.tasks)[index]; if (!selected) throw new Error('Missing task');
  const response = await request(`/api/blind-grading/${session.id}/tasks/${selected.handle}`, cookie);
  expect(response.status, await response.clone().text()).toBe(200);
  return BlindGradingTask.parse(await response.json());
}

test('terminal eligibility, subset, pinned criteria, neutral projection, cookie authority, and immutable associations', async () => {
  const fixture = await gradingFixture(url);
  const runs = BlindGradingRuns.parse(await (await request('/api/blind-grading/runs')).json());
  const review = runs.find((run) => run.title === fixture.value.title); if (!review) throw new Error('Missing review');
  expect(review.ready).toBe(false);
  expect((await request('/api/blind-grading', '', { reviewId: review.reviewId })).status).toBe(409);
  await fixture.finish();
  const changed = structuredClone(fixture.value); changed.evaluation.criteria.forEach((criterion) => { criterion.title = 'New title'; criterion.control = 'thumbs'; });
  await fixture.post(`/api/suites/${fixture.suite.content.suiteId}`, { expectedContentId: fixture.suite.content.contentId, change: 'revision', definition: changed });
  const first = await request('/api/blind-grading', '', { reviewId: review.reviewId });
  expect(first.headers.get('set-cookie')).toContain('HttpOnly'); expect(first.headers.get('set-cookie')).toContain('SameSite=Strict');
  const cookie = first.headers.get('set-cookie')?.split(';')[0] ?? '';
  const session = BlindGradingSession.parse(await first.json());
  expect(session.categories.map((category) => category.title)).toEqual(['Writing', 'Media']);
  expect(session.categories.flatMap((category) => category.tasks).map((task) => task.title)).toEqual(['First task', 'Image task', 'HTML task', 'Browser task', 'Patch task']);
  expect(session.categories[0]?.tasks[0]?.progress).toEqual({ ungraded: 6, skipped: 0, graded: 0, unavailable: 2 });
  const same = await Promise.all(Array.from({ length: 4 }, () => request('/api/blind-grading', cookie, { reviewId: review.reviewId })));
  for (const response of same) expect(await response.json()).toEqual(session);
  const view = await task(session, cookie);
  expect(view.cards).toHaveLength(4); expect(view.cards.map((card) => card.kind).sort()).toEqual(['completed', 'completed', 'failed', 'skipped']);
  expect(view.criteria.map((criterion) => criterion.control)).toEqual(['stars-5', 'slider-10', 'thumbs']);
  expect(view.criteria[0]?.instructions).toBe('Original stars-5 guidance');
  const all = JSON.stringify({ runs, session, view });
  for (const forbidden of [canary, fixture.run.runId, fixture.input.runtimeId, fixture.suite.content.contentId, ...fixture.assignment.attempts.map((attempt) => attempt.attemptId), ...fixture.value.evaluation.criteria.map((criterion) => criterion.id)]) expect(all).not.toContain(forbidden);
  for (const foreignCookie of ['', 'vibe_grading_authority=' + 'a'.repeat(64)]) {
    for (const path of [`/api/blind-grading/${session.id}`, `/api/blind-grading/${session.id}/tasks/${view.handle}`]) {
      const response = await request(path, foreignCookie); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Not found' });
    }
  }
  const cell = view.cards.flatMap((card) => card.kind === 'completed' ? card.judgments : [])[0]; if (!cell) throw new Error('Missing cell');
  expect((await request(`/api/blind-grading/${session.id}/judgments`, '', { card: cell.card, criterion: cell.criterion, expectedVersion: 0, value: { kind: 'skipped' } })).status).toBe(404);
  await expect(pool.query('UPDATE blind_grading_sessions SET mapping=$1 WHERE id=$2', [{}, session.id])).rejects.toThrow('Immutable');
  for (const column of ['session_id', 'card_handle', 'criterion_handle', 'task_handle']) await expect(pool.query(`UPDATE blind_grading_judgments SET ${column}=$1 WHERE session_id=$2`, [randomUUID(), session.id])).rejects.toThrow('Immutable');
  const stored = (await pool.query('SELECT mapping,r.snapshot,r.request FROM blind_grading_sessions s JOIN configured_runs r ON r.id=s.run_id WHERE s.id=$1', [session.id])).rows[0];
  expect(stored.request).toEqual(fixture.input); expect(stored.snapshot).toEqual(fixture.run.snapshot);
  expect(stored.mapping.conversion).toBe('rating-control-v1');
  expect(stored.mapping.categories[0].tasks[0].criteria[0].snapshot).toEqual(fixture.value.evaluation.criteria[0]);
});

test('all selections, equal grades, explicit skip/clear, exact retry, competing writers, foreign cells, and restart', async () => {
  const fixture = await readyFixture(); const { session, cookie } = fixture;
  const view = await task(session, cookie);
  const cards = view.cards.filter((card) => card.kind === 'completed'); const card = cards[0], equalCard = cards[1];
  if (!card || !equalCard) throw new Error('Missing completed cards');
  const save = (body: unknown, target = session.id) => request(`/api/blind-grading/${target}/judgments`, cookie, body);
  for (const criterion of view.criteria) {
    let version = 0;
    const values = criterion.control === 'stars-5' ? [1, 2, 3, 4, 5] : criterion.control === 'slider-10' ? Array.from({ length: 11 }, (_, i) => i) : [false, true];
    for (const value of values) {
      const command = { card: card.handle, criterion: criterion.handle, expectedVersion: version, value: { kind: 'graded', selection: { control: criterion.control, value } } };
      const response = await save(command); expect(response.status, await response.clone().text()).toBe(200);
      const saved = Judgment.parse(await response.json()); expect(saved.version).toBe(++version);
      expect(saved.value).toEqual({ ...command.value, grade: criterion.control === 'stars-5' ? Number(value) * 20 : criterion.control === 'slider-10' ? Number(value) * 10 : value ? 100 : 0 });
      expect(await (await save(command)).json()).toEqual(saved);
    }
    const equal = { card: equalCard.handle, criterion: criterion.handle, expectedVersion: 0, value: { kind: 'graded', selection: { control: criterion.control, value: values.at(-1) } } };
    expect((await save(equal)).status).toBe(200);
    const skip = { card: card.handle, criterion: criterion.handle, expectedVersion: version, value: { kind: 'skipped' } };
    expect(Judgment.parse(await (await save(skip)).json()).value).toEqual({ kind: 'skipped' }); version++;
    expect(Judgment.parse(await (await save({ ...skip, expectedVersion: version, value: { kind: 'ungraded' } })).json()).value).toEqual({ kind: 'ungraded' }); version++;
    expect((await save(skip)).status).toBe(409);
    expect((await save({ ...skip, expectedVersion: version, value: { kind: 'graded', selection: { control: criterion.control === 'thumbs' ? 'stars-5' : 'thumbs', value: criterion.control === 'thumbs' ? 1 : true } } })).status).toBe(409);
    const outcomes = await Promise.all([{ kind: 'skipped' }, { kind: 'graded', selection: { control: criterion.control, value: values[0] } }].map((value) => save({ ...skip, expectedVersion: version, value })));
    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409]);
  }
  const current = await task(session, cookie);
  const independent = current.cards.flatMap((card) => card.kind === 'completed' ? card.judgments : []).slice(0, 2);
  expect(independent).toHaveLength(2);
  const independentResponses = await Promise.all(independent.map((cell) => save({ card: cell.card, criterion: cell.criterion, expectedVersion: cell.version, value: { kind: 'skipped' } })));
  expect(independentResponses.map((response) => response.status)).toEqual([200, 200]);
  const association = (await pool.query(`SELECT r.snapshot, o.outcome, criterion->'snapshot' AS criterion, j.value
    FROM blind_grading_judgments j JOIN blind_grading_sessions s ON s.id=j.session_id JOIN configured_runs r ON r.id=s.run_id,
    jsonb_array_elements(s.mapping->'categories') category, jsonb_array_elements(category->'tasks') task,
    jsonb_array_elements(task->'cards') card, jsonb_array_elements(task->'criteria') criterion,
    attempt_outcomes o WHERE j.session_id=$1 AND j.card_handle=$2 AND j.criterion_handle=$3
    AND card->>'handle'=j.card_handle::text AND criterion->>'handle'=j.criterion_handle::text AND o.attempt_id=(card->>'attemptId')::uuid`,
  [session.id, card.handle, view.criteria[0]?.handle])).rows;
  expect(association).toHaveLength(1);
  expect(association[0].snapshot.content).toEqual(fixture.suite.content);
  expect(association[0].criterion).toEqual(fixture.value.evaluation.criteria[0]);
  expect(association[0].outcome.summary).toBe(card.result.kind === 'text' ? card.result.text : 'not text');
  expect(association[0].value).toEqual({ kind: 'skipped' });
  const otherTask = await task(session, cookie, 1); const foreign = otherTask.criteria[0]; const criterion = view.criteria[0]; if (!foreign || !criterion) throw new Error('Missing criterion');
  expect((await save({ card: card.handle, criterion: foreign.handle, expectedVersion: 0, value: { kind: 'skipped' } })).status).toBe(404);
  const unavailable = view.cards.find((card) => card.kind !== 'completed'); if (!unavailable) throw new Error('Missing unavailable');
  expect((await save({ card: unavailable.handle, criterion: criterion.handle, expectedVersion: 0, value: { kind: 'skipped' } })).status).toBe(404);
  expect((await save({ card: card.handle, criterion: criterion.handle, expectedVersion: 0, value: { kind: 'graded', selection: { control: 'stars-5', value: 0 } } })).status).toBe(400);
  const ownOther = await request('/api/blind-grading', '', { reviewId: fixture.review.reviewId });
  const other = BlindGradingSession.parse(await ownOther.json());
  expect((await save({ card: card.handle, criterion: criterion.handle, expectedVersion: 0, value: { kind: 'skipped' } }, other.id)).status).toBe(404);
  const before = await task(session, cookie);
  const progress = await (await request(`/api/blind-grading/${session.id}`, cookie)).json();
  await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url); app = await createApp({ pool }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect(await task(session, cookie)).toEqual(before); expect(await (await request(`/api/blind-grading/${session.id}`, cookie)).json()).toEqual(progress);
});

test('only declared result artifacts cross anonymous transport with neutral headers and unchanged bytes', async () => {
  const { session, cookie, artifacts } = await readyFixture();
  for (let index = 1; index < 5; index++) {
    const view = await task(session, cookie, index);
    expect(JSON.stringify(view)).not.toContain(canary);
    const cards = view.cards.filter((card) => card.kind === 'completed');
    for (const card of cards) {
      if (card.result.kind === 'text') throw new Error('Expected media result');
      expect(card.result.assets).toHaveLength(1);
      for (const asset of card.result.assets) {
        const path = `/api/blind-grading/${session.id}/assets/${asset.handle}`;
        const response = await request(path, cookie);
        expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-disposition')).toContain('filename="result.bin"');
        expect(JSON.stringify([...response.headers])).not.toContain(canary);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(artifacts.some((artifact) => artifact.bytes.equals(bytes))).toBe(true);
        if (index === 1) { expect(bytes).toEqual(png); expect(response.headers.get('content-type')).toBe('image/png'); }
        else if (index === 3) { expect(bytes).toEqual(webm); expect(response.headers.get('content-type')).toBe('video/webm'); }
        else { expect(response.headers.get('content-type')).toBe('application/octet-stream'); expect(response.headers.get('content-disposition')).toContain('attachment'); }
        expect((await request(path)).status).toBe(404);
      }
    }
  }
  for (const artifact of artifacts) expect((await request(`/api/blind-grading/${session.id}/assets/${artifact.id}`, cookie)).status).toBe(404);
});
