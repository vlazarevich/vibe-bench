import { useEffect, useState } from 'react';
import { ResultPresentation, TextFile, type FileView } from '../../../packages/contracts/src/artifact-viewer.ts';
import { HtmlResultPreview } from './html-result-preview.tsx';
import './result-viewer.css';

function TextResult({ url, diff = false }: { url: string; diff?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setText(null); setFailed(false);
    void fetch(url, { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(); setText(TextFile.parse(await response.json()).text); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url]);
  if (failed) return <p role="status">The text preview is unavailable. Download the original file.</p>;
  if (text === null) return <p role="status">Loading text…</p>;
  return <pre className="result-text">{diff ? text.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : undefined}>{line}{'\n'}</span>) : text}</pre>;
}
function ResultFile({ file, diff = false }: { file: FileView; diff?: boolean }) {
  return <section className="result-file" aria-label={file.download.name}>
    {file.kind === 'text' ? <TextResult url={file.textUrl} diff={diff}/> : file.kind === 'image' ? <img className="result-image" src={file.imageUrl} alt={file.download.name}/> : <p role="status">{file.reason}</p>}
    <a href={file.download.url} download>{file.download.name} ({file.download.bytes.toLocaleString()} bytes)</a>
  </section>;
}
function CodeResult({ result }: { result: Extract<ResultPresentation, { kind: 'code' }> }) {
  const [selected, setSelected] = useState(result.files[0]?.path ?? '');
  const file = result.files.find((file) => file.path === selected);
  const directories = new Map<string, typeof result.files>();
  for (const file of result.files) {
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    const files = directories.get(directory) ?? []; files.push(file); directories.set(directory, files);
  }
  return <>
    <div className="result-code"><nav aria-label="Changed files">{[...directories].map(([directory, files]) => <section key={directory}><strong>{directory === '.' ? 'Root' : directory}</strong><ul>{files.map((file) => <li key={file.path}><button type="button" aria-pressed={selected === file.path} onClick={() => setSelected(file.path)}>{file.path.split('/').at(-1)} · {file.change}</button></li>)}</ul></section>)}</nav>
      <section aria-label="Selected file">{file && <><h4>{file.path}</h4>{file.content ? <ResultFile file={file.content}/> : <p>{file.change === 'deleted' ? 'Deleted file. See the patch below for removed content.' : 'Final file bytes were not saved. See the patch below.'}</p>}</>}</section>
    </div><section aria-label="Unified diff"><h4>Patch</h4><ResultFile file={result.patch} diff/></section>
  </>;
}
export function ResultViewer({ result }: { result: ResultPresentation }) {
  let primary;
  switch (result.kind) {
    case 'text': primary = <><pre className="result-text">{result.text}</pre>{result.download && <a href={result.download.url} download>Download answer</a>}</>; break;
    case 'image': primary = result.images.map((file) => <ResultFile key={file.download.url} file={file}/>); break;
    case 'code': primary = <CodeResult result={result}/>; break;
    case 'html': primary = <>{result.preview.kind === 'interactive' ? <HtmlResultPreview sessionUrl={result.preview.sessionUrl}/> : <p role="status">{result.preview.reason}</p>}<details><summary>HTML source</summary><ResultFile file={result.source}/></details></>; break;
    case 'browser': primary = <>{result.recording.kind === 'video' ? <video className="result-video" controls preload="metadata" src={result.recording.videoUrl} aria-label="Browser recording"/> : <p role="status">{result.recording.reason}</p>}<p><a href={result.recording.download.url} download>Download recording</a></p>{result.screenshots.map((file) => <ResultFile key={file.download.url} file={file}/>)}</>; break;
  }
  return <section className="result-viewer" aria-label="Result preview">{primary}{result.outputs.length > 0 && <section aria-label="Declared outputs"><h4>Output files</h4>{result.outputs.map((file) => <ResultFile key={file.download.url} file={file}/>)}</section>}</section>;
}
function RequestedResultViewer({ resultUrl }: { resultUrl: string }) {
  const [result, setResult] = useState<ResultPresentation | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setFailed(false);
    void fetch(resultUrl, { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(); setResult(ResultPresentation.parse(await response.json())); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [resultUrl]);
  return result ? <ResultViewer result={result}/> : <p role="status">{failed ? 'Result preview is unavailable. The original downloads remain available.' : 'Loading result…'}</p>;
}

export function AttemptResultViewer({ resultUrl }: { resultUrl: string }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>View result</summary>{open && <RequestedResultViewer resultUrl={resultUrl}/>}</details>;
}
