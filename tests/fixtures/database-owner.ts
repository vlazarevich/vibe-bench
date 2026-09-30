import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startDatabase } from '../../scripts/local-database.ts';

const directory = process.argv[2];
if (!directory) throw new Error('Missing database directory');
const database = await startDatabase(directory);
await writeFile(join(directory, 'owner-ready.json'), JSON.stringify({ url: database.url }));
setInterval(() => {}, 1000);
process.once('SIGTERM', () => { void database.stop().then(() => process.exit()); });
