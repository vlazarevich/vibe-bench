import { main } from './cli.ts';
try { await main(['onboard', ...process.argv.slice(2)]); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Runtime onboarding failed'}\n`); process.exitCode = 1; }
