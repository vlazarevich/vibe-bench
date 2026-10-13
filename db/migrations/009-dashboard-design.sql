CREATE TABLE runtime_presence (
  runtime_id uuid PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE runtime_deletions (runtime_id uuid PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE run_cancellations (run_id uuid PRIMARY KEY REFERENCES configured_runs(id), cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER immutable_run_cancellation BEFORE UPDATE OR DELETE ON run_cancellations FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE attempt_outcomes ADD COLUMN received_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE configured_runs ADD COLUMN number bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE blind_grading_sessions DROP CONSTRAINT blind_grading_sessions_run_id_authority_hash_key;
CREATE TABLE grading_details (
  session_id uuid PRIMARY KEY REFERENCES blind_grading_sessions(id),
  request_id uuid NOT NULL,
  grader_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id)
);
CREATE TABLE grading_submissions (
  session_id uuid PRIMARY KEY REFERENCES blind_grading_sessions(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_grading_submission BEFORE UPDATE OR DELETE ON grading_submissions FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE model_catalog (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  fetched_at timestamptz NOT NULL,
  tier text NOT NULL,
  models jsonb NOT NULL
);
CREATE FUNCTION prevent_submitted_grading_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM grading_submissions WHERE session_id=OLD.session_id) THEN RAISE EXCEPTION 'Submitted grading is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submitted_grading_is_immutable BEFORE UPDATE ON blind_grading_judgments FOR EACH ROW EXECUTE FUNCTION prevent_submitted_grading_edit();
CREATE TABLE grading_read_grants (
  session_id uuid NOT NULL REFERENCES grading_submissions(session_id),
  authority_hash text NOT NULL,
  PRIMARY KEY(session_id,authority_hash)
);
