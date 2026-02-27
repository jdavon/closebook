-- Migration 021: Add GL account columns for disaggregated lease journal entries
-- Splits cash rent from ASC 842 non-cash adjustment when generating JEs for QB

ALTER TABLE leases
  ADD COLUMN asc842_adjustment_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN cash_ap_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_leases_asc842_adjustment_account ON leases(asc842_adjustment_account_id);
CREATE INDEX idx_leases_cash_ap_account ON leases(cash_ap_account_id);
