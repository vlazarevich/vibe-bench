# Deploy on Vercel

Vercel hosts the dashboard and worker API; the Linux runner runs separately on your hardware or a VM. PostgreSQL holds all persistent state, including uploaded artifacts, login sessions and preview grants. No local disk, embedded database, server-side browser or sticky sessions are needed.

## Neon setup

Use the **Deploy with Vercel** button in the README. It clones the upstream repository into your account, requests `VIBE_APP_PASSWORD`, and offers the Neon integration. Select a Neon database in the same region as the Vercel function, with PostgreSQL 18. Use a long random password, for example `openssl rand -hex 32`. Review the Vercel and Neon plans before provisioning resources.

For a fork, import that fork directly in Vercel, with the repository root as **Root Directory**. Keep the repository's `vercel.json` settings: **Other** framework, Node 24, `pnpm install --frozen-lockfile`, and `pnpm build:vercel`. Connect Neon through the project's **Storage** tab and set `VIBE_APP_PASSWORD` before deployment. Neon supplies `DATABASE_URL` or `POSTGRES_URL`; use its pooled connection URL with TLS. No provider-specific database driver is required.

Alternatively generate a Deploy Button link for a fork:

```sh
node scripts/vercel-deploy-url.mjs owner/repository
```

The command only prints a URL. Open it to select the account, database and plan. The README button always clones the upstream repository; this command selects your fork instead.

After deployment, open the production domain listed by the project, log in with the dashboard password, and check `/api/health`. Pair a Linux runner using **Runtimes → Connect runtime**. The runner uses the same HTTPS origin and `/api/worker/` routes. Vercel deployment protection must allow the runner's requests: a protected preview URL that requires Vercel login is not a usable runner endpoint. The app password does not bypass Vercel's own deployment protection.

The [Vercel Deploy Button documentation](https://vercel.com/docs/deploy-button) describes the environment and product parameters. [Neon's managed integration guide](https://neon.com/docs/guides/vercel-managed-integration) explains storage setup, injected URLs and preview branches.

## Settings and domains

| Setting | Behavior |
| --- | --- |
| `DATABASE_URL` | External PostgreSQL URL; preferred over `POSTGRES_URL`. Required through either name. |
| `POSTGRES_URL` | Fallback injected by some Neon integrations. |
| `VIBE_APP_PASSWORD` | Required and trimmed. A hosted instance never starts passwordless. |
| `VIBE_PUBLIC_URL` | Optional HTTPS origin without a path or trailing slash. Pins a custom domain. |
| `ARTIFICIAL_ANALYSIS_API_KEY` | Optional model catalog enrichment. |

Vercel system environment variables must be exposed (the project setting **Automatically expose System Environment Variables**). Without `VIBE_PUBLIC_URL`, a production deployment uses `https://$VERCEL_PROJECT_PRODUCTION_URL`, falling back to `https://$VERCEL_URL`. Preview deployments use their own `https://$VERCEL_URL`, even though Vercel also exposes the production domain there. These variables contain hostnames without a scheme. See [Vercel's variable reference](https://vercel.com/docs/environment-variables/system-environment-variables).

The app accepts only its selected canonical Host and Origin. Open that exact URL; other aliases and individual deployment URLs can return 403 in production. Set `VIBE_PUBLIC_URL` in the **Production** environment to pin a particular custom domain, then redeploy. For previews, leave it unset or override it for the specific preview. Never derive authority from a caller's `Host` or forwarding headers.

Do not configure `VIBE_HOST`, `VIBE_PORT`, `VIBE_LOCAL_ROOT`, `VIBE_TRUSTED_PROXY`, or a separate worker listener for Vercel. The function has no listening port or local state. Forwarding headers grant no extra trust; login throttling may group clients sharing the ingress address. `VIBE_WORKER_HOST` and `VIBE_WORKER_PORT` cause a configuration error because all routes use the one function.

## Preview databases and upgrades

Give previews a separate Neon branch/database, not the production connection string. Enable Neon's preview branching if appropriate, or scope your own database URLs to the Vercel environment. A preview modifies the database it is given: migrations and writes are real. Different passwords against the same database also invalidate each other's dashboard sessions. A database branch copied from production contains production data; choose what data to copy deliberately.

Migrations run on first request to a cold function instance, under the existing transaction advisory lock. Concurrent cold starts share one initialization within the instance, and separate instances serialize migrations through PostgreSQL. The build packages migrations but makes no database connection. On Vercel, the build validates required settings; missing or invalid runtime settings return a generic 503, with a sanitized log message. A failed initialization can retry on a subsequent request.

Updates deploy from your connected repository. Back up the database before upgrading; a Vercel code rollback does not undo database migrations or application writes. Keep the database URL and dashboard password stable across instances of one installation. Prefer the pooled Neon URL for many function instances; each instance has a pool capped at eight connections. Bring-your-own databases must allow the expected aggregate connections or provide a compatible transaction pooler.

## Bring your own PostgreSQL

Import the repository without adding Neon. Set `DATABASE_URL` to an externally reachable PostgreSQL 18 database with TLS and credentials that can apply the included migrations (tables, indexes, functions and triggers). Set `VIBE_APP_PASSWORD`, then deploy. Neither a local database nor a database on a private LAN is reachable from Vercel without suitable networking.

To print a Deploy Button URL that asks for your connection string instead of provisioning Neon:

```sh
node scripts/vercel-deploy-url.mjs owner/repository external
```

## Build and verification

```sh
pnpm install --frozen-lockfile
pnpm build:vercel
pnpm exec vitest run tests/vercel.test.ts
```

`build:vercel` emits the [Build Output API](https://vercel.com/docs/build-output-api/primitives) tree under ignored `.vercel/output`. One Node 24 function includes the server, migrations and web assets; every URL routes through Fastify's access and response policies. It has response streaming enabled and a 60-second duration limit. The runner executes models elsewhere; it does not consume a long-running Vercel request.

Uploads use worker protocol 2's bounded chunks. Vercel limits incoming request bodies; large suite saves or other non-chunked requests remain subject to that limit. Streaming responses avoid buffering artifact downloads in a serverless adapter. PostgreSQL storage and response memory still bound artifact sizes. See [Vercel payload limits and streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

The local integration test builds the actual function outside the checkout, starts it through a Node HTTP adapter, and uses real PostgreSQL. It checks concurrent cold starts, migration-once behavior, password and Origin checks, shared sessions and suite persistence across fresh instances, a 6 MiB response with an exact checksum, and retry after initialization failure. These tests do not execute Vercel's routing layer, Neon TLS/pooling, the Deploy Button provisioning flow or platform response limits.

Before calling a live installation verified, check login at its canonical domain, health, runner pairing, a configured run with chunked artifacts, a download larger than 4.5 MB, image/video and interactive HTML previews, and persisted results after redeployment. Record the deployment URL and commit plus the database/provider configuration without secrets. Source CI success alone does not establish hosted deployment readiness.
