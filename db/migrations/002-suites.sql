CREATE TABLE suites (
  id uuid PRIMARY KEY,
  current_content_id uuid NOT NULL
);
CREATE TABLE suite_contents (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suites(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  digest text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE(suite_id, ordinal),
  UNIQUE(suite_id, id)
);
ALTER TABLE suites ADD CONSTRAINT suite_current_content FOREIGN KEY (id, current_content_id)
  REFERENCES suite_contents(suite_id, id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable content cannot be updated or deleted';
END;
$$;
CREATE TRIGGER immutable_suite_content BEFORE UPDATE OR DELETE ON suite_contents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_run BEFORE UPDATE OR DELETE ON runs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
