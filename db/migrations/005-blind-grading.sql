ALTER TABLE configured_runs ADD COLUMN review_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
CREATE TABLE blind_grading_sessions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES configured_runs(id),
  authority_hash text NOT NULL,
  mapping jsonb NOT NULL,
  UNIQUE(run_id, authority_hash)
);
CREATE TRIGGER immutable_blind_grading_session BEFORE UPDATE OR DELETE ON blind_grading_sessions FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE blind_grading_judgments (
  session_id uuid NOT NULL REFERENCES blind_grading_sessions(id),
  task_handle uuid NOT NULL,
  card_handle uuid NOT NULL,
  criterion_handle uuid NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
  value jsonb NOT NULL DEFAULT '{"kind":"ungraded"}',
  PRIMARY KEY(session_id, card_handle, criterion_handle)
);
CREATE FUNCTION preserve_grading_association() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.session_id <> OLD.session_id OR NEW.task_handle <> OLD.task_handle OR NEW.card_handle <> OLD.card_handle OR NEW.criterion_handle <> OLD.criterion_handle THEN
    RAISE EXCEPTION 'Immutable grading association';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_grading_association BEFORE UPDATE OR DELETE ON blind_grading_judgments FOR EACH ROW EXECUTE FUNCTION preserve_grading_association();
