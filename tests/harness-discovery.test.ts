import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discoverRuntime } from '../apps/runner/src/onboarding.ts';
import { RuntimeId, ToolName } from '../packages/contracts/src/runtime.ts';

let root: string;
const secret = 'credential-canary';
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(resolve('.artifacts/harness-discovery-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function discover(name: 'claude' | 'opencode', body: string) {
  const executable = join(root, name);
  await writeFile(executable, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  const selected = Object.fromEntries(ToolName.options.map((tool) => [tool, join(root, 'missing')]));
  selected[name] = executable;
  const registration = await discoverRuntime({
    runtimeId: RuntimeId.parse(randomUUID()),
    observation: 1,
    selected,
    timeoutMs: 300,
  });
  expect(JSON.stringify(registration)).not.toContain(secret);
  return registration.harnesses;
}

test('Claude SDK initialization discovers canonical IDs, deduplicates aliases, and sends no user turn', async () => {
  const log = join(root, 'claude-input.json');
  const result = await discover(
    'claude',
    `
    const fs = process.getBuiltinModule('node:fs');
    if (process.argv.includes('--version')) console.log('2.1.304');
    else if (process.argv.includes('status')) console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',token:'${secret}'}));
    else {
      const args = process.argv.slice(2);
      if (!args.includes('--safe-mode') || !args.includes('--no-session-persistence') || args[args.indexOf('--tools')+1] !== '') process.exit(2);
      process.stdin.once('data', chunk => {
        fs.writeFileSync(${JSON.stringify(log)}, chunk);
        const request = JSON.parse(chunk);
        console.log('non-JSON warning');
        console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{
          account:{token:'${secret}'},models:[
            {value:'default',resolvedModel:'claude-model-a',displayName:'Default'},
            {value:'opus',resolvedModel:'claude-model-a',displayName:'Model A',private:'${secret}'},
            {value:'claude-model-b',displayName:'Model B'}
          ]
        }}}));
      });
    }
  `,
  );
  expect(result.claude).toEqual({
    kind: 'ready',
    accountType: 'subscription',
    models: ['claude-model-a', 'claude-model-b'],
    modelDetails: [
      { id: 'claude-model-a', name: 'Model A', modalities: [] },
      { id: 'claude-model-b', name: 'Model B', modalities: [] },
    ],
  });
  expect(JSON.parse(await readFile(log, 'utf8'))).toEqual({
    type: 'control_request',
    request_id: 'models',
    request: { subtype: 'initialize', hooks: {} },
  });
});

for (const response of ['malformed', 'invalid-model', 'error', 'timeout', 'nonzero', 'output-limit']) {
  test(`Claude ${response} model discovery preserves authenticated status without inventing models`, async () => {
    const result = await discover(
      'claude',
      `
      if (process.argv.includes('--version')) console.log('2.1.304');
      else if (process.argv.includes('status')) console.log('{"loggedIn":true}');
      else {
        if (${JSON.stringify(response)} === 'timeout') setInterval(()=>{},1000);
        else if (${JSON.stringify(response)} === 'nonzero') process.exit(2);
        else if (${JSON.stringify(response)} === 'output-limit') console.log('x'.repeat(900000));
        else console.log(${JSON.stringify(response)} === 'malformed' ? 'not JSON' : JSON.stringify({type:'control_response',response:{subtype:${JSON.stringify(response)} === 'error' ? 'error' : 'success',request_id:'models',response:{models:[{value:'unsafe model',displayName:'Invalid'}]}}}));
      }
    `,
    );
    expect(result.claude).toEqual({ kind: 'ready' });
  });
}

function v2({
  method = 'oauth',
  connections = true,
  provider = true,
  status = false,
  malformed = false,
  modelsFail = false,
} = {}) {
  return `
    if (process.argv.includes('--version')) console.log('opencode v2.0.32');
    else if (process.argv.includes('integration.list')) console.log(${malformed} ? '{}' : JSON.stringify({data:[{id:'opencode',connections:${connections} ? [{type:'credential',method:${JSON.stringify(method)},label:'${secret}',...(${status} ? {status:{status:'needs_auth'}} : {})}] : []}]}));
    else if (process.argv.includes('provider.list')) console.log(JSON.stringify({data:${provider} ? [{id:'opencode-go',integrationID:'opencode'}] : [{id:'other',integrationID:'opencode'}]}));
    else if (process.argv.includes('models')) {
      if (process.argv.length !== 3 || ${modelsFail}) process.exit(2);
      console.log('opencode-go/model-a\\nopencode/model-b\\nopencode-go/model-a\\nnoise ${secret}');
    } else process.exit(2);
  `;
}
test('OpenCode v2 resolves Go through authenticated Console integration and filters the full model list', async () => {
  const result = await discover('opencode', v2());
  expect(result.opencodeGo).toEqual({
    kind: 'ready',
    accountType: 'subscription',
    models: ['opencode-go/model-a'],
  });
});
test('OpenCode v2 API-key and unknown method types retain honest account metadata', async () => {
  expect((await discover('opencode', v2({ method: 'key' }))).opencodeGo).toMatchObject({
    kind: 'ready',
    accountType: 'api-key',
  });
  expect((await discover('opencode', v2({ method: 'external', modelsFail: true }))).opencodeGo).toEqual({
    kind: 'ready',
  });
});
for (const options of [{ connections: false }, { provider: false }, { status: true }]) {
  test(`OpenCode v2 requires a usable connection for Go: ${JSON.stringify(options)}`, async () => {
    expect((await discover('opencode', v2(options))).opencodeGo).toEqual({ kind: 'not-ready' });
  });
}
test('OpenCode v2 malformed metadata and failed API probes stay unknown', async () => {
  expect((await discover('opencode', v2({ malformed: true }))).opencodeGo).toEqual({
    kind: 'unknown',
    reason: 'unrecognized',
  });
  expect(
    (
      await discover(
        'opencode',
        `if(process.argv.includes('--version'))console.log('opencode v2.0.32');else process.exit(2);`,
      )
    ).opencodeGo,
  ).toEqual({ kind: 'unknown', reason: 'failed' });
});
