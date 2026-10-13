import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import './design-system/fonts.css';
import './design-system/tokens.css';
import './design-system/components.css';
import './style.css';
import { Sidebar, type SidebarItem } from './design-system';
import { Access } from './access.tsx';
import { Runtimes } from './runtimes.tsx';
import { Suites } from './suites.tsx';
import { BlindGrading } from './blind-grading.tsx';
import { ConfiguredRuns } from './configured-runs.tsx';
import { Results } from './results.tsx';
const nav: SidebarItem[] = [
  { id: 'suites', label: 'Suites', icon: 'nav-suites', href: '/?view=suites' },
  { id: 'runtimes', label: 'Runtimes', icon: 'runtime', href: '/?view=runtimes' },
  { id: 'runs', label: 'Runs', icon: 'nav-runs', href: '/?view=runs' },
  { id: 'results', label: 'Results', icon: 'nav-reports', href: '/?view=results' },
];
function App() {
  const params = new URLSearchParams(location.search),
    view = params.get('view') ?? 'runs';
  const focused = view === 'grading' && (params.has('review') || params.has('shared'));
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('vb-theme') === 'dark' ? 'dark' : 'light',
  );
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('vb-sidebar') === 'collapsed');
  document.documentElement.dataset.theme = theme;
  return (
    <div className="app-shell">
      {!focused && (
        <Sidebar
          items={nav}
          currentId={view === 'grading' ? 'runs' : view}
          theme={theme}
          onThemeChange={(value) => {
            setTheme(value);
            localStorage.setItem('vb-theme', value);
          }}
          collapsed={params.has('grading') || collapsed}
          onCollapsedChange={(value) => {
            setCollapsed(value);
            localStorage.setItem('vb-sidebar', value ? 'collapsed' : 'expanded');
          }}
        />
      )}
      <main className={view === 'results' ? 'app-main results-main' : 'app-main'}>
        {view === 'runtimes' ? (
          <Runtimes />
        ) : view === 'grading' ? (
          <BlindGrading />
        ) : view === 'suites' ? (
          <Suites />
        ) : view === 'results' ? (
          <Results />
        ) : (
          <ConfiguredRuns />
        )}
      </main>
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <Access>
    <App />
  </Access>,
);
