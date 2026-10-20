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

Each release attaches `compose.yml`, `Caddyfile`, and `compose.env.example`. The release's `compose.yml` runs PostgreSQL 18 and that release's dashboard image from `ghcr.io/vlazarevich/vibe-bench`, and adds Caddy for automatic HTTPS under the `https` profile.

```sh
mkdir vibe-bench && cd vibe-bench
base=https://github.com/vlazarevich/vibe-bench/releases/latest/download
curl -fsSLO "$base/compose.yml" && curl -fsSLO "$base/Caddyfile"
curl -fsSL -o .env "$base/compose.env.example"
# Edit .env: POSTGRES_PASSWORD from `openssl rand -hex 32`, and a long VIBE_APP_PASSWORD.
docker compose up -d
```

The database password goes into a connection URL, so avoid `/`, `#`, `?`, `%`, and `$`; a hex value is safe.

The dashboard listens on `http://127.0.0.1:8080`. Change `VIBE_BIND_ADDRESS` and `VIBE_HTTP_PORT` to expose it elsewhere.

For public HTTPS, point a DNS record at the host, open ports 80 and 443, set `VIBE_DOMAIN` in `.env`, then run `docker compose --profile https up -d`. `VIBE_PUBLIC_URL` defaults to `https://<VIBE_DOMAIN>`; Caddy refuses to start without a domain. Caddy obtains certificates and forwards to the dashboard. The dashboard trusts forwarding headers only from Caddy's fixed address (`VIBE_CADDY_ADDRESS`, default `172.31.250.10` in subnet `VIBE_DOCKER_SUBNET`).

A release's compose file pins that release's image; override it with `VIBE_VERSION`. The `latest` tag follows the repository's latest stable release. A fork publishes its own image: set `VIBE_IMAGE=ghcr.io/<owner>/<repo>`, or build locally with `docker compose up -d --build` from a checkout of `deploy/docker`.

Upgrade by downloading the new release's `compose.yml` (or setting `VIBE_VERSION`), then `docker compose pull && docker compose up -d`. Migrations run on start. Data lives in the `postgres` volume; back it up with `docker compose exec postgres pg_dump -U vibe vibe > backup.sql`.

The image also runs alone with its embedded database in the `/data` volume:

```sh
docker run -d --init --stop-timeout 60 -p 127.0.0.1:8080:8080 \
  -e VIBE_APP_PASSWORD=change-me -v vibe-bench:/data ghcr.io/vlazarevich/vibe-bench
```

`--init` reaps child processes, and the 60-second stop timeout lets embedded PostgreSQL shut down cleanly instead of recovering on the next start.

## Release archive

The archive `vibe-bench-dashboard-<version>-linux-x64.tar.gz` contains the built server and web app plus production dependencies, including embedded PostgreSQL for Linux x64. It needs Linux x64 with glibc and Node 24.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/vlazarevich/vibe-bench/releases/latest/download/install-dashboard.sh | sh
```

The installer verifies the release checksum and installs to `~/.local/share/vibe-bench`, or `/opt/vibe-bench` as root. `VIBE_DASHBOARD_VERSION` pins a version, `VIBE_DASHBOARD_INSTALL_DIR` changes the location, and `VIBE_REPOSITORY=<owner>/<repo>` installs from a fork's releases.

A first install writes `.env` beside the program with port 8080 and `VIBE_LOCAL_ROOT` pointing outside the installation: `~/.local/state/vibe-bench`, or `/var/lib/vibe-bench` as root, or `VIBE_DASHBOARD_STATE_DIR`. Reinstalling replaces the program, keeps `.env`, and refuses to proceed if database state is found inside the installation. It replaces only a previous release installation, never a source checkout. Restart the dashboard after an upgrade.

Run it directly:

```sh
cd ~/.local/share/vibe-bench
# Edit .env: set VIBE_APP_PASSWORD, and DATABASE_URL for an external database.
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

The unit listens on `127.0.0.1:8080`, keeps embedded database state in `/var/lib/vibe-bench`, and expects `node` on the system `PATH`; settings in `/etc/vibe-bench/env` override those defaults. Put a reverse proxy such as Caddy or nginx in front for HTTPS. After an upgrade, run `sudo systemctl restart vibe-bench`.

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
