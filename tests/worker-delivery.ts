import { artifactChunks } from '../apps/runner/src/execution.ts';

export { artifactChunks };
type Identity = { protocol: number; runtimeId: string; assignmentId: string; runId: string; attemptId: string };

/** Uploads a terminal report written with inline artifacts the way vibe-runner does: chunks, then the slim report. */
export async function deliverTerminal<T, R extends Identity & { artifacts?: { id: string; base64: string }[] }>(
  post: (path: string, body: unknown) => Promise<T>,
  report: R,
) {
  const { artifacts = [], ...wire } = report;
  for (const chunk of artifactChunks(report, artifacts)) {
    const response = await post('/api/worker/artifact-chunks', chunk);
    if (response instanceof Response && !response.ok) return response;
  }
  return post('/api/worker/attempts', wire);
}
