UPDATE runtime_enrollments SET target_runtime_id=(receipt->>'runtimeId')::uuid WHERE target_runtime_id IS NULL AND receipt IS NOT NULL;
CREATE TABLE enrollment_exchanges (
  request_id uuid NOT NULL,
  key_hash text NOT NULL REFERENCES runtime_enrollments(key_hash),
  exchange_hash text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY(key_hash,request_id)
);
INSERT INTO enrollment_exchanges(request_id,key_hash,exchange_hash,receipt) SELECT (receipt->>'requestId')::uuid,key_hash,exchange_hash,receipt FROM runtime_enrollments WHERE receipt IS NOT NULL;
CREATE TABLE run_abandonments (
  run_id uuid PRIMARY KEY REFERENCES configured_runs(id),
  abandoned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_run_abandonment BEFORE UPDATE OR DELETE ON run_abandonments FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE runtime_observations DISABLE TRIGGER immutable_runtime_observation;
UPDATE runtime_observations SET registration=registration-'capacity' WHERE registration ? 'capacity';
ALTER TABLE runtime_observations ENABLE TRIGGER immutable_runtime_observation;

INSERT INTO run_abandonments(run_id) SELECT c.run_id FROM work_claims c WHERE c.run_id IS NOT NULL AND EXISTS(SELECT 1 FROM runtime_credentials rc WHERE rc.runtime_id=c.runtime_id) AND NOT EXISTS(SELECT 1 FROM runtime_credentials rc WHERE rc.runtime_id=c.runtime_id AND rc.revoked_at IS NULL) AND EXISTS(SELECT 1 FROM configured_attempts a LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id WHERE a.run_id=c.run_id AND o.attempt_id IS NULL);
