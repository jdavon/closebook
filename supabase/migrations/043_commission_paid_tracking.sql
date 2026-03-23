-- ============================================================================
-- COMMISSION PAID TRACKING
-- Adds is_paid, paid_amount columns to commission_results so users can track
-- whether a commission has actually been paid and what amount was disbursed.
-- ============================================================================

ALTER TABLE commission_results
  ADD COLUMN is_paid boolean DEFAULT false,
  ADD COLUMN paid_amount numeric(19,4),
  ADD COLUMN marked_paid_at timestamptz,
  ADD COLUMN marked_paid_by uuid REFERENCES profiles(id);
