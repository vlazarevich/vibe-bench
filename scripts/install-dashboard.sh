#!/bin/sh
set -eu

install_dashboard() {
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail 'Only Linux x64 is supported.'
  command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'The dashboard requires glibc. musl is not supported.'
  for tool in curl tar sha256sum mktemp awk realpath find head; do command -v "$tool" >/dev/null 2>&1 || fail "Required command is missing: $tool"; done
  command -v node >/dev/null 2>&1 || fail 'Node 24 is required. Install it, then run the installer again.'
  [ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || fail "Node 24 is required; found $(node --version)."
  version=${VIBE_DASHBOARD_VERSION:-}
  repository=${VIBE_REPOSITORY:-vlazarevich/vibe-bench}
  printf '%s\n' "$repository" | awk '/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ { valid = 1 } END { exit !valid }' || fail 'VIBE_REPOSITORY must look like owner/name.'
  if [ -z "$version" ]; then
    release_url=$(curl --proto '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repository/releases/latest")
    version=${release_url##*/}
  fi
  printf '%s\n' "$version" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/ { valid = 1 } END { exit !valid }' || fail 'Set VIBE_DASHBOARD_VERSION to a release tag such as v1.2.3.'
  if [ "$(id -u)" = 0 ]; then
    default_dir=/opt/vibe-bench default_state=/var/lib/vibe-bench
  else
    default_dir="$HOME/.local/share/vibe-bench" default_state="${XDG_STATE_HOME:-$HOME/.local/state}/vibe-bench"
  fi
  install_dir=${VIBE_DASHBOARD_INSTALL_DIR:-$default_dir}
  state_dir=${VIBE_DASHBOARD_STATE_DIR:-$default_state}
  [ -n "$install_dir" ] && [ -n "$state_dir" ] || fail 'The installation and state directories must not be empty.'
  parent=$(dirname "$install_dir")
  mkdir -p "$parent"
  parent=$(cd "$parent" && pwd -P)
  install_dir="$parent/$(basename "$install_dir")"
  case "$state_dir" in /*) ;; *) fail 'VIBE_DASHBOARD_STATE_DIR must be an absolute path.';; esac
  case "$state_dir" in *'"'* | *'\'* | *'
'*) fail 'VIBE_DASHBOARD_STATE_DIR must not contain quotes, backslashes, or newlines.';; esac
  # Compare canonical paths so a symlinked spelling cannot place state inside the installation.
  canonical_state=$(realpath -m -- "$state_dir")
  case "$canonical_state/" in "$install_dir"/*) fail 'The state directory must be outside the installation, which upgrades replace.';; esac
  # Recover from an upgrade interrupted between its two moves: the previous installation is complete.
  if [ ! -e "$install_dir" ] && [ -d "$install_dir.previous" ]; then mv "$install_dir.previous" "$install_dir"; fi
  if [ -e "$install_dir" ]; then
    # Only a previous release install is replaced; a source checkout or other directory is left alone.
    [ -f "$install_dir/VERSION" ] && [ -f "$install_dir/dist/server/serve.mjs" ] && [ ! -e "$install_dir/.git" ] || fail "$install_dir exists and is not a Vibe bench dashboard installation."
    # Upgrades replace the whole directory, so any PostgreSQL data inside it would be deleted.
    database=$(find "$install_dir" -path "$install_dir/node_modules" -prune -o -name PG_VERSION -print | head -n 1)
    [ -z "$database" ] || fail "Database state was found inside the installation at $(dirname "$database"). Stop the dashboard, move its state directory outside the installation, set VIBE_LOCAL_ROOT to it in .env, then run the installer again."
  fi
  temporary=$(mktemp -d "$parent/.vibe-bench-dashboard.XXXXXXXX")
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  archive="vibe-bench-dashboard-$version-linux-x64.tar.gz"
  base="https://github.com/$repository/releases/download/$version"
  curl --proto '=https' --tlsv1.2 -fsSL "$base/$archive" -o "$temporary/$archive"
  curl --proto '=https' --tlsv1.2 -fsSL "$base/SHA256SUMS" -o "$temporary/SHA256SUMS"
  awk -v archive="$archive" '$2 == archive { print; found++ } END { if (found != 1) exit 1 }' "$temporary/SHA256SUMS" > "$temporary/archive.sha256" || fail 'Missing or duplicate archive checksum.'
  (cd "$temporary" && sha256sum --check --quiet archive.sha256) || fail 'Release checksum verification failed.'
  tar -tzf "$temporary/$archive" | awk '$0 !~ /^vibe-bench-dashboard(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 } END { exit bad }' || fail 'The release archive contains unexpected paths.'
  tar -xzf "$temporary/$archive" --no-same-owner -C "$temporary"
  staged="$temporary/vibe-bench-dashboard"
  [ "$(cat "$staged/VERSION")" = "$version" ] || fail 'The archive version does not match the release tag.'
  [ -f "$staged/dist/server/serve.mjs" ] || fail 'The release does not contain the dashboard server.'
  # Settings carry over between versions. A first install points embedded state outside the installation.
  if [ -f "$install_dir/.env" ]; then
    cp -p "$install_dir/.env" "$staged/.env"
  else
    {
      printf '# Created by install-dashboard.sh. .env.example lists every setting.\n'
      printf 'VIBE_LOCAL_ROOT="%s"\n' "$state_dir"
      printf 'VIBE_PORT=8080\n'
      printf '# VIBE_APP_PASSWORD=replace-with-a-long-random-secret\n'
    } > "$staged/.env"
    chmod 600 "$staged/.env"
  fi
  upgraded=
  if [ -e "$install_dir" ]; then
    rm -rf "$install_dir.previous"
    mv "$install_dir" "$install_dir.previous"
    upgraded=1
  fi
  if ! mv "$staged" "$install_dir"; then
    if [ -n "$upgraded" ]; then
      mv "$install_dir.previous" "$install_dir" || fail "Installation failed and the previous version remains at $install_dir.previous. Move it back to $install_dir."
    fi
    fail 'Installation failed; the previous version is unchanged.'
  fi
  rm -rf "$install_dir.previous"
  printf 'Installed dashboard %s to %s\n' "$version" "$install_dir"
  if [ -n "$upgraded" ]; then
    printf 'Restart the running dashboard or service to use the new version.\n'
  elif [ "$(id -u)" = 0 ]; then
    # Embedded PostgreSQL refuses to run as root, so a root install runs as the systemd service.
    printf 'Set VIBE_APP_PASSWORD in %s/.env, which the service reads, then follow docs/deployment.md to install\n' "$install_dir"
    printf '%s/deploy/systemd/vibe-bench.service and start it.\n' "$install_dir"
  else
    printf 'Edit %s/.env (set VIBE_APP_PASSWORD before exposing it), then start it with:\n  cd %s && node --env-file-if-exists=.env dist/server/serve.mjs\n' "$install_dir" "$install_dir"
    printf 'For a system service, see %s/deploy/systemd/vibe-bench.service.\n' "$install_dir"
  fi
}

install_dashboard
