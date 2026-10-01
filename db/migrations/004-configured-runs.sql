CREATE TABLE configured_runs (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  request jsonb NOT NULL,
  runtime_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE configured_attempts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES configured_runs(id),
  task_id uuid NOT NULL,
  entrant_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  UNIQUE (run_id, ordinal),
  UNIQUE (run_id, task_id, entrant_id)
);
CREATE TABLE work_claims (
  request_id uuid PRIMARY KEY,
  runtime_id uuid NOT NULL,
  assignment_id uuid UNIQUE,
  run_id uuid UNIQUE REFERENCES configured_runs(id),
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  CHECK ((assignment_id IS NULL) = (run_id IS NULL))
);
CREATE TABLE run_preparations (
  run_id uuid PRIMARY KEY REFERENCES configured_runs(id),
  preparation jsonb NOT NULL
);
CREATE TABLE attempt_starts (
  attempt_id uuid PRIMARY KEY REFERENCES configured_attempts(id),
  started_at timestamptz(3) NOT NULL
);
CREATE TABLE attempt_outcomes (
  attempt_id uuid PRIMARY KEY REFERENCES configured_attempts(id),
  outcome jsonb NOT NULL,
  observed jsonb NOT NULL
);
CREATE TABLE work_reports (
  report_id uuid PRIMARY KEY,
  request_digest text NOT NULL,
  receipt jsonb NOT NULL
);
CREATE TABLE configured_artifacts (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES configured_attempts(id),
  metadata jsonb NOT NULL,
  bytes bytea NOT NULL
);
CREATE TRIGGER immutable_configured_run BEFORE UPDATE OR DELETE ON configured_runs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_configured_attempt BEFORE UPDATE OR DELETE ON configured_attempts FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_work_claim BEFORE UPDATE OR DELETE ON work_claims FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_run_preparation BEFORE UPDATE OR DELETE ON run_preparations FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_attempt_start BEFORE UPDATE OR DELETE ON attempt_starts FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_attempt_outcome BEFORE UPDATE OR DELETE ON attempt_outcomes FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_work_report BEFORE UPDATE OR DELETE ON work_reports FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_configured_artifact BEFORE UPDATE OR DELETE ON configured_artifacts FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
