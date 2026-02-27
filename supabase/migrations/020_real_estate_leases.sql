-- ============================================================================
-- REAL ESTATE LEASE MANAGEMENT MODULE
-- Properties, leases, payment schedules, escalations, options, amendments,
-- critical dates, and documents
-- ============================================================================

-- Physical property locations
CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  property_name text NOT NULL,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip_code text,
  country text DEFAULT 'US',

  property_type text NOT NULL DEFAULT 'office'
    CHECK (property_type IN (
      'office', 'retail', 'warehouse', 'industrial',
      'mixed_use', 'land', 'other'
    )),

  total_square_footage numeric(19,2),
  rentable_square_footage numeric(19,2),
  usable_square_footage numeric(19,2),

  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Master lease record
CREATE TABLE leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Identification
  lease_name text NOT NULL,
  lessor_name text,
  lessor_contact_info text,

  -- Classification
  lease_type text NOT NULL DEFAULT 'operating'
    CHECK (lease_type IN ('operating', 'finance')),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),

  -- Key dates
  commencement_date date NOT NULL,
  rent_commencement_date date,
  expiration_date date NOT NULL,
  lease_term_months int NOT NULL,

  -- Rent terms
  base_rent_monthly numeric(19,4) NOT NULL DEFAULT 0,
  base_rent_annual numeric(19,4) GENERATED ALWAYS AS (base_rent_monthly * 12) STORED,
  rent_per_sf numeric(19,4),
  security_deposit numeric(19,4) DEFAULT 0,

  -- Tenant improvements & incentives
  tenant_improvement_allowance numeric(19,4) DEFAULT 0,
  rent_abatement_months int DEFAULT 0,
  rent_abatement_amount numeric(19,4) DEFAULT 0,

  -- ASC 842 inputs (Phase 2 will consume these)
  discount_rate numeric(8,6) DEFAULT 0,       -- incremental borrowing rate
  initial_direct_costs numeric(19,4) DEFAULT 0,
  lease_incentives_received numeric(19,4) DEFAULT 0,
  prepaid_rent numeric(19,4) DEFAULT 0,
  fair_value_of_asset numeric(19,4),
  remaining_economic_life_months int,

  -- Operating costs
  cam_monthly numeric(19,4) DEFAULT 0,
  insurance_monthly numeric(19,4) DEFAULT 0,
  property_tax_annual numeric(19,4) DEFAULT 0,
  property_tax_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (property_tax_frequency IN ('monthly', 'semi_annual', 'annual')),
  utilities_monthly numeric(19,4) DEFAULT 0,
  other_monthly_costs numeric(19,4) DEFAULT 0,
  other_monthly_costs_description text,

  -- Lease structure
  maintenance_type text NOT NULL DEFAULT 'gross'
    CHECK (maintenance_type IN ('triple_net', 'gross', 'modified_gross')),
  permitted_use text,
  notes text,

  -- GL account linkage
  rou_asset_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  lease_liability_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  lease_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  interest_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  cam_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,

  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Payment schedule rows (one per month per payment type)
CREATE TABLE lease_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  payment_type text NOT NULL
    CHECK (payment_type IN (
      'base_rent', 'cam', 'property_tax', 'insurance', 'utilities', 'other'
    )),

  scheduled_amount numeric(19,4) NOT NULL DEFAULT 0,
  actual_amount numeric(19,4),
  is_paid boolean DEFAULT false,
  payment_date date,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (lease_id, period_year, period_month, payment_type)
);

-- Escalation rules for rent increases
CREATE TABLE lease_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  escalation_type text NOT NULL
    CHECK (escalation_type IN ('fixed_percentage', 'fixed_amount', 'cpi')),

  effective_date date NOT NULL,

  percentage_increase numeric(8,6),
  amount_increase numeric(19,4),

  cpi_index_name text,
  cpi_cap numeric(8,6),
  cpi_floor numeric(8,6),

  frequency text NOT NULL DEFAULT 'annual'
    CHECK (frequency IN ('annual', 'biennial', 'at_renewal')),

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Renewal, termination, purchase, and expansion options
CREATE TABLE lease_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  option_type text NOT NULL
    CHECK (option_type IN ('renewal', 'termination', 'purchase', 'expansion')),

  exercise_deadline date,
  notice_required_days int,
  option_term_months int,
  option_rent_terms text,
  option_price numeric(19,4),
  penalty_amount numeric(19,4),

  is_reasonably_certain boolean DEFAULT false,
  is_exercised boolean DEFAULT false,
  exercised_date date,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Modification history for lease changes
CREATE TABLE lease_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  amendment_number int NOT NULL,
  effective_date date NOT NULL,
  description text,

  changed_fields jsonb,
  previous_values jsonb,
  new_values jsonb,

  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Alert dates for important lease milestones
CREATE TABLE lease_critical_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  date_type text NOT NULL
    CHECK (date_type IN (
      'lease_expiration', 'renewal_deadline', 'termination_notice',
      'rent_escalation', 'rent_review', 'cam_reconciliation',
      'insurance_renewal', 'custom'
    )),

  critical_date date NOT NULL,
  alert_days_before int DEFAULT 90,
  description text,

  is_resolved boolean DEFAULT false,
  resolved_date date,
  resolved_by uuid REFERENCES profiles(id),

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Uploaded lease documents stored in Supabase Storage
CREATE TABLE lease_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,

  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN (
      'original_lease', 'amendment', 'addendum',
      'correspondence', 'insurance_cert', 'other'
    )),

  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size_bytes bigint,

  uploaded_by uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Properties
CREATE INDEX idx_properties_entity ON properties(entity_id);

-- Leases
CREATE INDEX idx_leases_entity ON leases(entity_id);
CREATE INDEX idx_leases_property ON leases(property_id);
CREATE INDEX idx_leases_status ON leases(entity_id, status);
CREATE INDEX idx_leases_rou_asset_account ON leases(rou_asset_account_id);
CREATE INDEX idx_leases_lease_liability_account ON leases(lease_liability_account_id);
CREATE INDEX idx_leases_lease_expense_account ON leases(lease_expense_account_id);
CREATE INDEX idx_leases_interest_expense_account ON leases(interest_expense_account_id);
CREATE INDEX idx_leases_cam_expense_account ON leases(cam_expense_account_id);

-- Lease payments
CREATE INDEX idx_lease_payments_lease ON lease_payments(lease_id);
CREATE INDEX idx_lease_payments_period ON lease_payments(lease_id, period_year, period_month);

-- Lease escalations
CREATE INDEX idx_lease_escalations_lease ON lease_escalations(lease_id);

-- Lease options
CREATE INDEX idx_lease_options_lease ON lease_options(lease_id);

-- Lease amendments
CREATE INDEX idx_lease_amendments_lease ON lease_amendments(lease_id);

-- Lease critical dates
CREATE INDEX idx_lease_critical_dates_lease ON lease_critical_dates(lease_id);
CREATE INDEX idx_lease_critical_dates_upcoming ON lease_critical_dates(critical_date)
  WHERE is_resolved = false;

-- Lease documents
CREATE INDEX idx_lease_documents_lease ON lease_documents(lease_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Properties (entity-scoped)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view properties" ON properties FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Users can manage properties" ON properties FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

-- Leases (entity-scoped)
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view leases" ON leases FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Users can manage leases" ON leases FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

-- Lease payments (via parent lease)
ALTER TABLE lease_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease payments" ON lease_payments FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease payments" ON lease_payments FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Lease escalations (via parent lease)
ALTER TABLE lease_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease escalations" ON lease_escalations FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease escalations" ON lease_escalations FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Lease options (via parent lease)
ALTER TABLE lease_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease options" ON lease_options FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease options" ON lease_options FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Lease amendments (via parent lease)
ALTER TABLE lease_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease amendments" ON lease_amendments FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease amendments" ON lease_amendments FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Lease critical dates (via parent lease)
ALTER TABLE lease_critical_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease critical dates" ON lease_critical_dates FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease critical dates" ON lease_critical_dates FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Lease documents (via parent lease)
ALTER TABLE lease_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lease documents" ON lease_documents FOR SELECT USING (
  lease_id IN (
    SELECT l.id FROM leases l WHERE l.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage lease documents" ON lease_documents FOR ALL USING (
  lease_id IN (
    SELECT l.id FROM leases l
    WHERE public.user_entity_role(l.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_leases_updated_at
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_lease_payments_updated_at
  BEFORE UPDATE ON lease_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_lease_escalations_updated_at
  BEFORE UPDATE ON lease_escalations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_lease_options_updated_at
  BEFORE UPDATE ON lease_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_lease_amendments_updated_at
  BEFORE UPDATE ON lease_amendments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_lease_critical_dates_updated_at
  BEFORE UPDATE ON lease_critical_dates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
