import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Prints a fork-aware Deploy Button URL without contacting Vercel or provisioning resources. */
export function vercelDeployUrl(repository = 'vlazarevich/vibe-bench', database = 'neon') {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Use a GitHub owner/repository');
  if (!['neon', 'external'].includes(database)) throw new Error('Database must be neon or external');
  const url = new URL('https://vercel.com/new/clone');
  url.searchParams.set('repository-url', `https://github.com/${repository}`);
  url.searchParams.set('env', database === 'neon' ? 'VIBE_APP_PASSWORD' : 'VIBE_APP_PASSWORD,DATABASE_URL');
  url.searchParams.set('envDescription', 'Set a long random dashboard password. See the deployment guide for database and preview setup.');
  url.searchParams.set('envLink', `https://github.com/${repository}/blob/main/docs/vercel.md`);
  if (database === 'neon') url.searchParams.set('products', JSON.stringify([
    { type: 'integration', protocol: 'storage', productSlug: 'neon', integrationSlug: 'neon' },
  ]));
  return url.href;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(`${vercelDeployUrl(process.argv[2], process.argv[3])}\n`);
