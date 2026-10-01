import { z } from 'zod';

export async function runRequest<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string(), issues: z.array(z.object({ message: z.string() })).optional() }).safeParse(value);
    throw new Error(error.success ? error.data.issues?.map((issue) => issue.message).join('\n') || error.data.error : 'The request failed. Please try again.');
  }
  return schema.parse(value);
}
