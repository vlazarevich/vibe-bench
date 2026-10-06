# Release the runtime

Use this procedure to produce a Linux x64 glibc runtime and publish it on GitHub. The runtime includes Node and its JavaScript dependencies. Users do not need a source checkout, Node, or pnpm to run it.

## Prepare a release

1. Merge the reviewed change after the required checks pass. Release tags must point to a commit already on `main`.
2. Update your local branch.

   ```sh
   git switch main
   git pull --ff-only
   ```

3. Choose an unused version such as `v0.1.0`. Use `v0.1.0-rc.1` for a prerelease.
4. Create and push the tag.

   ```sh
   git tag -a v0.1.0 -m 'Runtime v0.1.0'
   git push origin v0.1.0
   ```

5. Open **Actions → runtime release** on GitHub. Wait for both jobs to pass.
6. Open **Releases** and inspect the draft. Check the generated notes and the three attached assets.
7. Publish the draft when you are ready to make that version installable.

The verification job runs the full application checks, compiles the runtime, and tests the executable. Only that job's verified assets reach the draft job. The draft job has release-write permission. Verification has read-only permission. Publishing the draft is a separate operator action.

A release contains the archive `vibe-runner-v0.1.0-linux-x64.tar.gz`, the installer `install-runtime.sh`, and `SHA256SUMS`. The executable reports the tag through `--version`. The workflow does not change `package.json` to stamp a release.

## Retry a failed release

If verification fails, fix the code through a reviewed PR and choose a new version tag. Do not move an existing tag to another commit.

If verification passed but draft creation or asset upload failed, rerun the failed jobs. The workflow can replace assets on an unpublished draft. It refuses to replace a published release. Review all three assets before publishing a retried draft.

If you need to withdraw a bad version, mark its release as a prerelease or remove its latest-release designation in GitHub. Publish a corrected version. Existing installations keep their installed executable until their operator runs the installer again.

## Build and check locally

Use Linux x64 glibc, Node 24.21.0, pnpm 11.22.0, and the prerequisites in [verification](verification.md).

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm build:runtime v0.0.0-dev
pnpm test:binary
```

Find the executable and release assets under `dist/runtime/`. The build uses Node's single-executable application support. It embeds a compressed bundle and the pinned Playwright library. Each invocation extracts those files into a fresh private temporary directory and removes them on normal exit. A killed process can leave its temporary directory behind. Runtime credentials and saved results use the configured state directory, independently of these temporary dependency files.

## Install a published release

The default installer downloads the latest published stable release. Draft releases are unavailable to the installer.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/vlazarevich/vibe-bench/releases/latest/download/install-runtime.sh | sh
```

To pin a version and installation directory, put the environment variables on the shell side of the pipe.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/vlazarevich/vibe-bench/releases/download/v0.1.0/install-runtime.sh |
  VIBE_RUNTIME_VERSION=v0.1.0 VIBE_RUNTIME_INSTALL_DIR="$HOME/.local/bin" sh
```

The installer verifies the archive against that release's SHA-256 checksum, runs the executable's version command, then replaces the installed executable. A failed download, checksum mismatch, or invalid archive leaves the previous executable intact. The default destination is `~/.local/bin/vibe-runner`. Add `~/.local/bin` to `PATH` if necessary.

Pair after installation. Copy the command from **Runtimes → Add new**, then run `vibe-runner run` or `vibe-runner run-once`. The installer does not enroll the runtime, install Codex, Claude Code, or OpenCode, or perform their login flows. Install and authenticate those tools separately before pairing or probing readiness.

Linux x64 with glibc 2.28 or newer is the only published target. Git is needed for repository tasks. Browser and image tasks require the Chromium and FFmpeg revisions used by Playwright 1.56.1, plus their system libraries. On a machine with Node available for provisioning, `npx playwright@1.56.1 install --with-deps chromium` installs those prerequisites. Provisioning browsers is separate from runtime installation. A provisioned machine does not need Node afterward. Preserve the Playwright browser cache, or set `PLAYWRIGHT_BROWSERS_PATH` to its provisioned location.

The runtime binary is independent of the server deployment. Releasing it does not deploy the dashboard, run database migrations, or configure HTTPS and backups.
