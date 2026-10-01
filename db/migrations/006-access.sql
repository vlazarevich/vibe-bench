CREATE TABLE installation_access (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  installation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  password_generation text NOT NULL DEFAULT '',
  password_salt text NOT NULL DEFAULT gen_random_uuid()::text
);
INSERT INTO installation_access(singleton) VALUES(true);
CREATE TABLE dashboard_sessions (
  token_hash text PRIMARY KEY,
  generation text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE login_attempts (
  source_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL
);
CREATE TABLE runtime_credentials (
  credential_id uuid PRIMARY KEY,
  runtime_id uuid NOT NULL,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX runtime_active_credential ON runtime_credentials(runtime_id) WHERE revoked_at IS NULL;
CREATE TABLE runtime_enrollments (
  key_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  target_runtime_id uuid,
  exchange_hash text,
  receipt jsonb
);
