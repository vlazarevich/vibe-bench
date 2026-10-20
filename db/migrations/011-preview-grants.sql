-- Short-lived capability grants for client-side HTML previews. Only token hashes are stored.
CREATE TABLE preview_grants (
  token_hash text PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES configured_attempts(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX preview_grants_expiry ON preview_grants(expires_at);
