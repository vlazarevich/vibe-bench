import { z } from 'zod';
import { Text } from './text.ts';

const LocalUrl = Text.max(2000).regex(/^\/(?!\/)[a-zA-Z0-9/_-]+$/);
const Download = z.object({ url: LocalUrl, name: Text.max(500), bytes: z.number().int().min(0).max(8_000_000) }).strict();
export const FileView = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), textUrl: LocalUrl, download: Download }).strict(),
  z.object({ kind: z.literal('image'), imageUrl: LocalUrl, download: Download }).strict(),
  z.object({ kind: z.literal('unsupported'), reason: Text.max(500), download: Download }).strict(),
]);
export type FileView = z.infer<typeof FileView>;
const outputs = z.array(FileView).max(32);
export const ResultPresentation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: Text.max(8_000_000), download: Download.nullable(), outputs }).strict(),
  z.object({ kind: z.literal('image'), images: z.array(FileView).max(32), outputs }).strict(),
  z.object({ kind: z.literal('code'), patch: FileView, files: z.array(z.object({ path: Text.max(500), change: z.enum(['added', 'modified', 'deleted']), content: FileView.nullable() }).strict()).max(1000), outputs }).strict(),
  z.object({ kind: z.literal('html'), preview: z.discriminatedUnion('kind', [z.object({ kind: z.literal('interactive'), sessionUrl: LocalUrl }).strict(), z.object({ kind: z.literal('unavailable'), reason: Text.max(500) }).strict()]), source: FileView, outputs }).strict(),
  z.object({ kind: z.literal('browser'), recording: z.discriminatedUnion('kind', [z.object({ kind: z.literal('video'), videoUrl: LocalUrl, download: Download }).strict(), z.object({ kind: z.literal('unsupported'), reason: Text.max(500), download: Download }).strict()]), screenshots: z.array(FileView).max(31), outputs }).strict(),
]);
export type ResultPresentation = z.infer<typeof ResultPresentation>;
export const PreviewInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refresh') }).strict(),
  z.object({ kind: z.literal('click'), x: z.number().int().min(0).max(959), y: z.number().int().min(0).max(639) }).strict(),
  z.object({ kind: z.literal('type'), text: Text.min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space']) }).strict(),
  z.object({ kind: z.literal('scroll'), deltaX: z.number().int().min(-2000).max(2000), deltaY: z.number().int().min(-2000).max(2000) }).strict(),
]);
export type PreviewInput = z.infer<typeof PreviewInput>;
export const PreviewFrame = z.object({ png: Text.max(6_000_000).regex(/^[A-Za-z0-9+/]+=*$/), blockedRequests: z.number().int().nonnegative() }).strict();
export type PreviewFrame = z.infer<typeof PreviewFrame>;
export const PreviewOpened = z.object({ previewId: z.uuid(), frame: PreviewFrame }).strict();
export const TextFile = z.object({ text: Text.max(8_000_000) }).strict();
