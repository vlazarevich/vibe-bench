import { connectDatabase } from '../apps/server/src/db.ts';
import { dashboardConfig } from './dashboard-config.ts';

const config = dashboardConfig();
if (config.database.kind !== 'external') throw new Error('Set DATABASE_URL to migrate an external database; embedded databases migrate on startup');
const pool = await connectDatabase(config.database.url);
await pool.end();
process.stdout.write('Database migrations are current.\n');
