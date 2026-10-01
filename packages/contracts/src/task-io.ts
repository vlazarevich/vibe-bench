import { z } from 'zod';
import { TaskId } from './suites.ts';

export const SafeRelativePath = z.string().min(1).max(500).refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git'), 'Use a contained relative path');
export const BrowserStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goto'), url: z.url().max(2000).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)) }).strict(),
  z.object({ kind: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1).max(500), value: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal('expect-text'), selector: z.string().min(1).max(500), text: z.string().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('screenshot'), path: SafeRelativePath }).strict(),
]);
export const BrowserPlan = z.object({ steps: z.array(BrowserStep).min(1).max(100) }).strict();
export type BrowserPlan = z.infer<typeof BrowserPlan>;
export const TaskIO = z.object({ inputs: z.array(SafeRelativePath).max(32), outputs: z.array(z.object({ path: SafeRelativePath, kind: z.enum(['image', 'html', 'code', 'text']) }).strict()).max(32), browser: z.discriminatedUnion('kind', [z.object({ kind: z.literal('local'), entry: SafeRelativePath, instructions: z.string().max(20_000) }).strict(), z.object({ kind: z.literal('remote'), startUrl: z.url().max(2000).refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)), instructions: z.string().max(20_000) }).strict()]).nullable() }).strict();
export type TaskIO = z.infer<typeof TaskIO>;
export const RepositoryManifest = z.object({ version: z.literal(1), tasks: z.record(TaskId, TaskIO) }).strict();
export type RepositoryManifest = z.infer<typeof RepositoryManifest>;
