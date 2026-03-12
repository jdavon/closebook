-- ============================================================================
-- 031: Asset Reconciliations
-- Tracks subledger-to-GL reconciliation status for rental asset groups
-- ============================================================================

CREATE TABLE asset_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  gl_account_group text NOT NULL CHECK (gl_account_group IN ('vehicles_net', 'trailers_net')),
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

-- Indexes
CREATE INDEX idx_asset_recon_entity_period ON asset_reconciliations(entity_id, period_year, period_month);

-- RLS
ALTER TABLE asset_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reconciliations in their entities"
  ON asset_reconciliations FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Controllers can manage reconciliations"
  ON asset_reconciliations FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));

-- Updated-at trigger
CREATE TRIGGER update_asset_reconciliations_updated_at
  BEFORE UPDATE ON asset_reconciliations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
