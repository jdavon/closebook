-- ============================================================
-- 009: Unmatched Trial Balance Rows
-- Stores QBO TB rows that failed to match during sync,
-- enabling manual resolution and future auto-matching.
-- ============================================================

CREATE TABLE tb_unmatched_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  qbo_account_name text NOT NULL,
  qbo_account_id text,
  debit numeric(19,4) DEFAULT 0,
  credit numeric(19,4) DEFAULT 0,
  -- Resolution
  resolved_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, period_year, period_month, qbo_account_name)
);

CREATE INDEX idx_tb_unmatched_entity_period
  ON tb_unmatched_rows(entity_id, period_year, period_month);

CREATE INDEX idx_tb_unmatched_unresolved
  ON tb_unmatched_rows(entity_id)
  WHERE resolved_account_id IS NULL;

-- RLS
ALTER TABLE tb_unmatched_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view unmatched rows in their entities"
  ON tb_unmatched_rows FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins and controllers can manage unmatched rows"
  ON tb_unmatched_rows FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));
