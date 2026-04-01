-- Add 'auto_reversal' as a valid source for payroll accruals.
-- Auto-reversals are generated when accruals are posted, creating
-- offsetting entries on day 1 of the next period.

ALTER TABLE payroll_accruals DROP CONSTRAINT IF EXISTS payroll_accruals_source_check;
ALTER TABLE payroll_accruals ADD CONSTRAINT payroll_accruals_source_check
  CHECK (source IN ('paylocity_sync', 'manual', 'auto_reversal'));
