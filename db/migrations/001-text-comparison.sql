CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  report_id uuid UNIQUE NOT NULL,
  review_id uuid UNIQUE NOT NULL,
  digest text NOT NULL,
  report jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evaluation_sessions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  authority_hash text NOT NULL,
  mapping jsonb NOT NULL,
  selected_handle uuid,
  criterion text NOT NULL DEFAULT 'Which answer is better?',
  selected_at timestamptz,
  UNIQUE(authority_hash, run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_sessions_authority ON evaluation_sessions(authority_hash, run_id);
