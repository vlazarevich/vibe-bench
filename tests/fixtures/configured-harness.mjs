import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [harness,...args] = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(`fixture-${harness} 1\n`); process.exit(); }
const prompt = readFileSync(0,'utf8');
if (prompt.includes('FIXTURE_FAIL')) { process.stderr.write('Fixture execution failed\n'); process.exit(1); }
if (prompt.includes('FIXTURE_MALFORMED')) { process.stdout.write('{not-json'); process.exit(); }
if (prompt.includes('FIXTURE_NO_TERMINAL')) { process.stdout.write(JSON.stringify({type:'text',part:{text:'partial'}})+'\n'); process.exit(); }
const asserted = prompt.match(/ASSERT_ARGS: (.*)/);
if (asserted) for (const expected of JSON.parse(asserted[1])) { if (!args.includes(expected)) { process.stderr.write(`Missing exact argument ${expected}`); process.exit(2); } }
const match = prompt.match(/Task IO: (.*)/);
const io = match ? JSON.parse(match[1]) : {outputs:[]};
for (const input of io.inputs ?? []) { if (readFileSync(input).length === 0) throw new Error('Empty material input'); if (harness === 'codex' && !args.some((arg) => arg.endsWith(input))) throw new Error('Image was not attached'); if (harness === 'opencode' && !args.some((arg) => arg.endsWith(input))) throw new Error('Image was not attached'); }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=','base64');
for (const output of io.outputs) { mkdirSync(dirname(output.path),{recursive:true}); writeFileSync(output.path, output.kind === 'image' ? png : output.kind === 'html' ? '<!doctype html><h1>Fixture page</h1>' : output.kind === 'code' ? 'export const answer = 42;\n' : 'Fixture output'); }
const text = prompt.includes('Task kind: browser-scenario') ? JSON.stringify({steps:[{kind:'click',selector:'button'},{kind:'expect-text',selector:'#count',text:'1'}]}) : 'Fixture final answer';
if (harness === 'codex') { writeFileSync(args[args.indexOf('--output-last-message')+1],text); process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}})+'\n'); }
else if (harness === 'claude') process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:text,modelUsage:{'fixture-model':{inputTokens:10,outputTokens:5}}}));
else { process.stdout.write(JSON.stringify({type:'text',part:{text}})+'\n'+JSON.stringify({type:'step_finish',part:{reason:'stop'}})+'\n'); }
