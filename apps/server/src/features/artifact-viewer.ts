import { createHash } from 'node:crypto';
import { ResultPresentation, type FileView } from '../../../../packages/contracts/src/artifact-viewer.ts';
import type { readAttemptResult } from './configured-runs.ts';
import { isolatedChromium } from './isolated-chromium.ts';
import { NotFound } from '../errors.ts';

type PrimaryResult<T = ResultPresentation> = T extends ResultPresentation ? Omit<T, 'outputs'> : never;
export type SavedResult = Awaited<ReturnType<typeof readAttemptResult>>;
export type ResultLinks = { artifact: (id: string, purpose: 'download' | 'text' | 'media') => string; html: () => string; names: 'original' | 'neutral' };
export function decodeText(bytes: Buffer): string | null {
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? null : text; } catch { return null; }
}
const mediaChecks = new Map<string, Promise<boolean>>();
let mediaQueue = Promise.resolve();
async function validMedia(bytes: Buffer, mediaType: string) {
  const signatureMatches = mediaType === 'image/png' ? bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : mediaType === 'image/jpeg' ? bytes.length > 4 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
    : mediaType === 'image/webp' ? bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : mediaType === 'video/webm' && bytes.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (!signatureMatches) return false;
  const key = createHash('sha256').update(mediaType).update(bytes).digest('hex');
  const cached = mediaChecks.get(key); if (cached) return cached;
  const check = mediaQueue.then(async () => {
    const runtime = await isolatedChromium();
    try {
      const page = await runtime.browser.newPage();
      return await page.evaluate(async ({ data, video }) => {
        const media = document.createElement(video ? 'video' : 'img');
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 3000);
          media.onerror = () => { clearTimeout(timer); resolve(false); };
          if (media instanceof HTMLVideoElement) media.onloadedmetadata = () => { clearTimeout(timer); resolve(media.videoWidth > 0 && media.videoWidth * media.videoHeight <= 40_000_000); };
          else media.onload = () => { clearTimeout(timer); resolve(media.naturalWidth > 0 && media.naturalWidth * media.naturalHeight <= 40_000_000); };
          media.src = data;
        });
      }, { data: `data:${mediaType};base64,${bytes.toString('base64')}`, video: mediaType === 'video/webm' });
    } finally { await runtime.close(); }
  }).catch(() => false);
  mediaQueue = check.then(() => undefined);
  if (mediaChecks.size >= 256) mediaChecks.delete(mediaChecks.keys().next().value ?? '');
  mediaChecks.set(key, check); return check;
}
export async function projectResult(saved: SavedResult, links: ResultLinks): Promise<ResultPresentation> {
  const used = new Set<string>();
  const artifact = (id: string) => { const found = saved.artifacts.find((item) => item.metadata.id === id); if (!found) throw new NotFound(); used.add(id); return found; };
  const download = (file: SavedResult['artifacts'][number]) => ({ url: links.artifact(file.metadata.id, 'download'), name: links.names === 'neutral' ? 'Result file' : file.metadata.name, bytes: file.bytes.length });
  const fileView = async (file: SavedResult['artifacts'][number], mode: 'text' | 'image'): Promise<FileView> => {
    const common = { download: download(file) };
    if (mode === 'image' && file.metadata.mediaType.startsWith('image/') && await validMedia(file.bytes, file.metadata.mediaType)) return { kind: 'image', imageUrl: links.artifact(file.metadata.id, 'media'), ...common };
    if (mode === 'text' && decodeText(file.bytes) !== null) return { kind: 'text', textUrl: links.artifact(file.metadata.id, 'text'), ...common };
    return { kind: 'unsupported', reason: 'This file cannot be previewed. Download it to inspect the original bytes.', ...common };
  };
  const result = saved.outcome.result;
  let primary: PrimaryResult;
  switch (result.kind) {
    case 'text': {
      const answer = saved.artifacts.find((file) => file.metadata.name === 'answer.txt' && file.metadata.kind === 'text');
      if (answer) used.add(answer.metadata.id);
      primary = { kind: 'text', text: answer ? decodeText(answer.bytes) ?? 'The answer contains unsupported text bytes. Download the answer file to inspect it.' : saved.outcome.summary };
      if (answer && decodeText(answer.bytes) === null) used.delete(answer.metadata.id);
      break;
    }
    case 'image': primary = { kind: 'image', images: await Promise.all(result.artifactIds.map((id) => fileView(artifact(id), 'image'))) }; break;
    case 'html': primary = { kind: 'html', source: await fileView(artifact(result.entryArtifactId), 'text'), preview: { kind: 'interactive', sessionUrl: links.html() } }; result.assetArtifactIds.forEach(artifact); break;
    case 'code': primary = { kind: 'code', patch: await fileView(artifact(result.patchArtifactId), 'text'), files: await Promise.all(result.changedFiles.map(async (entry) => {
      const file = saved.artifacts.find((item) => item.metadata.name === entry.path && item.metadata.kind === 'code');
      return { ...entry, content: entry.change === 'deleted' || !file ? null : await fileView(artifact(file.metadata.id), 'text') };
    })) }; break;
    case 'browser': {
      const recording = artifact(result.recordingArtifactId);
      primary = { kind: 'browser', recording: await validMedia(recording.bytes, recording.metadata.mediaType) ? { kind: 'video', videoUrl: links.artifact(recording.metadata.id, 'media'), download: download(recording) } : { kind: 'unsupported', reason: 'This recording cannot be played. Download the original recording.', download: download(recording) }, screenshots: await Promise.all(result.screenshotArtifactIds.map((id) => fileView(artifact(id), 'image'))) }; break;
    }
  }
  const outputs: FileView[] = [];
  for (const output of saved.outputs) {
    const file = saved.artifacts.find((item) => item.metadata.name === output.path && item.metadata.kind === output.kind);
    if (file && !used.has(file.metadata.id)) { outputs.push(await fileView(file, output.kind === 'image' ? 'image' : 'text')); used.add(file.metadata.id); }
  }
  if (result.kind === 'text') {
    const answer = saved.artifacts.find((file) => file.metadata.name === 'answer.txt' && file.metadata.kind === 'text');
    if (answer && !used.has(answer.metadata.id)) outputs.push(await fileView(answer, 'text'));
  }
  return ResultPresentation.parse({ ...primary, outputs });
}
export function htmlBundle(saved: SavedResult) {
  const result = saved.outcome.result;
  if (result.kind !== 'html') throw new NotFound();
  const ids = new Set([result.entryArtifactId, ...result.assetArtifactIds]);
  const entry = saved.artifacts.find((file) => file.metadata.id === result.entryArtifactId);
  if (!entry) throw new NotFound();
  return { entry: entry.metadata.name, files: saved.artifacts.filter((file) => ids.has(file.metadata.id) && file.metadata.kind !== 'diagnostic').map((file) => ({ name: file.metadata.name, mediaType: file.metadata.mediaType, bytes: file.bytes })) };
}
