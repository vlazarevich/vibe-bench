import { useEffect, useState } from 'react';
import { z } from 'zod';
import { SuiteContent, SuiteHistory, SuiteList } from '../../../packages/contracts/src/suites.ts';
import { runRequest } from './run-request.ts';

export function RunSuite({ disabled, content, onChange }: { disabled: boolean; content: SuiteContent | null; onChange: (content: SuiteContent | null) => void }) {
  const [suites, setSuites] = useState<z.infer<typeof SuiteList>>([]);
  const [suiteId, setSuiteId] = useState('');
  const [versions, setVersions] = useState<z.infer<typeof SuiteHistory>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void runRequest('/api/suites', SuiteList).then((value) => {
      if (current) { setSuites(value); setSuiteId(value[0]?.suiteId ?? ''); setLoading(false); }
    }).catch((error: unknown) => { if (current) { setError(String(error)); setLoading(false); } });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!suiteId) return;
    let current = true;
    setLoading(true); setError('');
    void runRequest(`/api/suites/${suiteId}/history`, SuiteHistory).then((value) => {
      if (!current) return;
      const ordered = [...value].sort((a, b) => b.ordinal - a.ordinal);
      setVersions(ordered); onChange(ordered[0] ?? null); setLoading(false);
    }).catch((error: unknown) => { if (current) { setError(String(error)); setLoading(false); } });
    return () => { current = false; };
  }, [suiteId, onChange]);

  return <fieldset disabled={disabled} className="run-inputs"><legend>1. Choose a suite</legend>
    <label>Suite<select value={suiteId} onChange={(event) => { if (event.target.value !== suiteId) { onChange(null); setVersions([]); setSuiteId(event.target.value); } }}>
      <option value="">Choose a suite</option>{suites.map((suite) => <option key={suite.suiteId} value={suite.suiteId}>{suite.title || 'Untitled draft'}</option>)}
    </select></label>
    {!loading && suites.length === 0 && <p>No suites yet. <a href="/?view=suites">Create a suite</a> before starting a run.</p>}
    {versions.length > 0 && <label>Saved version<select disabled={loading} value={content?.contentId ?? ''} onChange={(event) => onChange(versions.find((version) => version.contentId === event.target.value) ?? null)}>
      {versions.map((version, index) => <option key={version.contentId} value={version.contentId}>Revision {version.revision} · Content {version.ordinal}{index === 0 ? ' · Latest' : ''}</option>)}
    </select></label>}
    <p className="field-help">The selected version and its evaluation criteria stay with the run even after you edit the suite.</p>
    {loading && <p role="status">Loading suites…</p>}{error && <p role="alert" className="error">{error}</p>}
  </fieldset>;
}
