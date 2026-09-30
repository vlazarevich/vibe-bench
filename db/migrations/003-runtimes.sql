CREATE TABLE runtime_observations (
  runtime_id uuid NOT NULL,
  observation bigint NOT NULL CHECK (observation > 0),
  registration jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (runtime_id, observation)
);
CREATE TRIGGER immutable_runtime_observation BEFORE UPDATE OR DELETE ON runtime_observations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
