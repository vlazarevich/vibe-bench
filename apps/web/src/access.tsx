import { useEffect, useState, type ReactNode } from 'react';
import { SessionStatus } from '../../../packages/contracts/src/access.ts';

export function Access({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ReturnType<typeof SessionStatus.parse> | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/access/session').then((response) => response.json()).then((data: unknown) => setSession(SessionStatus.parse(data))).catch(() => setError('Could not check dashboard access. Reload to retry.')); }, []);
  if (!session) return <main><p role="status">Checking dashboard access…</p>{error && <p role="alert">{error}</p>}</main>;
  if (!session.authenticated) return <main><h1>Sign in to Vibe bench</h1><p>Enter the shared app password to access this installation.</p><form onSubmit={(event) => {
    event.preventDefault(); setError('');
    void fetch('/api/access/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'Password was not accepted.');
      setSession(SessionStatus.parse(await response.json())); setPassword('');
    }).catch((error: unknown) => setError(error instanceof Error ? error.message : 'Sign in failed.'));
  }}><label>App password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label><button type="submit">Sign in</button></form>{error && <p role="alert">{error}</p>}</main>;
  return <>{session.passwordRequired && <button className="back" onClick={() => { void fetch('/api/access/logout', { method: 'POST' }).then((response) => { if (!response.ok) throw new Error('Logout failed'); location.assign('/login'); }).catch(() => setError('Logout failed. Retry.')); }}>Log out</button>}{error && <p role="alert">{error}</p>}{children}</>;
}
