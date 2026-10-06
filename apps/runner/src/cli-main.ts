import { main, reportCliError } from './cli.ts';
try { await main(process.argv.slice(2)); }
catch (error) { reportCliError(error); }
