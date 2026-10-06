import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { resolve, delimiter } from 'node:path';
export class Unavailable extends Error {}
export async function checkExecutable(executable: string | undefined) {
  if (!executable) throw new Unavailable('Harness executable is not configured');
  const candidates = executable.includes('/') ? [resolve(executable)] : (process.env.PATH ?? '').split(delimiter).map(directory => resolve(directory || '.', executable));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  throw new Unavailable('Harness executable is not installed or executable');
}
