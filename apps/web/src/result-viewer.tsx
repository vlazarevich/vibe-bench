import { useEffect, useState } from 'react';
import { ResultPresentation, TextFile, type FileView } from '../../../packages/contracts/src/artifact-viewer.ts';
import { HtmlResultPreview } from './html-result-preview.tsx';
import { Button, TextOutput, ImageOutput, CodeDiff, BrowserReplay, Segmented } from './design-system';
import './result-viewer.css';

function TextResult({ url, diff = false }: { url: string; diff?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setFailed(false);
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setText(TextFile.parse(await response.json()).text);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [url]);
  if (failed) return <p role="status">The text preview is unavailable. Download the original file.</p>;
  if (text === null) return <p role="status">Loading text…</p>;
  return diff ? (
    <CodeDiff
      files={text
        .split(/(?=^diff --git )/m)
        .filter(Boolean)
        .map((patch, i) => ({
          path: /^diff --git a\/(.+?) b\/(.+)$/m.exec(patch)?.[2] ?? `Patch ${i + 1}`,
          patch: patch.replace(/^diff --git.*\n|^index .*\n|^--- .*\n|^\+\+\+ .*\n/gm, ''),
        }))}
    />
  ) : (
    <TextOutput text={text} maxHeight={500} />
  );
}
// The server checks media headers only; the browser decodes, and a decoding failure falls back to the download.
const undecodable = 'This file cannot be previewed. Download it to inspect the original bytes.';
export function ResultFile({ file, diff = false }: { file: FileView; diff?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <section className="result-file" aria-label={file.download.name}>
      {file.kind === 'text' ? (
        <TextResult url={file.textUrl} diff={diff} />
      ) : file.kind === 'image' && !failed ? (
        <ImageOutput src={file.imageUrl} alt={file.download.name} onError={() => setFailed(true)} />
      ) : file.kind === 'image' ? (
        <p role="status">{undecodable}</p>
      ) : (
        <p role="status">{file.reason}</p>
      )}
      <a href={file.download.url} download>
        {file.download.name} ({file.download.bytes.toLocaleString()} bytes)
      </a>
    </section>
  );
}
function CodeResult({ result }: { result: Extract<ResultPresentation, { kind: 'code' }> }) {
  const [selected, setSelected] = useState(result.files[0]?.path ?? '');
  const file = result.files.find((file) => file.path === selected);
  const directories = new Map<string, typeof result.files>();
  for (const file of result.files) {
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    const files = directories.get(directory) ?? [];
    files.push(file);
    directories.set(directory, files);
  }
  return (
    <>
      {result.checks && (
        <p className={result.checks.passed === result.checks.total ? 'vb-tone-success' : 'vb-tone-danger'}>
          Tests {result.checks.passed} of {result.checks.total} passed
        </p>
      )}
      <div className="result-code">
        <nav aria-label="Changed files">
          {[...directories].map(([directory, files]) => (
            <section key={directory}>
              <strong>{directory === '.' ? 'Root' : directory}</strong>
              <ul>
                {files.map((file) => (
                  <li key={file.path}>
                    <Button aria-pressed={selected === file.path} onClick={() => setSelected(file.path)}>
                      {file.path.split('/').at(-1)} · {file.change}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <section aria-label="Selected file">
          {file && (
            <>
              <h4>{file.path}</h4>
              {file.content ? (
                <ResultFile file={file.content} />
              ) : (
                <p>
                  {file.change === 'deleted'
                    ? 'Deleted file. See the patch below for removed content.'
                    : 'Final file bytes were not saved. See the patch below.'}
                </p>
              )}
            </>
          )}
        </section>
      </div>
      <section aria-label="Unified diff">
        <h4>Patch</h4>
        <ResultFile file={result.patch} diff />
      </section>
    </>
  );
}
function TextAnswer({ result }: { result: Extract<ResultPresentation, { kind: 'text' }> }) {
  const [source, setSource] = useState<string | undefined>(),
    [mode, setMode] = useState('answer');
  const input = result.inputs?.find((file) => file.kind === 'text');
  useEffect(() => {
    const controller = new AbortController();
    setSource(undefined);
    if (input?.kind === 'text')
      void fetch(input.textUrl, { signal: controller.signal })
        .then(async (r) => {
          if (r.ok) setSource(TextFile.parse(await r.json()).text);
        })
        .catch(() => {});
    return () => controller.abort();
  }, [input]);
  return (
    <>
      {source !== undefined && (
        <Segmented
          label="Text view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'answer', label: 'Answer' },
            { value: 'changes', label: 'Show changes' },
          ]}
        />
      )}
      <TextOutput text={result.text} source={source} showChanges={mode === 'changes'} maxHeight={560} />
      {result.download && (
        <a href={result.download.url} download>
          Download answer
        </a>
      )}
    </>
  );
}
export function ResultViewer({ result, hideInputs = false }: { result: ResultPresentation; hideInputs?: boolean }) {
  const [recordingFailed, setRecordingFailed] = useState(false);
  let primary;
  switch (result.kind) {
    case 'text':
      primary = <TextAnswer result={result} />;
      break;
    case 'image':
      primary = result.images.map((file) => <ResultFile key={file.download.url} file={file} />);
      break;
    case 'code':
      primary = <CodeResult result={result} />;
      break;
    case 'html':
      primary = (
        <>
          {result.preview.kind === 'interactive' ? (
            <HtmlResultPreview sessionUrl={result.preview.sessionUrl} />
          ) : (
            <p role="status">{result.preview.reason}</p>
          )}
          <details>
            <summary>HTML source</summary>
            <ResultFile file={result.source} />
          </details>
        </>
      );
      break;
    case 'browser':
      primary = (
        <>
          {!!result.steps?.length && (
            <BrowserReplay
              steps={result.steps.map((step) => ({ ...step, shot: step.imageUrl }))}
              outcome={{ ok: true, text: 'Scenario completed' }}
            />
          )}
          {result.recording.kind === 'video' && !recordingFailed ? (
            <video
              onError={() => setRecordingFailed(true)}
              className="result-video"
              controls
              preload="metadata"
              src={result.recording.videoUrl}
              aria-label="Browser recording"
            />
          ) : (
            <p role="status">
              {result.recording.kind === 'video'
                ? 'This recording cannot be played. Download the original recording.'
                : result.recording.reason}
            </p>
          )}
          <p>
            <a href={result.recording.download.url} download>
              Download recording
            </a>
          </p>
          {result.screenshots.map((file) => (
            <ResultFile key={file.download.url} file={file} />
          ))}
        </>
      );
      break;
  }
  return (
    <section className="result-viewer" aria-label="Result preview">
      {!hideInputs && !!result.inputs?.length && (
        <details className="original-inputs">
          <summary>Original input</summary>
          {result.inputs.map((file) => (
            <ResultFile key={file.download.url} file={file} />
          ))}
        </details>
      )}
      {primary}
      {result.outputs.length > 0 && (
        <section aria-label="Declared outputs">
          <h4>Output files</h4>
          {result.outputs.map((file) => (
            <ResultFile key={file.download.url} file={file} />
          ))}
        </section>
      )}
    </section>
  );
}
export function RequestedResultViewer({ resultUrl, hideInputs = false }: { resultUrl: string; hideInputs?: boolean }) {
  const [result, setResult] = useState<ResultPresentation | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setFailed(false);
    void fetch(resultUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setResult(ResultPresentation.parse(await response.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [resultUrl]);
  return result ? (
    <ResultViewer result={result} hideInputs={hideInputs} />
  ) : (
    <p role="status">
      {failed ? 'Result preview is unavailable. The original downloads remain available.' : 'Loading result…'}
    </p>
  );
}

export function AttemptResultViewer({ resultUrl }: { resultUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>View result</summary>
      {open && <RequestedResultViewer resultUrl={resultUrl} />}
    </details>
  );
}
