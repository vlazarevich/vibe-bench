# Dashboard and runtime access

`packages/contracts/src/access.ts` defines enrollment and runtime configuration. `features/access.ts` owns database sessions, credential hashes, atomic enrollment, revocation, and login throttling. Both HTTP listeners share `worker-routes.ts`.

## Dashboard authority

An optional shared app password grants full management and evaluation access. Empty or absent configuration permits passwordless operation. The login shell and static assets contain no protected data. All application APIs, result bytes, grading, and preview operations require dashboard access when the password is set. Blind grading-session cookies remain necessary for their scoped records.

Opaque 256-bit session tokens live in HttpOnly, SameSite Strict cookies. PostgreSQL stores token hashes and a fixed 12-hour expiry. Logout deletes the session. A salted scrypt password generation invalidates previous sessions after password changes, including transitions through passwordless mode. The app stores no plaintext password. HTTPS public origins add Secure to dashboard and grading cookies.

Unsafe browser methods require the canonical Origin. Local defaults accept loopback Host values. Hosted configuration pins `VIBE_PUBLIC_URL` and its Host. `VIBE_TRUSTED_PROXY` lists trusted proxy addresses for client IP attribution. Untrusted forwarding headers grant no authority. The login boundary admits at most ten attempts per source and 100 total in each 15-minute window. Expired throttle rows are removed on the next attempt.

## Runtime authority

The server owns a stable installation UUID and runtime UUIDs. **Add new** issues a ten-minute reusable enrollment token. **Replace credential** explicitly targets an existing runtime. The copyable base64url token is a secret, not encrypted content.

`vibe-runner pair TOKEN` revokes any saved pairing, discovers executable availability and authentication readiness, exchanges the token, and reports capabilities. It succeeds only after dashboard acknowledgement. An enrollment token identifies one runtime until expiry. Retrying with that token preserves its runtime identity and replaces the previous credential. Exact lost-response retries return the original exchange receipt. Expired tokens require a new token. Revoking a credential does not expire its enrollment token.

Runtime requests use `Bearer <credential-id>.<secret>`. Each worker route authenticates before reading prior receipts, compares the body runtime identity, and enforces assignment membership. Runtime authority never authorizes dashboard APIs. Revocation blocks subsequent authorization on both listeners and abandons unfinished assigned runs while preserving accepted results and completed history.

`pair status` checks authority and displays the last dashboard-acknowledged capability observation without discovery. It distinguishes unpaired, revoked or rejected, and unreachable states. `pair probe` rescans and uploads capabilities; failed delivery preserves the acknowledged snapshot. Observation sequences advance beyond the dashboard's saved sequence even after local state erasure.

`pair revoke` attempts remote revocation and clears local runner state regardless of delivery. Output distinguishes confirmed remote success from failure or an unconfirmed outcome. Failed pairing also removes all local state, including credentials and previous execution leftovers, while preserving dashboard history. Pairing and revocation refuse during execution. Status and probe remain available.

The private state directory has a standard default and a global `--state-dir` override. The runner loads no `.env` file and accepts no executable, slots, or state environment overrides. Discovery and execution resolve the same tools on `PATH`. Standard harness login directories, provider credentials, proxy, certificates, and SSH-agent behavior remain available. Dashboard credentials and raw authentication output never enter child environments or attempt workspaces.

## Durable execution

An assignment is durable before execution. Preparation, attempt starts, terminal outcomes, and artifact bytes form an immutable local journal. Collection runs independently of ordered upload. Delivery sends preparation, then each attempt's start and terminal in assignment order. Skipped attempts need no start.

The runtime retains collected records until durable acknowledgement and verifies response identities. API outages trigger progressive capped retries and do not abandon assigned work. Server-side credential revocation marks unfinished assignments abandoned and rejects further reports. Restart restores saved assignments before asking the server for new work. A started attempt with no saved outcome is uncertain and never executes again under its old ID. It receives a truthful interrupted result. No lease expiry stops work because the API is unreachable.

The release guide documents binaries and prerequisites. Authentication and fixture tests do not prove provider access or hosted deployment readiness.
