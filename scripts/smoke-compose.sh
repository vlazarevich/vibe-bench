#!/bin/sh
# Builds the image and checks the compose deployment end to end: PostgreSQL, migrations, password
# login, the container health check, and persistence across a dashboard restart. Removes everything after.
# Set VIBE_SMOKE_IMAGE=name:tag to test an already built image instead of building one.
set -eu
cd "$(dirname "$0")/../deploy/docker"
export COMPOSE_PROJECT_NAME=vibe-bench-smoke VIBE_IMAGE=vibe-bench-smoke VIBE_VERSION=local
build=--build
if [ -n "${VIBE_SMOKE_IMAGE:-}" ]; then
  VIBE_IMAGE=${VIBE_SMOKE_IMAGE%:*} VIBE_VERSION=${VIBE_SMOKE_IMAGE##*:} build=--no-build
fi
export POSTGRES_PASSWORD="smoke-$(od -An -N8 -tx8 /dev/urandom | tr -d ' ')" VIBE_APP_PASSWORD=' smoke password '
export VIBE_HTTP_PORT="${VIBE_SMOKE_PORT:-18080}" VIBE_DOCKER_SUBNET=172.31.251.0/24 VIBE_CADDY_ADDRESS=172.31.251.10
base="http://127.0.0.1:$VIBE_HTTP_PORT"
cleanup() { docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
fail() { printf 'smoke: %s\n' "$*" >&2; docker compose logs --no-color dashboard >&2 || true; exit 1; }
docker compose up --detach $build --wait --wait-timeout 240 || fail 'services did not become healthy'
[ "$(curl -fsS "$base/api/health")" = '{"ok":true}' ] || fail 'health check failed'
curl -fsS "$base/api/access/session" | grep -q '"passwordRequired":true' || fail 'password mode is not active'
login() { curl -sS -o /dev/null -w '%{http_code}' -H "Origin: $base" -H 'content-type: application/json' --data "{\"password\":\"$1\"}" "$base/api/access/login"; }
[ "$(login 'wrong')" = 401 ] || fail 'a wrong password was accepted'
[ "$(login 'smoke password')" = 200 ] || fail 'the trimmed password was rejected'
[ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q dashboard)")" = healthy ] || fail 'container health is not healthy'
docker compose exec -T postgres psql -U vibe -d vibe -tAc 'SELECT count(*) FROM schema_migrations' | grep -qx '11' || fail 'migrations are incomplete'
docker compose restart dashboard >/dev/null
docker compose up --detach --wait --wait-timeout 120 dashboard || fail 'dashboard did not recover after restart'
[ "$(login 'smoke password')" = 200 ] || fail 'login failed after restart'
printf 'smoke: compose deployment passed\n'
