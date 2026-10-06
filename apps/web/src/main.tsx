import { createRoot } from 'react-dom/client';
import './style.css';
import { Access } from './access.tsx';
import { Runtimes } from './runtimes.tsx';
import { Suites } from './suites.tsx';
import { BlindGrading } from './blind-grading.tsx';
import { ConfiguredRuns } from './configured-runs.tsx';

function App() {
  const view = new URLSearchParams(location.search).get('view');
  return <main>
    <header><div className="wordmark">vibe<span>bench</span></div><span className="local">CONFIGURED EXECUTION</span></header>
    <nav aria-label="Main navigation"><a href="/">Runs</a><a href="/?view=grading">Grading</a><a href="/?view=suites">Suites</a><a href="/?view=runtimes">Runtimes</a></nav>
    {view === 'runtimes' ? <Runtimes/> : view === 'grading' ? <BlindGrading/> : view === 'suites' ? <Suites/> : <ConfiguredRuns/>}
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<Access><App/></Access>);
