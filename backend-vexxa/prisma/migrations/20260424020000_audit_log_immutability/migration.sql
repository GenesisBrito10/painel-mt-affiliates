-- Migration: audit_log_immutability
-- Makes audit_logs append-only by blocking DELETE and UPDATE at the DB level.
-- A superuser (postgres role) can remove the trigger if needed, but
-- application roles cannot. This prevents accidental or malicious tampering
-- with financial audit evidence.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only. DELETE and UPDATE are forbidden.';
END;
$$ LANGUAGE plpgsql;

-- Block DELETE
CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

-- Block UPDATE
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();
