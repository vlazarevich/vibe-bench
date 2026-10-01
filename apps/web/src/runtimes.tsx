import { useEffect, useState } from 'react';
import { z } from 'zod';
import { RegisteredRuntimes } from '../../../packages/contracts/src/runtime.ts';
import { RuntimeAccess } from '../../../packages/contracts/src/access.ts';

export function Runtimes() {
  const [runtimes, setRuntimes] = useState<z.infer<typeof RegisteredRuntimes>>([]);
  const [access, setAccess] = useState<z.infer<typeof RuntimeAccess>>([]);
  const [command, setCommand] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function refresh() {
    const [observations, credentials] = await Promise.all([fetch('/api/runtimes'), fetch('/api/runtime-access')]);
    if (!observations.ok || !credentials.ok) throw new Error('Could not load runtimes');
    setRuntimes(RegisteredRuntimes.parse(await observations.json())); setAccess(RuntimeAccess.parse(await credentials.json()));
  }
  useEffect(() => { void refresh().catch((error: unknown) => setError(String(error))); }, []);
  async function enroll(target: { kind: 'new' } | { kind: 'replace'; runtimeId: string }) {
    setError(''); setCopied(false);
    const response = await fetch('/api/runtime-enrollments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) });
    if (!response.ok) throw new Error('Could not create enrollment');
    const result = z.object({ command: z.string(), expiresAt: z.iso.datetime() }).parse(await response.json());
    setCommand(result.command); setExpiry(result.expiresAt);
  }
  return <section><h1>Runtimes</h1><p>Install the runtime, then configure it with a single-use enrollment command. Harness installation and login are managed separately.</p><button onClick={() => void enroll({ kind: 'new' }).catch((error: unknown) => setError(String(error)))}>Add new</button><button className="back" onClick={() => void refresh().catch((error: unknown) => setError(String(error)))}>Refresh runtimes</button>
    {command && <article><h2>Configure your runtime</h2><p>This command contains a secret. It expires at {new Date(expiry).toLocaleTimeString()} and creates one registration.</p><textarea aria-label="Enrollment command" readOnly value={command}/><button onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(() => setError('Select and copy the command manually.'))}>{copied ? 'Copied' : 'Copy command'}</button><p>Then run <code>vibe-runtime onboard</code> and <code>vibe-runtime work</code>.</p></article>}
    {access.map((runtime) => { const observation = runtimes.find((item) => item.registration.runtimeId === runtime.runtimeId); return <article className="run" key={runtime.runtimeId}><div><h2>{runtime.runtimeId}</h2><p>{runtime.active ? 'Credential active' : 'Credential revoked'}{observation ? ` · ${observation.registration.machine.platform} ${observation.registration.machine.architecture}` : ' · Awaiting first capability report'}</p>{observation && <p>{Object.entries(observation.registration.harnesses).map(([name, readiness]) => `${name}: ${readiness.kind}`).join(' · ')}</p>}</div><button onClick={() => void enroll({ kind: 'replace', runtimeId: runtime.runtimeId }).catch((error: unknown) => setError(String(error)))}>Replace credential</button><button disabled={!runtime.active} onClick={() => { void fetch(`/api/runtimes/${runtime.runtimeId}/revoke`, { method: 'POST' }).then(async (response) => { if (!response.ok) throw new Error('Could not revoke credential'); await refresh(); }).catch((error: unknown) => setError(String(error))); }}>Revoke</button></article>; })}
    {error && <p role="alert">{error}</p>}
  </section>;
}
