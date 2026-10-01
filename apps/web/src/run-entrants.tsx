import { EntrantId } from '../../../packages/contracts/src/configured-runs.ts';

export type EntrantDraft = { id: string; harness: 'codex' | 'claude' | 'opencode'; model: string; timeout: string; effort: string };
export const newEntrant = (): EntrantDraft => ({ id: EntrantId.parse(crypto.randomUUID()), harness: 'codex', model: '', timeout: '120', effort: '' });

export function RunEntrants({ entrants, onChange, disabled }: { entrants: EntrantDraft[]; onChange: (entrants: EntrantDraft[]) => void; disabled: boolean }) {
  function update(index: number, value: EntrantDraft) { onChange(entrants.map((entrant, i) => i === index ? value : entrant)); }
  return <fieldset disabled={disabled} className="run-inputs"><legend>4. Choose models</legend>
    <p className="field-help">Add each model you want to compare. You can run the same model with different settings.</p>
    {entrants.map((entrant, index) => <fieldset key={entrant.id}><legend>Model {index + 1}</legend>
      <div className="form-grid">
        <label>Runner<select value={entrant.harness} onChange={(event) => {
          const harness = event.target.value;
          if (harness === 'codex' || harness === 'claude' || harness === 'opencode') update(index, { ...entrant, harness, effort: '' });
        }}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="opencode">OpenCode</option></select></label>
        <label>Model name<input maxLength={200} placeholder={entrant.harness === 'opencode' ? 'provider/model' : 'Enter a model identifier'} value={entrant.model} onChange={(event) => update(index, { ...entrant, model: event.target.value })}/></label>
        <label>Time limit in seconds<input type="number" min="0.1" max="3600" step="0.1" value={entrant.timeout} onChange={(event) => update(index, { ...entrant, timeout: event.target.value })}/></label>
        {entrant.harness === 'opencode' ? <label>Model variant<input maxLength={100} placeholder="Provider default" value={entrant.effort} onChange={(event) => update(index, { ...entrant, effort: event.target.value })}/></label> : <label>Reasoning effort<select value={entrant.effort} onChange={(event) => update(index, { ...entrant, effort: event.target.value })}>
          <option value="">Provider default</option>{(entrant.harness === 'codex' ? ['minimal', 'low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high', 'max']).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select></label>}
      </div>
      <button type="button" className="back" onClick={() => onChange(entrants.filter((value) => value.id !== entrant.id))}>Remove model {index + 1}</button>
    </fieldset>)}
    <button type="button" className="secondary" disabled={entrants.length >= 16} onClick={() => onChange([...entrants, newEntrant()])}>Add model</button>
  </fieldset>;
}
