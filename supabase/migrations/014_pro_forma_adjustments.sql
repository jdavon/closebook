-- Migration 014: Pro forma adjustment entries for what-if financial modeling
-- Allows users to add hypothetical adjustments to master accounts
-- that modify the financial statements when enabled.

CREATE TABLE pro_forma_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id         uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  master_account_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  period_year       int  NOT NULL,
  period_month      int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount            numeric(19,4) NOT NULL DEFAULT 0,
  description       text NOT NULL,
  notes             text,
  is_excluded       boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_pro_forma_adj_org
  ON pro_forma_adjustments(organization_id);
CREATE INDEX idx_pro_forma_adj_entity
  ON pro_forma_adjustments(entity_id, period_year, period_month);
CREATE INDEX idx_pro_forma_adj_master_account
  ON pro_forma_adjustments(master_account_id);
CREATE INDEX idx_pro_forma_adj_not_excluded
  ON pro_forma_adjustments(organization_id, is_excluded)
  WHERE is_excluded = false;

-- RLS
ALTER TABLE pro_forma_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pro forma adjustments"
  ON pro_forma_adjustments FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
  );

CREATE POLICY "Admins and controllers can insert pro forma adjustments"
  ON pro_forma_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can update pro forma adjustments"
  ON pro_forma_adjustments FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can delete pro forma adjustments"
  ON pro_forma_adjustments FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_pro_forma_adjustments_updated_at
  BEFORE UPDATE ON pro_forma_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
