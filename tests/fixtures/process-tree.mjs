import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const [pidFile, mode] = process.argv.slice(2);
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
await writeFile(pidFile, String(child.pid));
if (mode === 'exit') process.exit(0);
setInterval(() => {}, 1000);
