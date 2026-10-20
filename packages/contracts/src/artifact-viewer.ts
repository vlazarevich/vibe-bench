import { z } from 'zod';
import { Text } from './text.ts';

const LocalUrl = Text.max(2000).regex(/^\/(?!\/)[a-zA-Z0-9/_-]+$/);
const Download = z
  .object({ url: LocalUrl, name: Text.max(500), bytes: z.number().int().min(0).max(8_000_000) })
  .strict();
export const FileView = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), textUrl: LocalUrl, download: Download }).strict(),
  z.object({ kind: z.literal('image'), imageUrl: LocalUrl, download: Download }).strict(),
  z.object({ kind: z.literal('unsupported'), reason: Text.max(500), download: Download }).strict(),
]);
export type FileView = z.infer<typeof FileView>;
export const SharedTaskInputs = z.discriminatedUnion('shared', [
  z.object({ shared: z.literal(true), inputs: z.array(FileView).min(1).max(32) }).strict(),
  z.object({ shared: z.literal(false) }).strict(),
]);
const originalInputs = { inputs: z.array(FileView).max(32).optional() };
const outputs = z.array(FileView).max(32);
export const ResultPresentation = z.discriminatedUnion('kind', [
  z
    .object({
      ...originalInputs,
      kind: z.literal('text'),
      text: Text.max(8_000_000),
      download: Download.nullable(),
      outputs,
    })
    .strict(),
  z.object({ ...originalInputs, kind: z.literal('image'), images: z.array(FileView).max(32), outputs }).strict(),
  z
    .object({
      ...originalInputs,
      kind: z.literal('code'),
      checks: z.object({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).optional(),
      patch: FileView,
      files: z
        .array(
          z
            .object({
              path: Text.max(500),
              change: z.enum(['added', 'modified', 'deleted']),
              content: FileView.nullable(),
            })
            .strict(),
        )
        .max(1000),
      outputs,
    })
    .strict(),
  z
    .object({
      ...originalInputs,
      kind: z.literal('html'),
      preview: z.discriminatedUnion('kind', [
        z.object({ ...originalInputs, kind: z.literal('interactive'), sessionUrl: LocalUrl }).strict(),
        z.object({ ...originalInputs, kind: z.literal('unavailable'), reason: Text.max(500) }).strict(),
      ]),
      source: FileView,
      outputs,
    })
    .strict(),
  z
    .object({
      ...originalInputs,
      kind: z.literal('browser'),
      recording: z.discriminatedUnion('kind', [
        z.object({ ...originalInputs, kind: z.literal('video'), videoUrl: LocalUrl, download: Download }).strict(),
        z
          .object({ ...originalInputs, kind: z.literal('unsupported'), reason: Text.max(500), download: Download })
          .strict(),
      ]),
      steps: z
        .array(
          z.object({ action: Text.max(100), target: Text.max(500), url: Text.max(2000), imageUrl: LocalUrl }).strict(),
        )
        .max(100)
        .optional(),
      screenshots: z.array(FileView).max(31),
      outputs,
    })
    .strict(),
]);
export type ResultPresentation = z.infer<typeof ResultPresentation>;
/** Capability URL for one HTML bundle; the token is the only authority for its files. */
// 240-character artifact names can percent-encode to about 2,200 characters.
export const PreviewUrl = Text.max(2600).regex(/^\/preview\/[A-Za-z0-9_-]{43}\/[^?#\s\\]+$/);
export const PreviewOpened = z.object({ frameUrl: PreviewUrl, expiresAt: z.iso.datetime() }).strict();
export type PreviewOpened = z.infer<typeof PreviewOpened>;
export const TextFile = z.object({ text: Text.max(8_000_000) }).strict();
