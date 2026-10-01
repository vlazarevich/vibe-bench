#!/bin/sh
set -eu

install_runtime() {
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail 'Only Linux x64 is supported.'
  command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'The runtime requires glibc. musl is not supported.'
  for tool in curl tar sha256sum mktemp awk; do command -v "$tool" >/dev/null 2>&1 || fail "Required command is missing: $tool"; done
  version=${VIBE_RUNTIME_VERSION:-}
  repository=vlazarevich/vibe-bench
  if [ -z "$version" ]; then
    release_url=$(curl --proto '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repository/releases/latest")
    version=${release_url##*/}
  fi
  printf '%s\n' "$version" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/ { valid = 1 } END { exit !valid }' || fail 'Set VIBE_RUNTIME_VERSION to a release tag such as v1.2.3.'
  install_dir=${VIBE_RUNTIME_INSTALL_DIR:-"$HOME/.local/bin"}
  [ -n "$install_dir" ] || fail 'The installation directory must not be empty.'
  mkdir -p "$install_dir"
  install_dir=$(cd "$install_dir" && pwd -P)
  [ ! -d "$install_dir/vibe-runtime" ] || fail 'The destination is a directory.'
  temporary=$(mktemp -d "$install_dir/.vibe-bench-install.XXXXXXXX")
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  archive="vibe-bench-runtime-$version-linux-x64.tar.gz"
  base="https://github.com/$repository/releases/download/$version"
  curl --proto '=https' --tlsv1.2 -fsSL "$base/$archive" -o "$temporary/$archive"
  curl --proto '=https' --tlsv1.2 -fsSL "$base/SHA256SUMS" -o "$temporary/SHA256SUMS"
  awk -v archive="$archive" '$2 == archive { print; found++ } END { if (found != 1) exit 1 }' "$temporary/SHA256SUMS" > "$temporary/archive.sha256" || fail 'Missing or duplicate archive checksum.'
  (cd "$temporary" && sha256sum --check archive.sha256) || fail 'Release checksum verification failed.'
  [ "$(tar -tzf "$temporary/$archive")" = vibe-runtime ] || fail 'The release archive contains unexpected files.'
  tar -xzf "$temporary/$archive" --no-same-owner --no-same-permissions -C "$temporary"
  [ -f "$temporary/vibe-runtime" ] && [ ! -L "$temporary/vibe-runtime" ] || fail 'The release does not contain a regular runtime executable.'
  chmod 755 "$temporary/vibe-runtime"
  [ "$("$temporary/vibe-runtime" --version)" = "$version" ] || fail 'The executable version does not match the release tag.'
  mv -f "$temporary/vibe-runtime" "$install_dir/vibe-runtime"
  printf 'Installed %s to %s/vibe-runtime\n' "$version" "$install_dir"
  printf 'Add %s to PATH, then run the configuration command from Runtimes → Add new.\n' "$install_dir"
}

install_runtime
