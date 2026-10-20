import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { AttemptOutcome } from '../../../../packages/contracts/src/configured-runs.ts';
import { PreviewOpened } from '../../../../packages/contracts/src/artifact-viewer.ts';
import type { SavedResult } from './artifact-viewer.ts';
import { NotFound } from '../errors.ts';

export const PREVIEW_LIFETIME_MS = 30 * 60_000;
export const PreviewToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const encodedPath = (name: string) => name.split('/').map(encodeURIComponent).join('/');
/**
 * Bundle names and request paths compare as decoded segments after the same URL normalization, so a browser that
 * sends `a+b.js` and one that sends `a%2Bb.js` both reach that asset, and dot segments resolve before matching.
 */
function pathKey(path: string) {
  try {
    // `./` keeps a first segment such as `page:2.html` relative instead of parsing it as a URL scheme.
    return new URL(`./${path}`, 'https://preview.invalid/').pathname.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}
const nameKey = (name: string) => pathKey(name.replaceAll('%', '%25').replaceAll('?', '%3F').replaceAll('#', '%23'));

/** Issues a capability for one authorized HTML result. The caller has already checked dashboard or grading authority. */
export async function grantPreview(pool: pg.Pool, attemptId: string, saved: SavedResult) {
  const result = saved.outcome.result;
  if (result.kind !== 'html') throw new NotFound();
  const entry = saved.artifacts.find((file) => file.metadata.id === result.entryArtifactId);
  if (!entry) throw new NotFound();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PREVIEW_LIFETIME_MS);
  await pool.query('DELETE FROM preview_grants WHERE expires_at < now()');
  await pool.query('INSERT INTO preview_grants(token_hash, attempt_id, expires_at) VALUES($1,$2,$3)', [
    hash(token),
    attemptId,
    expiresAt,
  ]);
  return PreviewOpened.parse({
    frameUrl: `/preview/${token}/${encodedPath(entry.metadata.name)}`,
    expiresAt: expiresAt.toISOString(),
  });
}

/** Resolves one bundle file for an unexpired grant. Only the entry and declared assets are reachable. */
export async function readPreviewFile(pool: pg.Pool, token: string, requestPath: string) {
  const grant = await pool.query(
    'SELECT o.attempt_id, o.outcome FROM preview_grants g JOIN attempt_outcomes o ON o.attempt_id = g.attempt_id WHERE g.token_hash = $1 AND g.expires_at > now()',
    [hash(token)],
  );
  if (!grant.rowCount) throw new NotFound();
  const outcome = AttemptOutcome.parse(grant.rows[0].outcome);
  if (outcome.kind !== 'completed' || outcome.result.kind !== 'html') throw new NotFound();
  const bundle = new Set([outcome.result.entryArtifactId, ...outcome.result.assetArtifactIds]);
  const wanted = pathKey(requestPath);
  const metadata =
    wanted === null
      ? undefined
      : outcome.artifacts.find((file) => bundle.has(file.id) && file.kind !== 'diagnostic' && nameKey(file.name) === wanted);
  if (!metadata) throw new NotFound();
  const stored = await pool.query('SELECT bytes FROM configured_artifacts WHERE id = $1 AND attempt_id = $2', [
    metadata.id,
    grant.rows[0].attempt_id,
  ]);
  if (!stored.rowCount) throw new NotFound();
  return { mediaType: metadata.mediaType, bytes: z.instanceof(Buffer).parse(stored.rows[0].bytes) };
}

/**
 * Preview responses are sandboxed documents with an opaque origin: scripts run, but cannot read dashboard state,
 * reach the network, submit forms, open windows, or load anything outside this grant's path.
 */
export function previewPolicy(origin: string, token: string) {
  const bundle = `${origin}/preview/${token}/`;
  return [
    'sandbox allow-scripts allow-forms',
    "default-src 'none'",
    `script-src ${bundle} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${bundle} 'unsafe-inline'`,
    `img-src ${bundle} data: blob:`,
    `media-src ${bundle} data: blob:`,
    `font-src ${bundle} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${origin}`,
  ].join('; ');
}
