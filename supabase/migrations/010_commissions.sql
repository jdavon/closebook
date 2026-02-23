-- ============================================================================
-- COMMISSIONS CALCULATOR
-- ============================================================================

-- Commission profiles: one per salesperson per entity
CREATE TABLE commission_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  commission_rate numeric(7,4) NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, name)
);

-- Account assignments: which GL accounts feed into a profile's commission base
CREATE TABLE commission_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_profile_id uuid NOT NULL REFERENCES commission_profiles(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('revenue', 'expense')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (commission_profile_id, account_id)
);

-- Commission results: calculated snapshots per profile per period
CREATE TABLE commission_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_profile_id uuid NOT NULL REFERENCES commission_profiles(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  total_revenue numeric(19,4) DEFAULT 0,
  total_expenses numeric(19,4) DEFAULT 0,
  commission_base numeric(19,4) DEFAULT 0,
  commission_rate numeric(7,4) NOT NULL,
  commission_earned numeric(19,4) DEFAULT 0,
  is_payable boolean DEFAULT false,
  marked_payable_at timestamptz,
  marked_payable_by uuid REFERENCES profiles(id),
  calculated_at timestamptz DEFAULT now(),
  UNIQUE (commission_profile_id, period_year, period_month)
);

-- Indexes
CREATE INDEX idx_commission_profiles_entity ON commission_profiles(entity_id);
CREATE INDEX idx_commission_account_assignments_profile ON commission_account_assignments(commission_profile_id);
CREATE INDEX idx_commission_results_entity_period ON commission_results(entity_id, period_year, period_month);
CREATE INDEX idx_commission_results_profile ON commission_results(commission_profile_id);

-- Triggers: auto-update updated_at
CREATE TRIGGER update_commission_profiles_updated_at
  BEFORE UPDATE ON commission_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE commission_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view commission profiles in their entities"
  ON commission_profiles FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage commission profiles"
  ON commission_profiles FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

ALTER TABLE commission_account_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view assignments in their entities"
  ON commission_account_assignments FOR SELECT
  USING (commission_profile_id IN (
    SELECT id FROM commission_profiles WHERE entity_id IN (SELECT public.user_entity_ids())
  ));
CREATE POLICY "Admins/controllers can manage assignments"
  ON commission_account_assignments FOR ALL
  USING (commission_profile_id IN (
    SELECT id FROM commission_profiles
    WHERE public.user_entity_role(entity_id) IN ('admin', 'controller')
  ));

ALTER TABLE commission_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view commission results in their entities"
  ON commission_results FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage commission results"
  ON commission_results FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));
