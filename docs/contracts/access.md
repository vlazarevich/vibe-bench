# Dashboard and runtime access

`packages/contracts/src/access.ts` defines enrollment and runtime configuration. `features/access.ts` owns database sessions, credential hashes, atomic enrollment, revocation, and login throttling. Both HTTP listeners share `worker-routes.ts`.

## Dashboard authority

An optional shared app password grants full management and evaluation access. Empty or absent configuration permits passwordless operation. The login shell and static assets contain no protected data. All application APIs, result bytes, grading, and preview operations require dashboard access when the password is set. Existing evaluation-session cookies remain necessary for their scoped records.

Opaque 256-bit session tokens live in HttpOnly, SameSite Strict cookies. PostgreSQL stores token hashes and a fixed 12-hour expiry. Logout deletes the session. A salted scrypt password generation invalidates previous sessions after password changes, including transitions through passwordless mode. The app stores no plaintext password. HTTPS public origins add Secure to dashboard and evaluation cookies.

Unsafe browser methods require the canonical Origin. Local defaults accept loopback Host values. Hosted configuration pins `VIBE_PUBLIC_URL` and its Host. `VIBE_TRUSTED_PROXY` lists trusted proxy addresses for client IP attribution. Untrusted forwarding headers grant no authority. The login boundary admits at most ten attempts per source and 100 total in each 15-minute window. Expired throttle rows are removed on the next attempt.

## Runtime authority

The server owns a stable installation UUID and runtime UUIDs. **Add new** issues a ten-minute single-use enrollment key. **Replace credential** explicitly targets an existing runtime. The copyable base64url command is a secret, not encrypted content.

The client generates its persistent credential and saves the exact pending exchange before HTTP. A transaction consumes the enrollment and creates the hashed credential. Concurrent different exchanges cannot produce additional registrations. An exact retry retrieves the original receipt after a lost response. The response includes request, installation, runtime, and credential identities.

Runtime requests use `Bearer <credential-id>.<secret>`. Each worker route authenticates before reading prior receipts, compares the body runtime identity, and then enforces assignment membership. Runtime authority never authorizes dashboard APIs. Revocation blocks subsequent authorization on both listeners. The legacy pairwise report token remains restricted to its report endpoint.

A local configuration contains one endpoint and credential. Re-enrollment preserves collected records under their original installation and runtime namespace. A targeted replacement for the same installation and runtime can resume those reports. New or foreign registrations cannot upload them. Secrets remain outside child environments and attempt workspaces.

## Durable execution

An assignment is durable before execution. Preparation, attempt starts, terminal outcomes, and artifact bytes form an immutable local journal. Collection runs independently of ordered upload. Delivery sends preparation, then each attempt's start and terminal in assignment order. Skipped attempts need no start.

The runtime retains collected records until durable acknowledgement and verifies response identities. API outages and authentication rejection trigger progressive capped retries. They do not stop already assigned collection. Restart restores saved assignments before asking the server for new work. A started attempt with no saved outcome is uncertain and never executes again under its old ID. It receives a truthful interrupted result. No lease expiry stops work because the API is unreachable.

The release guide documents binaries and prerequisites. Authentication and fixture tests do not prove provider access or hosted deployment readiness.
