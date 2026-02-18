-- ============================================================================
-- CONSOLIDATION ELIMINATION ENTRIES
-- Journal entries that exist only at the consolidated level to eliminate
-- intercompany balances and record consolidation adjustments
-- ============================================================================

CREATE TABLE consolidation_eliminations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  description text NOT NULL,
  memo text,
  debit_master_account_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE RESTRICT,
  credit_master_account_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  elimination_type text NOT NULL DEFAULT 'intercompany'
    CHECK (elimination_type IN ('intercompany', 'reclassification', 'adjustment')),
  is_recurring boolean DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'reversed')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_consol_elim_org_period ON consolidation_eliminations(organization_id, period_year, period_month);
CREATE INDEX idx_consol_elim_debit ON consolidation_eliminations(debit_master_account_id);
CREATE INDEX idx_consol_elim_credit ON consolidation_eliminations(credit_master_account_id);
CREATE INDEX idx_consol_elim_status ON consolidation_eliminations(organization_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE consolidation_eliminations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view eliminations" ON consolidation_eliminations FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

CREATE POLICY "Admins and controllers can insert eliminations" ON consolidation_eliminations FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update eliminations" ON consolidation_eliminations FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete eliminations" ON consolidation_eliminations FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_consolidation_eliminations_updated_at
  BEFORE UPDATE ON consolidation_eliminations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
