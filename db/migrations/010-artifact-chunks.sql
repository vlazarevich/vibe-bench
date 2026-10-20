-- Staged artifact slices uploaded before a terminal report. Acceptance assembles,
-- verifies, and moves them into configured_artifacts, then discards the staging rows.
CREATE TABLE artifact_chunks (
  artifact_id uuid NOT NULL,
  chunk_offset integer NOT NULL CHECK (chunk_offset >= 0),
  attempt_id uuid NOT NULL REFERENCES configured_attempts(id),
  bytes bytea NOT NULL CHECK (length(bytes) > 0),
  PRIMARY KEY (artifact_id, chunk_offset)
);
CREATE INDEX artifact_chunks_attempt ON artifact_chunks(attempt_id);
CREATE TRIGGER immutable_artifact_chunk BEFORE UPDATE ON artifact_chunks FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION discard_abandoned_artifact_chunks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM artifact_chunks c USING configured_attempts a WHERE a.id = c.attempt_id AND a.run_id = NEW.run_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER discard_abandoned_artifact_chunks AFTER INSERT ON run_abandonments FOR EACH ROW EXECUTE FUNCTION discard_abandoned_artifact_chunks();
