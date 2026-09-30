import { z } from 'zod';
import { onboard } from './onboarding.ts';

try {
  const config = z.object({ apiUrl: z.url(), slots: z.coerce.number().int().min(1).max(256), stateRoot: z.string().min(1) }).parse({ apiUrl: process.env.VIBE_API_URL, slots: process.env.VIBE_RUNTIME_SLOTS ?? '1', stateRoot: process.env.VIBE_RUNTIME_STATE ?? '.local/runtime-onboarding' });
  const receipt = await onboard(config);
  process.stdout.write(`Runtime ${receipt.runtimeId} observation ${receipt.observation} registered at ${receipt.receivedAt}\n`);
} catch {
  process.stderr.write('Runtime onboarding failed. Check API URL, capacity, state ownership, and worker connectivity. Saved observations can be retried.\n');
  process.exitCode = 1;
}
