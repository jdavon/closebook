-- ============================================================================
-- SUBLEASE MANAGEMENT MODULE
-- Track subleases (subtenants renting space from you as the master lessee).
-- Revenue-side: income schedules, escalations, options, critical dates, docs.
-- ============================================================================

-- Master sublease record (child of a head lease)
CREATE TABLE subleases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Subtenant identification
  sublease_name text NOT NULL,
  subtenant_name text NOT NULL,
  subtenant_contact_info text,

  -- Status
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),

  -- Key dates
  commencement_date date NOT NULL,
  rent_commencement_date date,
  expiration_date date NOT NULL,
  sublease_term_months int NOT NULL,

  -- Space
  subleased_square_footage numeric(19,2),
  floor_suite text,

  -- Rent terms (income to us)
  base_rent_monthly numeric(19,4) NOT NULL DEFAULT 0,
  base_rent_annual numeric(19,4) GENERATED ALWAYS AS (base_rent_monthly * 12) STORED,
  rent_per_sf numeric(19,4),
  security_deposit_held numeric(19,4) DEFAULT 0,

  -- Rent concessions
  rent_abatement_months int DEFAULT 0,
  rent_abatement_amount numeric(19,4) DEFAULT 0,

  -- Operating cost pass-throughs (income)
  cam_recovery_monthly numeric(19,4) DEFAULT 0,
  insurance_recovery_monthly numeric(19,4) DEFAULT 0,
  property_tax_recovery_monthly numeric(19,4) DEFAULT 0,
  utilities_recovery_monthly numeric(19,4) DEFAULT 0,
  other_recovery_monthly numeric(19,4) DEFAULT 0,
  other_recovery_description text,

  -- Lease structure
  maintenance_type text NOT NULL DEFAULT 'gross'
    CHECK (maintenance_type IN ('triple_net', 'gross', 'modified_gross')),
  permitted_use text,
  notes text,

  -- GL account linkage (revenue accounts)
  sublease_income_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  cam_recovery_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  other_income_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,

  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Sublease payment/income schedule (one per month per income type)
CREATE TABLE sublease_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublease_id uuid NOT NULL REFERENCES subleases(id) ON DELETE CASCADE,

  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  payment_type text NOT NULL
    CHECK (payment_type IN (
      'base_rent', 'cam_recovery', 'property_tax_recovery',
      'insurance_recovery', 'utilities_recovery', 'other_recovery'
    )),

  scheduled_amount numeric(19,4) NOT NULL DEFAULT 0,
  actual_amount numeric(19,4),
  is_received boolean DEFAULT false,
  received_date date,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (sublease_id, period_year, period_month, payment_type)
);

-- Sublease rent escalation rules
CREATE TABLE sublease_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublease_id uuid NOT NULL REFERENCES subleases(id) ON DELETE CASCADE,

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

-- Sublease options (renewal, termination, etc.)
CREATE TABLE sublease_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublease_id uuid NOT NULL REFERENCES subleases(id) ON DELETE CASCADE,

  option_type text NOT NULL
    CHECK (option_type IN ('renewal', 'termination', 'expansion', 'contraction')),

  exercise_deadline date,
  notice_required_days int,
  option_term_months int,
  option_rent_terms text,
  option_price numeric(19,4),
  penalty_amount numeric(19,4),

  is_exercised boolean DEFAULT false,
  exercised_date date,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Sublease critical dates / alerts
CREATE TABLE sublease_critical_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublease_id uuid NOT NULL REFERENCES subleases(id) ON DELETE CASCADE,

  date_type text NOT NULL
    CHECK (date_type IN (
      'sublease_expiration', 'renewal_deadline', 'termination_notice',
      'rent_escalation', 'rent_review', 'insurance_renewal', 'custom'
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

-- Sublease documents stored in Supabase Storage
CREATE TABLE sublease_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublease_id uuid NOT NULL REFERENCES subleases(id) ON DELETE CASCADE,

  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN (
      'sublease_agreement', 'amendment', 'addendum',
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

CREATE INDEX idx_subleases_lease ON subleases(lease_id);
CREATE INDEX idx_subleases_entity ON subleases(entity_id);
CREATE INDEX idx_subleases_status ON subleases(entity_id, status);
CREATE INDEX idx_sublease_payments_sublease ON sublease_payments(sublease_id);
CREATE INDEX idx_sublease_payments_period ON sublease_payments(sublease_id, period_year, period_month);
CREATE INDEX idx_sublease_escalations_sublease ON sublease_escalations(sublease_id);
CREATE INDEX idx_sublease_options_sublease ON sublease_options(sublease_id);
CREATE INDEX idx_sublease_critical_dates_sublease ON sublease_critical_dates(sublease_id);
CREATE INDEX idx_sublease_critical_dates_upcoming ON sublease_critical_dates(critical_date)
  WHERE is_resolved = false;
CREATE INDEX idx_sublease_documents_sublease ON sublease_documents(sublease_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Subleases (entity-scoped)
ALTER TABLE subleases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view subleases" ON subleases FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Users can manage subleases" ON subleases FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

-- Sublease payments (via parent sublease)
ALTER TABLE sublease_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sublease payments" ON sublease_payments FOR SELECT USING (
  sublease_id IN (
    SELECT s.id FROM subleases s WHERE s.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage sublease payments" ON sublease_payments FOR ALL USING (
  sublease_id IN (
    SELECT s.id FROM subleases s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Sublease escalations
ALTER TABLE sublease_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sublease escalations" ON sublease_escalations FOR SELECT USING (
  sublease_id IN (
    SELECT s.id FROM subleases s WHERE s.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage sublease escalations" ON sublease_escalations FOR ALL USING (
  sublease_id IN (
    SELECT s.id FROM subleases s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Sublease options
ALTER TABLE sublease_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sublease options" ON sublease_options FOR SELECT USING (
  sublease_id IN (
    SELECT s.id FROM subleases s WHERE s.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage sublease options" ON sublease_options FOR ALL USING (
  sublease_id IN (
    SELECT s.id FROM subleases s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Sublease critical dates
ALTER TABLE sublease_critical_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sublease critical dates" ON sublease_critical_dates FOR SELECT USING (
  sublease_id IN (
    SELECT s.id FROM subleases s WHERE s.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage sublease critical dates" ON sublease_critical_dates FOR ALL USING (
  sublease_id IN (
    SELECT s.id FROM subleases s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Sublease documents
ALTER TABLE sublease_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sublease documents" ON sublease_documents FOR SELECT USING (
  sublease_id IN (
    SELECT s.id FROM subleases s WHERE s.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage sublease documents" ON sublease_documents FOR ALL USING (
  sublease_id IN (
    SELECT s.id FROM subleases s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_subleases_updated_at
  BEFORE UPDATE ON subleases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sublease_payments_updated_at
  BEFORE UPDATE ON sublease_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sublease_escalations_updated_at
  BEFORE UPDATE ON sublease_escalations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sublease_options_updated_at
  BEFORE UPDATE ON sublease_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sublease_critical_dates_updated_at
  BEFORE UPDATE ON sublease_critical_dates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
