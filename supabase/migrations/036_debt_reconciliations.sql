-- ============================================================================
-- 036: Debt Reconciliations
-- Links debt GL groups to entity-level accounts and tracks subledger-to-GL
-- reconciliation status for debt instruments per period.
-- ============================================================================

-- Maps debt GL account groups to entity-level GL accounts.
-- Each group (e.g. "notes_payable_current") can have multiple entity accounts.
CREATE TABLE debt_reconciliation_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  gl_account_group text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, gl_account_group, account_id)
);

CREATE INDEX idx_debt_recon_accts_entity ON debt_reconciliation_accounts(entity_id);

ALTER TABLE debt_reconciliation_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view debt recon accounts in their entities"
  ON debt_reconciliation_accounts FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Controllers can manage debt recon accounts"
  ON debt_reconciliation_accounts FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));

-- Tracks period-level reconciliation status per debt GL group.
CREATE TABLE debt_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  gl_account_group text NOT NULL,
  gl_balance numeric(19,4),
  subledger_balance numeric(19,4),
  variance numeric(19,4),
  is_reconciled boolean DEFAULT false,
  reconciled_by uuid REFERENCES profiles(id),
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, period_year, period_month, gl_account_group)
);

CREATE INDEX idx_debt_recon_entity_period ON debt_reconciliations(entity_id, period_year, period_month);

ALTER TABLE debt_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view debt reconciliations in their entities"
  ON debt_reconciliations FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Controllers can manage debt reconciliations"
  ON debt_reconciliations FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));

CREATE TRIGGER update_debt_reconciliations_updated_at
  BEFORE UPDATE ON debt_reconciliations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
