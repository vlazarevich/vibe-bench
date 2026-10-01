import { z } from 'zod';
import { Text } from './text.ts';
import { TaskId } from './suites.ts';

export const SafeRelativePath = Text.min(1).max(500).refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git'), 'Use a contained relative path');
export const BrowserStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goto'), url: Text.max(2000).pipe(z.url()).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)) }).strict(),
  z.object({ kind: z.literal('click'), selector: Text.min(1).max(500) }).strict(),
  z.object({ kind: z.literal('fill'), selector: Text.min(1).max(500), value: Text.max(4000) }).strict(),
  z.object({ kind: z.literal('expect-text'), selector: Text.min(1).max(500), text: Text.min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('screenshot'), path: SafeRelativePath }).strict(),
]);
export const BrowserPlan = z.object({ steps: z.array(BrowserStep).min(1).max(100) }).strict();
export type BrowserPlan = z.infer<typeof BrowserPlan>;
export const TaskIO = z.object({ inputs: z.array(SafeRelativePath).max(32), outputs: z.array(z.object({ path: SafeRelativePath, kind: z.enum(['image', 'html', 'code', 'text']) }).strict()).max(32), browser: z.discriminatedUnion('kind', [z.object({ kind: z.literal('local'), entry: SafeRelativePath, instructions: Text.max(20_000) }).strict(), z.object({ kind: z.literal('remote'), startUrl: Text.max(2000).pipe(z.url()).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)), instructions: Text.max(20_000) }).strict()]).nullable() }).strict();
export type TaskIO = z.infer<typeof TaskIO>;
export const RepositoryManifest = z.object({ version: z.literal(1), tasks: z.record(TaskId, TaskIO) }).strict();
export type RepositoryManifest = z.infer<typeof RepositoryManifest>;
