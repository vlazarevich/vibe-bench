import { Button, Segmented } from './design-system';
import { useEffect, useRef, useState } from 'react';
import { PreviewOpened } from '../../../packages/contracts/src/artifact-viewer.ts';

const viewports = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
type Viewport = keyof typeof viewports;

/**
 * Renders a granted HTML bundle in a sandboxed frame. The frame has an opaque origin, so its scripts cannot reach
 * dashboard cookies, storage, the API, or the parent page; server headers also deny network access and navigation.
 */
export function HtmlResultPreview({ sessionUrl }: { sessionUrl: string }) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState<Viewport>('desktop');
  const [reloads, setReloads] = useState(0);
  const [available, setAvailable] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    setFrameUrl(null);
    setBusy(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [sessionUrl]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [frameUrl]);
  async function open() {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error();
      const opened = PreviewOpened.parse(await response.json());
      if (version === generation.current) setFrameUrl(opened.frameUrl);
    } catch {
      if (version === generation.current)
        setError('Interactive preview is unavailable. Download the source to inspect it.');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const viewport = viewports[size];
  const scale = available > 0 ? Math.min(1, available / viewport.width) : 1;
  return (
    <section aria-label="Interactive HTML preview">
      <p className="small muted">The page runs in an isolated frame without network access.</p>
      {error && <p role="status">{error}</p>}
      {!frameUrl ? (
        <Button disabled={busy} onClick={() => void open()}>
          Open interactive preview
        </Button>
      ) : (
        <>
          <div className="toolbar">
            <Segmented
              label="Preview viewport"
              iconOnly
              value={size}
              onChange={(value) => setSize(value as Viewport)}
              options={[
                { value: 'desktop', label: 'Desktop', icon: 'desktop' },
                { value: 'tablet', label: 'Tablet', icon: 'tablet' },
                { value: 'mobile', label: 'Mobile', icon: 'mobile' },
              ]}
            />
            <Button onClick={() => setReloads((count) => count + 1)}>Reload preview</Button>
            <Button
              onClick={() => {
                generation.current++;
                setFrameUrl(null);
              }}
            >
              Close interactive preview
            </Button>
          </div>
          <div className="html-preview-stage" ref={stage} style={{ height: viewport.height * scale }}>
            <iframe
              key={reloads}
              className="html-preview-frame"
              title="Interactive HTML preview"
              src={frameUrl}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              width={viewport.width}
              height={viewport.height}
              style={{ transform: `scale(${scale})` }}
            />
          </div>
        </>
      )}
    </section>
  );
}
