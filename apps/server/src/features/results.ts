import type pg from 'pg';
import { z } from 'zod';
import { ResultsData, ResultsQuery } from '../../../../packages/contracts/src/results.ts';
import { RatingSelection, toGrade } from '../../../../packages/contracts/src/suites.ts';
export async function readResults(pool: pg.Pool, query: z.infer<typeof ResultsQuery>) {
  const rows = await pool.query(
    `SELECT r.snapshot->'content'->>'suiteId' AS "suiteId",r.snapshot->'content'->'definition'->>'title' AS suite,
    category->>'title' AS category, pinned_category->>'id' AS "categoryId", task->>'taskId' AS "taskId",task->>'title' AS task,task->>'kind' AS "taskType",r.id AS "runId",
    entrant->>'model' AS model,entrant->>'harness' AS harness,coalesce(entrant->'settings'->>'reasoningEffort',entrant->'settings'->>'effort',entrant->'settings'->>'variant','auto') AS effort,
    to_char(sub.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,j.value->'selection' AS selection
    FROM blind_grading_sessions s JOIN grading_submissions sub ON sub.session_id=s.id JOIN configured_runs r ON r.id=s.run_id
    CROSS JOIN LATERAL jsonb_array_elements(s.mapping->'categories') category
    CROSS JOIN LATERAL jsonb_array_elements(category->'tasks') task
    CROSS JOIN LATERAL jsonb_array_elements(task->'cards') card
    JOIN configured_attempts a ON a.id=(card->>'attemptId')::uuid
    CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'entrants') entrant
    CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'content'->'definition'->'categories') pinned_category
    JOIN blind_grading_judgments j ON j.session_id=s.id AND j.card_handle=(card->>'handle')::uuid
    WHERE entrant->>'id'=a.entrant_id::text AND EXISTS(SELECT 1 FROM jsonb_array_elements(pinned_category->'tasks') pt WHERE pt->>'id'=task->>'taskId')
    AND j.value->>'kind'='graded' AND sub.submitted_at >= $1::date AND sub.submitted_at < $2::date + interval '1 day' AND r.snapshot->>'source'=$3
    ORDER BY sub.submitted_at,s.id,j.card_handle,j.criterion_handle LIMIT 100001`,
    [query.from, query.to, query.source],
  );
  return ResultsData.parse({
    observations: rows.rows
      .slice(0, 100_000)
      .map(({ selection, ...row }) => ({ ...row, grade: toGrade(RatingSelection.parse(selection)) })),
    truncated: rows.rows.length > 100_000,
  });
}
