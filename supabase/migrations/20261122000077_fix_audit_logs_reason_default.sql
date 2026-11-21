-- Migration 20261122000077: Relax audit_logs.reason NOT NULL constraint and provide safe default
ALTER TABLE audit_logs ALTER COLUMN reason SET DEFAULT 'Operation audit trail';
ALTER TABLE audit_logs ALTER COLUMN reason DROP NOT NULL;
