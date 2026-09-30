import { z } from 'zod';

export const SessionId = z.uuid().brand<'SessionId'>();
export const Handle = z.uuid().brand<'Handle'>();
export const Choice = z.object({ handle: Handle }).strict();
const Card = z.object({ handle: Handle, text: z.string() }).strict();
const base = {
  sessionId: SessionId,
  task: z.object({ title: z.string(), prompt: z.string() }).strict(),
  source: z.enum(['fixture', 'live']),
  cards: z.tuple([Card, Card]),
};
export const Evaluation = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('blind') }).strict(),
  z.object({ ...base, kind: z.literal('revealed'), selected: Handle, identities: z.array(z.object({ handle: Handle, model: z.string(), cliVersion: z.string() }).strict()).length(2) }).strict(),
]);
export type Evaluation = z.infer<typeof Evaluation>;
export const Runs = z.array(z.object({ id: z.uuid(), title: z.string(), createdAt: z.string(), source: z.enum(['fixture', 'live']), status: z.enum(['ready', 'failed']) }).strict());
