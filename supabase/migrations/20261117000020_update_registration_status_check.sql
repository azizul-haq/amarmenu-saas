-- ==============================================================================
-- AmarMenu Migration: Add 'approved' status and reviewed_at column to registration_requests
-- Version: 20261117000020_update_registration_status_check.sql
-- ==============================================================================

-- 1. Add reviewed_at column if not exists
ALTER TABLE registration_requests
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 2. Update status check constraint to include 'approved'
ALTER TABLE registration_requests
DROP CONSTRAINT IF EXISTS registration_requests_status_check;

ALTER TABLE registration_requests
ADD CONSTRAINT registration_requests_status_check
CHECK (status IN ('pending', 'contacted', 'verified', 'approved', 'rejected'));
