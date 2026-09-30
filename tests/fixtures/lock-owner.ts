import { acquireLocalLock } from '../../scripts/local-lock.ts';
const root = process.argv[2];
if (!root) throw new Error('Missing state root');
const release = await acquireLocalLock(root);
process.stdout.write('ready\n');
process.once('SIGTERM', () => { void release().then(() => process.exit(0)); });
