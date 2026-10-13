import { Button, Input, Segmented } from './design-system';
import { useEffect, useRef, useState } from 'react';
import { PreviewFrame, PreviewInput, PreviewOpened } from '../../../packages/contracts/src/artifact-viewer.ts';

export function HtmlResultPreview({ sessionUrl }: { sessionUrl: string }) {
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState('desktop');
  const [text, setText] = useState('');
  const current = useRef<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    setFrame(null);
    setBusy(false);
    setError('');
    pending.current = false;
    return () => {
      generation.current++;
      if (current.current)
        void fetch(`${sessionUrl}/${current.current}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
      current.current = null;
    };
  }, [sessionUrl]);
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
      if (version !== generation.current) {
        await fetch(`${sessionUrl}/${opened.previewId}`, { method: 'DELETE' });
        return;
      }
      current.current = opened.previewId;
      setFrame(opened.frame);
    } catch {
      if (version === generation.current)
        setError('Interactive preview is unavailable. Download the source to inspect it.');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function input(action: PreviewInput) {
    if (!current.current || pending.current) return;
    const id = current.current,
      version = generation.current;
    const active = () => version === generation.current && current.current === id;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`${sessionUrl}/${id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error();
      const updated = PreviewFrame.parse(await response.json());
      if (active()) setFrame(updated);
    } catch {
      if (active()) {
        setError('The preview has expired or is unavailable. Open it again to continue.');
        current.current = null;
        setFrame(null);
      }
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function close() {
    const id = current.current;
    current.current = null;
    generation.current++;
    pending.current = false;
    setBusy(false);
    setFrame(null);
    if (id) await fetch(`${sessionUrl}/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  return (
    <section aria-label="Interactive HTML preview">
      <p className="small muted">Click the preview or use the keyboard to interact.</p>
      {error && <p role="status">{error}</p>}
      {!frame ? (
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
              onChange={(value) => {
                if (!busy) {
                  setSize(value);
                  void input({ kind: 'viewport', size: value as 'desktop' | 'tablet' | 'mobile' });
                }
              }}
              options={[
                { value: 'desktop', label: 'Desktop', icon: 'desktop' },
                { value: 'tablet', label: 'Tablet', icon: 'tablet' },
                { value: 'mobile', label: 'Mobile', icon: 'mobile' },
              ]}
            />
            <Button onClick={() => void close()}>Close interactive preview</Button>
          </div>
          <img
            className="html-preview-frame"
            src={`data:image/png;base64,${frame.png}`}
            alt="Interactive preview. Click to interact."
            role="application"
            tabIndex={0}
            onClick={(event) => {
              event.currentTarget.focus();
              const bounds = event.currentTarget.getBoundingClientRect();
              void input({
                kind: 'click',
                x: Math.max(
                  0,
                  Math.min(
                    (frame.width ?? 960) - 1,
                    Math.floor(((event.clientX - bounds.left) * (frame.width ?? 960)) / bounds.width),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    (frame.height ?? 640) - 1,
                    Math.floor(((event.clientY - bounds.top) * (frame.height ?? 640)) / bounds.height),
                  ),
                ),
              });
            }}
            onKeyDown={(event) => {
              const key = event.key === ' ' ? 'Space' : event.shiftKey && event.key === 'Tab' ? 'Shift+Tab' : event.key;
              const parsed = PreviewInput.safeParse({ kind: 'key', key });
              if (parsed.success && event.key !== 'Tab') {
                event.preventDefault();
                void input(parsed.data);
              } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                void input({ kind: 'type', text: event.key });
              }
            }}
          />
          <div className="preview-controls">
            <Input
              label="Text for focused field"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
            />
            <Button disabled={busy || !text} onClick={() => void input({ kind: 'type', text })}>
              Send text
            </Button>
            <Button disabled={busy} onClick={() => void input({ kind: 'refresh' })}>
              Refresh preview
            </Button>
            <Button disabled={busy} onClick={() => void input({ kind: 'key', key: 'Tab' })}>
              Next field
            </Button>
            <Button disabled={busy} onClick={() => void input({ kind: 'key', key: 'Enter' })}>
              Enter
            </Button>
            <Button disabled={busy} onClick={() => void input({ kind: 'scroll', deltaX: 0, deltaY: -400 })}>
              Scroll up
            </Button>
            <Button disabled={busy} onClick={() => void input({ kind: 'scroll', deltaX: 0, deltaY: 400 })}>
              Scroll down
            </Button>
          </div>
          {frame.blockedRequests > 0 && (
            <p role="status">{frame.blockedRequests} requests were blocked. Only saved local assets are available.</p>
          )}
        </>
      )}
    </section>
  );
}
