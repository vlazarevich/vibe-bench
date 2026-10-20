import { ResultPresentation, type FileView } from '../../../../packages/contracts/src/artifact-viewer.ts';
import type { readAttemptResult } from './configured-runs.ts';
import { previewableMedia } from './media-headers.ts';
import { NotFound } from '../errors.ts';

type PrimaryResult<T = ResultPresentation> = T extends ResultPresentation ? Omit<T, 'outputs' | 'inputs'> : never;
export type SavedResult = Awaited<ReturnType<typeof readAttemptResult>>;
export type ResultLinks = {
  artifact: (id: string, purpose: 'download' | 'text' | 'media') => string;
  html: () => string;
  names: 'original' | 'neutral';
};
export function decodeText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? null : text;
  } catch {
    return null;
  }
}
export async function projectResult(saved: SavedResult, links: ResultLinks): Promise<ResultPresentation> {
  const used = new Set<string>();
  const artifact = (id: string) => {
    const found = saved.artifacts.find((item) => item.metadata.id === id);
    if (!found) throw new NotFound();
    used.add(id);
    return found;
  };
  const download = (file: SavedResult['artifacts'][number]) => ({
    url: links.artifact(file.metadata.id, 'download'),
    name: links.names === 'neutral' ? 'Result file' : file.metadata.name,
    bytes: file.bytes.length,
  });
  const fileView = async (file: SavedResult['artifacts'][number], mode: 'text' | 'image'): Promise<FileView> => {
    const common = { download: download(file) };
    if (
      mode === 'image' &&
      file.metadata.mediaType.startsWith('image/') &&
      previewableMedia(file.bytes, file.metadata.mediaType)
    )
      return { kind: 'image', imageUrl: links.artifact(file.metadata.id, 'media'), ...common };
    if (mode === 'text' && decodeText(file.bytes) !== null)
      return { kind: 'text', textUrl: links.artifact(file.metadata.id, 'text'), ...common };
    return {
      kind: 'unsupported',
      reason: 'This file cannot be previewed. Download it to inspect the original bytes.',
      ...common,
    };
  };
  const result = saved.outcome.result;
  let primary: PrimaryResult;
  switch (result.kind) {
    case 'text': {
      const answer = saved.artifacts.find(
        (file) => file.metadata.name === 'answer.txt' && file.metadata.kind === 'text',
      );
      if (answer) used.add(answer.metadata.id);
      primary = {
        kind: 'text',
        download: answer ? download(answer) : null,
        text: answer
          ? (decodeText(answer.bytes) ??
            'The answer contains unsupported text bytes. Download the answer file to inspect it.')
          : saved.outcome.summary,
      };
      if (answer && decodeText(answer.bytes) === null) used.delete(answer.metadata.id);
      break;
    }
    case 'image':
      primary = {
        kind: 'image',
        images: await Promise.all(result.artifactIds.map((id) => fileView(artifact(id), 'image'))),
      };
      break;
    case 'html':
      primary = {
        kind: 'html',
        source: await fileView(artifact(result.entryArtifactId), 'text'),
        preview: { kind: 'interactive', sessionUrl: links.html() },
      };
      break;
    case 'code':
      primary = {
        kind: 'code',
        ...(result.checks ? { checks: result.checks } : {}),
        patch: await fileView(artifact(result.patchArtifactId), 'text'),
        files: await Promise.all(
          result.changedFiles.map(async (entry) => {
            const file = saved.artifacts.find(
              (item) => item.metadata.name === entry.path && item.metadata.kind === 'code',
            );
            return {
              ...entry,
              content: entry.change === 'deleted' || !file ? null : await fileView(artifact(file.metadata.id), 'text'),
            };
          }),
        ),
      };
      break;
    case 'browser': {
      const recording = artifact(result.recordingArtifactId);
      primary = {
        kind: 'browser',
        recording: previewableMedia(recording.bytes, recording.metadata.mediaType)
          ? { kind: 'video', videoUrl: links.artifact(recording.metadata.id, 'media'), download: download(recording) }
          : {
              kind: 'unsupported',
              reason: 'This recording cannot be played. Download the original recording.',
              download: download(recording),
            },
        steps: (result.steps ?? []).map((step) => ({
          action: step.action,
          target: step.target,
          url: step.url,
          imageUrl: links.artifact(step.screenshotArtifactId, 'media'),
        })),
        screenshots: await Promise.all(result.screenshotArtifactIds.map((id) => fileView(artifact(id), 'image'))),
      };
      break;
    }
  }
  const outputs: FileView[] = [];
  for (const output of saved.outputs) {
    const file = saved.artifacts.find(
      (item) => item.metadata.name === output.path && item.metadata.kind === output.kind,
    );
    if (file && !used.has(file.metadata.id)) {
      outputs.push(await fileView(file, output.kind === 'image' ? 'image' : 'text'));
      used.add(file.metadata.id);
    }
  }
  if (result.kind === 'text') {
    const answer = saved.artifacts.find((file) => file.metadata.name === 'answer.txt' && file.metadata.kind === 'text');
    if (answer && !used.has(answer.metadata.id)) outputs.push(await fileView(answer, 'text'));
  }
  const inputs = await Promise.all(
    (result.inputs ?? []).map((input) => fileView(artifact(input.artifactId), input.kind)),
  );
  return ResultPresentation.parse({ ...primary, outputs, inputs });
}
