-- =============================================================================
-- 029_insurance.sql — Insurance Module
-- Tracks policies, coverages, premiums, payment schedules, exposures,
-- entity allocations, claims, documents, exclusions, and subjectivities.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. insurance_carriers — Carrier / Insurer Registry
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  am_best_rating text,
  naic_number text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_carriers_entity ON insurance_carriers(entity_id);

ALTER TABLE insurance_carriers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance carriers"
  ON insurance_carriers FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage insurance carriers"
  ON insurance_carriers FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

CREATE TRIGGER update_insurance_carriers_updated_at
  BEFORE UPDATE ON insurance_carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 2. insurance_brokers — Broker Registry
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_brokers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  license_number text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_brokers_entity ON insurance_brokers(entity_id);

ALTER TABLE insurance_brokers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance brokers"
  ON insurance_brokers FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage insurance brokers"
  ON insurance_brokers FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

CREATE TRIGGER update_insurance_brokers_updated_at
  BEFORE UPDATE ON insurance_brokers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. insurance_policies — Master Policy Record
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES insurance_carriers(id) ON DELETE SET NULL,
  broker_id uuid REFERENCES insurance_brokers(id) ON DELETE SET NULL,

  policy_number text,
  policy_type text NOT NULL DEFAULT 'other'
    CHECK (policy_type IN (
      'auto_liability', 'auto_physical_damage', 'general_liability', 'property',
      'excess_liability', 'pollution', 'management_liability', 'workers_comp',
      'umbrella', 'inland_marine', 'cyber', 'epli', 'crime', 'fiduciary',
      'side_a_dic', 'renters_liability', 'garagekeepers', 'hired_non_owned_auto',
      'package', 'other'
    )),
  line_of_business text,
  named_insured text,
  named_insured_entity text,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled', 'non_renewed', 'pending_renewal', 'draft')),

  effective_date date,
  expiration_date date,

  annual_premium numeric(19,4) DEFAULT 0,
  prior_year_premium numeric(19,4) DEFAULT 0,
  premium_change_pct numeric(7,4) DEFAULT 0,

  payment_terms text DEFAULT 'annual'
    CHECK (payment_terms IN ('annual', 'monthly_reporting', 'installment', 'daily_rate', 'other')),
  installment_description text,
  billing_company text,
  deposit_held numeric(19,4) DEFAULT 0,

  is_auditable boolean DEFAULT false,
  coverage_territory text,

  notes text,
  renewal_notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_policies_entity ON insurance_policies(entity_id);
CREATE INDEX idx_insurance_policies_carrier ON insurance_policies(carrier_id);
CREATE INDEX idx_insurance_policies_status ON insurance_policies(entity_id, status);
CREATE INDEX idx_insurance_policies_expiration ON insurance_policies(expiration_date)
  WHERE status = 'active';

ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance policies"
  ON insurance_policies FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage insurance policies"
  ON insurance_policies FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

CREATE TRIGGER update_insurance_policies_updated_at
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 4. insurance_coverages — Coverage Details per Policy
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  coverage_name text NOT NULL,
  coverage_form text DEFAULT 'occurrence'
    CHECK (coverage_form IN ('occurrence', 'claims_made', 'other')),

  limit_per_occurrence numeric(19,4),
  limit_aggregate numeric(19,4),
  limit_description text,

  deductible numeric(19,4),
  deductible_description text,
  self_insured_retention numeric(19,4),

  coinsurance_pct numeric(5,2),
  sub_limit numeric(19,4),
  sub_limit_description text,

  is_included boolean DEFAULT true,

  prior_year_limit numeric(19,4),
  prior_year_deductible numeric(19,4),

  notes text,
  sort_order integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_coverages_policy ON insurance_coverages(policy_id);

ALTER TABLE insurance_coverages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance coverages"
  ON insurance_coverages FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance coverages"
  ON insurance_coverages FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_coverages_updated_at
  BEFORE UPDATE ON insurance_coverages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 5. insurance_payment_schedules — Payment Timeline
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year integer NOT NULL,
  due_date date,

  amount_due numeric(19,4) DEFAULT 0,
  amount_paid numeric(19,4) DEFAULT 0,
  payment_date date,

  payment_status text DEFAULT 'scheduled'
    CHECK (payment_status IN ('scheduled', 'paid', 'overdue', 'partial', 'waived')),
  payment_method text,
  reference_number text,
  is_estimate boolean DEFAULT false,

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (policy_id, period_year, period_month)
);

CREATE INDEX idx_insurance_payments_policy ON insurance_payment_schedules(policy_id);
CREATE INDEX idx_insurance_payments_due ON insurance_payment_schedules(due_date)
  WHERE payment_status IN ('scheduled', 'overdue');

ALTER TABLE insurance_payment_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance payments"
  ON insurance_payment_schedules FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance payments"
  ON insurance_payment_schedules FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_payment_schedules_updated_at
  BEFORE UPDATE ON insurance_payment_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 6. insurance_locations — Scheduled Locations (SOV)
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  location_code text,
  address text NOT NULL,
  city text,
  state text,
  zip_code text,
  occupancy_description text,

  building_value numeric(19,4) DEFAULT 0,
  bpp_value numeric(19,4) DEFAULT 0,
  business_income_value numeric(19,4) DEFAULT 0,
  rental_income_value numeric(19,4) DEFAULT 0,
  total_insured_value numeric(19,4) GENERATED ALWAYS AS
    (building_value + bpp_value + business_income_value + rental_income_value) STORED,

  is_active boolean DEFAULT true,
  location_type text DEFAULT 'operating'
    CHECK (location_type IN ('operating', 'subleased', 'parking', 'storage', 'other')),
  class_code text,
  class_description text,

  notes text,
  sort_order integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_locations_policy ON insurance_locations(policy_id);

ALTER TABLE insurance_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance locations"
  ON insurance_locations FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance locations"
  ON insurance_locations FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_locations_updated_at
  BEFORE UPDATE ON insurance_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 7. insurance_exposures — Exposure Basis Tracking
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  period_month integer CHECK (period_month BETWEEN 1 AND 12),
  period_year integer,

  exposure_type text NOT NULL DEFAULT 'other'
    CHECK (exposure_type IN (
      'vehicle_count', 'square_footage', 'payroll', 'revenue',
      'daily_rate', 'headcount', 'other'
    )),
  exposure_value numeric(19,4),
  rate numeric(12,6),
  calculated_premium numeric(19,4),

  is_reported boolean DEFAULT false,
  reported_date date,

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (policy_id, period_year, period_month, exposure_type)
);

CREATE INDEX idx_insurance_exposures_policy ON insurance_exposures(policy_id);

ALTER TABLE insurance_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance exposures"
  ON insurance_exposures FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance exposures"
  ON insurance_exposures FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_exposures_updated_at
  BEFORE UPDATE ON insurance_exposures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 8. insurance_allocations — Entity Cost Allocation
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  allocation_method text DEFAULT 'percentage'
    CHECK (allocation_method IN (
      'fixed_amount', 'percentage', 'pro_rata_revenue', 'pro_rata_headcount',
      'pro_rata_sqft', 'manual'
    )),
  allocation_pct numeric(7,4) DEFAULT 0,
  allocated_amount numeric(19,4) DEFAULT 0,

  period_month integer CHECK (period_month BETWEEN 1 AND 12),
  period_year integer,

  gl_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_allocations_policy ON insurance_allocations(policy_id);
CREATE INDEX idx_insurance_allocations_entity ON insurance_allocations(target_entity_id);

ALTER TABLE insurance_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance allocations"
  ON insurance_allocations FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance allocations"
  ON insurance_allocations FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_allocations_updated_at
  BEFORE UPDATE ON insurance_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 9. insurance_claims — Claims Tracking
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  claim_number text,
  date_of_loss date,
  date_reported date,
  claimant_name text,
  description text,

  status text DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'reopened', 'denied', 'reserved', 'subrogation')),

  amount_reserved numeric(19,4) DEFAULT 0,
  amount_paid numeric(19,4) DEFAULT 0,
  amount_recovered numeric(19,4) DEFAULT 0,

  adjuster_name text,
  adjuster_contact text,

  location_id uuid REFERENCES insurance_locations(id) ON DELETE SET NULL,

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_claims_policy ON insurance_claims(policy_id);
CREATE INDEX idx_insurance_claims_entity ON insurance_claims(entity_id);
CREATE INDEX idx_insurance_claims_status ON insurance_claims(status)
  WHERE status NOT IN ('closed', 'denied');

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance claims"
  ON insurance_claims FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage insurance claims"
  ON insurance_claims FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

CREATE TRIGGER update_insurance_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 10. insurance_documents — Document Storage References
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid REFERENCES insurance_policies(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  document_type text DEFAULT 'other'
    CHECK (document_type IN (
      'proposal', 'policy', 'endorsement', 'certificate', 'invoice',
      'claim', 'renewal', 'binder', 'dec_page', 'other'
    )),
  file_name text NOT NULL,
  file_path text,
  storage_key text,
  file_size_bytes bigint,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,

  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_documents_policy ON insurance_documents(policy_id);
CREATE INDEX idx_insurance_documents_entity ON insurance_documents(entity_id);

ALTER TABLE insurance_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance documents"
  ON insurance_documents FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage insurance documents"
  ON insurance_documents FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- ---------------------------------------------------------------------------
-- 11. insurance_exclusions — Policy Exclusions
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  exclusion_name text NOT NULL,
  is_excluded boolean DEFAULT true,
  exception_description text,
  sort_order integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_exclusions_policy ON insurance_exclusions(policy_id);

ALTER TABLE insurance_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance exclusions"
  ON insurance_exclusions FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance exclusions"
  ON insurance_exclusions FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_exclusions_updated_at
  BEFORE UPDATE ON insurance_exclusions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 12. insurance_subjectivities — Binding Conditions
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_subjectivities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  description text NOT NULL,
  due_date date,

  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'waived', 'overdue')),
  completed_date date,
  completed_by text,

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_insurance_subjectivities_policy ON insurance_subjectivities(policy_id);
CREATE INDEX idx_insurance_subjectivities_pending ON insurance_subjectivities(due_date)
  WHERE status IN ('pending', 'overdue');

ALTER TABLE insurance_subjectivities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insurance subjectivities"
  ON insurance_subjectivities FOR SELECT
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE p.entity_id IN (SELECT public.user_entity_ids())
  ));

CREATE POLICY "Admins/controllers can manage insurance subjectivities"
  ON insurance_subjectivities FOR ALL
  USING (policy_id IN (
    SELECT p.id FROM insurance_policies p
    WHERE public.user_entity_role(p.entity_id) IN ('admin', 'controller')
  ));

CREATE TRIGGER update_insurance_subjectivities_updated_at
  BEFORE UPDATE ON insurance_subjectivities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket for insurance documents
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('insurance-documents', 'insurance-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload insurance docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'insurance-documents');

CREATE POLICY "Authenticated users can read insurance docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'insurance-documents');

CREATE POLICY "Authenticated users can delete insurance docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'insurance-documents');
