# Deploy the dashboard

The dashboard is one Node 24 process serving the web app, the dashboard API, and the worker API. It stores everything in PostgreSQL 18: its own embedded server by default, or an external one through `DATABASE_URL`. Runners connect outbound to it; see the [release guide](releases.md) to install them.

Choose one of these:

| Option | Database | Best for |
| --- | --- | --- |
| [Docker Compose](#docker-compose) | PostgreSQL 18 container | Any Linux host or VM with Docker |
| [Release archive](#release-archive) | Embedded or external | Hosts without Docker, with systemd |
| [Source checkout](../README.md#run-a-production-build) | Embedded or external | Development and testing |

Every option needs `VIBE_APP_PASSWORD` once the dashboard listens beyond loopback; it refuses to start otherwise. For access from other machines, set `VIBE_PUBLIC_URL` to the HTTPS address users and runners open, and terminate HTTPS in a reverse proxy that preserves the `Host` header.

## Docker Compose

Use `deploy/docker/compose.yml`. It runs PostgreSQL 18 and the dashboard image `ghcr.io/vlazarevich/vibe-bench`, and adds Caddy for automatic HTTPS under the `https` profile.

```sh
mkdir vibe-bench && cd vibe-bench
curl -fsSLO https://raw.githubusercontent.com/vlazarevich/vibe-bench/main/deploy/docker/compose.yml
curl -fsSLO https://raw.githubusercontent.com/vlazarevich/vibe-bench/main/deploy/docker/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/vlazarevich/vibe-bench/main/deploy/docker/.env.example
# Edit .env: set POSTGRES_PASSWORD and VIBE_APP_PASSWORD to long random values.
docker compose up -d
```

The dashboard listens on `http://127.0.0.1:8080`. Change `VIBE_BIND_ADDRESS` and `VIBE_HTTP_PORT` to expose it elsewhere.

For public HTTPS, point a DNS record at the host, open ports 80 and 443, set `VIBE_DOMAIN` and `VIBE_PUBLIC_URL=https://<domain>` in `.env`, then run `docker compose --profile https up -d`. Caddy obtains certificates and forwards to the dashboard. The dashboard trusts forwarding headers only from Caddy's fixed address (`VIBE_CADDY_ADDRESS`, default `172.31.250.10` in subnet `VIBE_DOCKER_SUBNET`).

Pin a version with `VIBE_VERSION=v0.1.0`; `latest` follows the newest stable release. A fork publishes its own image: set `VIBE_IMAGE=ghcr.io/<owner>/<repo>`, or build locally with `docker compose up -d --build` from a checkout.

Upgrade with `docker compose pull && docker compose up -d`. Migrations run on start. Data lives in the `postgres` volume; back it up with `docker compose exec postgres pg_dump -U vibe vibe > backup.sql`.

The image also runs alone with its embedded database in the `/data` volume:

```sh
docker run -d -p 127.0.0.1:8080:8080 -e VIBE_APP_PASSWORD=change-me -v vibe-bench:/data ghcr.io/vlazarevich/vibe-bench
```

## Release archive

The archive `vibe-bench-dashboard-<version>-linux-x64.tar.gz` contains the built server and web app plus production dependencies, including embedded PostgreSQL for Linux x64. It needs Linux x64 with glibc and Node 24.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/vlazarevich/vibe-bench/releases/latest/download/install-dashboard.sh | sh
```

The installer verifies the release checksum and installs to `~/.local/share/vibe-bench`, or `/opt/vibe-bench` as root. `VIBE_DASHBOARD_VERSION` pins a version, `VIBE_DASHBOARD_INSTALL_DIR` changes the location, and `VIBE_REPOSITORY=<owner>/<repo>` installs from a fork's releases. Reinstalling replaces the program and keeps the `.env` beside it. Data lives in `VIBE_LOCAL_ROOT` or the external database, never inside the installation.

Run it directly:

```sh
cd ~/.local/share/vibe-bench
cp .env.example .env    # set VIBE_APP_PASSWORD, and DATABASE_URL for an external database
node --env-file-if-exists=.env dist/server/serve.mjs
```

Or as a systemd service from `/opt/vibe-bench`:

```sh
sudo useradd --system --home /var/lib/vibe-bench --shell /usr/sbin/nologin vibe-bench
sudo install -d -m 0750 /etc/vibe-bench
sudo cp /opt/vibe-bench/.env.example /etc/vibe-bench/env    # edit it; keep it readable only by root
sudo cp /opt/vibe-bench/deploy/systemd/vibe-bench.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now vibe-bench
```

The unit keeps embedded database state in `/var/lib/vibe-bench` and expects `node` on the system `PATH`. Put a reverse proxy such as Caddy or nginx in front for HTTPS.

## Settings

| Variable | Meaning |
| --- | --- |
| `VIBE_APP_PASSWORD` | Shared dashboard password. Required for a non-loopback `VIBE_HOST`. |
| `VIBE_PUBLIC_URL` | Public origin, such as `https://bench.example.com`. Required for remote browsers. |
| `VIBE_TRUSTED_PROXY` | Comma-separated proxy addresses or CIDRs trusted for client IPs. |
| `DATABASE_URL` | External PostgreSQL 18. `POSTGRES_URL` is accepted too. Unset means embedded. |
| `VIBE_LOCAL_ROOT` | Embedded database state directory. |
| `VIBE_HOST`, `VIBE_PORT` | Listener address and port. `::1` binds IPv6 loopback, but browsers then need `VIBE_PUBLIC_URL`. |
| `VIBE_WORKER_HOST`, `VIBE_WORKER_PORT` | Optional worker-only listener. |
| `ARTIFICIAL_ANALYSIS_API_KEY` | Optional model catalog enrichment. |

`GET /api/health` returns 200 once the database and listener are ready, under any `Host`, for container and load-balancer probes.
