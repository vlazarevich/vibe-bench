#!/bin/sh
set -eu

install_dashboard() {
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail 'Only Linux x64 is supported.'
  command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'The dashboard requires glibc. musl is not supported.'
  for tool in curl tar sha256sum mktemp awk; do command -v "$tool" >/dev/null 2>&1 || fail "Required command is missing: $tool"; done
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
  if [ "$(id -u)" = 0 ]; then default_dir=/opt/vibe-bench; else default_dir="$HOME/.local/share/vibe-bench"; fi
  install_dir=${VIBE_DASHBOARD_INSTALL_DIR:-$default_dir}
  [ -n "$install_dir" ] || fail 'The installation directory must not be empty.'
  parent=$(dirname "$install_dir")
  mkdir -p "$parent"
  parent=$(cd "$parent" && pwd -P)
  install_dir="$parent/$(basename "$install_dir")"
  [ ! -e "$install_dir" ] || [ -f "$install_dir/dist/server/serve.mjs" ] || fail "$install_dir exists and is not a Vibe bench dashboard installation."
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
  # Settings kept beside a previous installation carry over; the database state lives elsewhere.
  if [ -f "$install_dir/.env" ]; then cp -p "$install_dir/.env" "$staged/.env"; fi
  if [ -e "$install_dir" ]; then
    rm -rf "$install_dir.previous"
    mv "$install_dir" "$install_dir.previous"
  fi
  mv "$staged" "$install_dir"
  rm -rf "$install_dir.previous"
  printf 'Installed dashboard %s to %s\n' "$version" "$install_dir"
  printf 'Configure it with %s/.env (see .env.example), then start it with:\n  cd %s && node --env-file-if-exists=.env dist/server/serve.mjs\n' "$install_dir" "$install_dir"
  printf 'For a system service, see %s/deploy/systemd/vibe-bench.service.\n' "$install_dir"
}

install_dashboard
