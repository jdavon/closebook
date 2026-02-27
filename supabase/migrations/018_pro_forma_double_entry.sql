-- Migration 018: Double-entry pro forma adjustments
-- Each adjustment now specifies an offset (counterpart) master account so that
-- the balance sheet stays balanced after injection.  The offset receives the
-- negated amount (-amount) during the financial statements build.

ALTER TABLE pro_forma_adjustments
  ADD COLUMN offset_master_account_id uuid REFERENCES master_accounts(id) ON DELETE CASCADE;

-- Primary and offset accounts must differ
ALTER TABLE pro_forma_adjustments
  ADD CONSTRAINT chk_pro_forma_different_accounts CHECK (
    offset_master_account_id IS NULL
    OR master_account_id != offset_master_account_id
  );

-- Index for the new column (partial — only non-null values)
CREATE INDEX idx_pro_forma_adj_offset_master_account
  ON pro_forma_adjustments(offset_master_account_id)
  WHERE offset_master_account_id IS NOT NULL;
