-- ============================================================================
-- MASTER GENERAL LEDGER
-- Organization-level chart of accounts for consolidated financial reporting
-- across multiple QuickBooks entities
-- ============================================================================

-- Master Chart of Accounts (organization-level)
CREATE TABLE master_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  name text NOT NULL,
  description text,
  classification text NOT NULL CHECK (classification IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  account_type text NOT NULL,
  account_sub_type text,
  parent_account_id uuid REFERENCES master_accounts(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  display_order int DEFAULT 0,
  normal_balance text NOT NULL DEFAULT 'debit' CHECK (normal_balance IN ('debit', 'credit')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, account_number)
);

-- Mappings from entity accounts to master accounts
CREATE TABLE master_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_account_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, account_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_master_accounts_org ON master_accounts(organization_id);
CREATE INDEX idx_master_accounts_parent ON master_accounts(parent_account_id);
CREATE INDEX idx_master_accounts_classification ON master_accounts(organization_id, classification);
CREATE INDEX idx_master_account_mappings_master ON master_account_mappings(master_account_id);
CREATE INDEX idx_master_account_mappings_entity ON master_account_mappings(entity_id);
CREATE INDEX idx_master_account_mappings_account ON master_account_mappings(account_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Master Accounts
ALTER TABLE master_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view master accounts" ON master_accounts FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

CREATE POLICY "Admins and controllers can manage master accounts" ON master_accounts FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update master accounts" ON master_accounts FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete master accounts" ON master_accounts FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

-- Master Account Mappings
ALTER TABLE master_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view mappings" ON master_account_mappings FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Admins and controllers can manage mappings" ON master_account_mappings FOR INSERT WITH CHECK (
  entity_id IN (
    SELECT e.id FROM entities e
    INNER JOIN organization_members om ON om.organization_id = e.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update mappings" ON master_account_mappings FOR UPDATE USING (
  entity_id IN (
    SELECT e.id FROM entities e
    INNER JOIN organization_members om ON om.organization_id = e.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete mappings" ON master_account_mappings FOR DELETE USING (
  entity_id IN (
    SELECT e.id FROM entities e
    INNER JOIN organization_members om ON om.organization_id = e.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_master_accounts_updated_at
  BEFORE UPDATE ON master_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
