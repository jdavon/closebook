-- ============================================================================
-- COMMERCIAL EXCLUSIVE REBATE TRACKER
-- ============================================================================

-- Rebate customers: one row per exclusive agreement customer
CREATE TABLE rebate_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  rw_customer_id text NOT NULL,
  agreement_type text NOT NULL CHECK (agreement_type IN ('commercial', 'freelancer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  tax_rate numeric(5,2) NOT NULL DEFAULT 9.75,
  max_discount_percent numeric(5,2),
  effective_date date,
  use_global_exclusions boolean DEFAULT true,
  contract_storage_path text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, rw_customer_id)
);

-- Rebate tiers: volume-based rate tiers per customer
CREATE TABLE rebate_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rebate_customer_id uuid NOT NULL REFERENCES rebate_customers(id) ON DELETE CASCADE,
  label text NOT NULL,
  threshold_min numeric(19,2) NOT NULL DEFAULT 0,
  threshold_max numeric(19,2),
  sort_order int NOT NULL DEFAULT 0,
  rate_pro_supplies numeric(5,2) NOT NULL DEFAULT 0,
  rate_vehicle numeric(5,2) NOT NULL DEFAULT 0,
  rate_grip_lighting numeric(5,2) NOT NULL DEFAULT 0,
  rate_studio numeric(5,2) NOT NULL DEFAULT 0,
  max_disc_pro_supplies numeric(5,2) NOT NULL DEFAULT 0,
  max_disc_vehicle numeric(5,2) NOT NULL DEFAULT 0,
  max_disc_grip_lighting numeric(5,2) NOT NULL DEFAULT 0,
  max_disc_studio numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Excluded I-Codes: global (rebate_customer_id IS NULL) or per-customer
CREATE TABLE rebate_excluded_icodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rebate_customer_id uuid REFERENCES rebate_customers(id) ON DELETE CASCADE,
  i_code text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Unique index that handles NULL rebate_customer_id for global exclusions
CREATE UNIQUE INDEX idx_rebate_excluded_icodes_unique
  ON rebate_excluded_icodes (entity_id, COALESCE(rebate_customer_id, '00000000-0000-0000-0000-000000000000'::uuid), i_code);

-- Cached invoice data from RentalWorks
CREATE TABLE rebate_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rebate_customer_id uuid NOT NULL REFERENCES rebate_customers(id) ON DELETE CASCADE,
  rw_invoice_id text NOT NULL,
  invoice_number text NOT NULL,
  invoice_date date,
  billing_start_date date,
  billing_end_date date,
  status text,
  customer_name text,
  deal text,
  order_number text,
  order_description text,
  purchase_order_number text,
  -- Financial amounts from RW
  list_total numeric(19,4) NOT NULL DEFAULT 0,
  gross_total numeric(19,4) NOT NULL DEFAULT 0,
  sub_total numeric(19,4) NOT NULL DEFAULT 0,
  tax_amount numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount numeric(19,4) NOT NULL DEFAULT 0,
  -- Equipment classification
  equipment_type text NOT NULL DEFAULT 'pro_supplies'
    CHECK (equipment_type IN ('pro_supplies', 'vehicle', 'grip_lighting', 'studio')),
  -- Calculated rebate fields
  excluded_total numeric(19,4) DEFAULT 0,
  taxable_sales numeric(19,4) DEFAULT 0,
  before_discount numeric(19,4) DEFAULT 0,
  discount_percent numeric(7,4) DEFAULT 0,
  final_amount numeric(19,4) DEFAULT 0,
  tier_label text,
  rebate_rate numeric(7,4) DEFAULT 0,
  remaining_rebate_pct numeric(7,4) DEFAULT 0,
  net_rebate numeric(19,4) DEFAULT 0,
  cumulative_revenue numeric(19,4) DEFAULT 0,
  cumulative_rebate numeric(19,4) DEFAULT 0,
  quarter text,
  -- Manual overrides
  is_manually_excluded boolean DEFAULT false,
  manual_exclusion_reason text,
  -- Sync tracking
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, rw_invoice_id)
);

-- Cached invoice line items for I-Code exclusion matching
CREATE TABLE rebate_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rebate_invoice_id uuid NOT NULL REFERENCES rebate_invoices(id) ON DELETE CASCADE,
  rw_item_id text,
  i_code text,
  description text,
  quantity numeric(19,4) DEFAULT 0,
  extended numeric(19,4) DEFAULT 0,
  is_excluded boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Quarterly summary aggregates
CREATE TABLE rebate_quarterly_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rebate_customer_id uuid NOT NULL REFERENCES rebate_customers(id) ON DELETE CASCADE,
  quarter text NOT NULL,
  year int NOT NULL,
  quarter_num int NOT NULL,
  total_revenue numeric(19,4) DEFAULT 0,
  total_rebate numeric(19,4) DEFAULT 0,
  invoice_count int DEFAULT 0,
  tier_label text,
  is_paid boolean DEFAULT false,
  paid_at timestamptz,
  paid_by uuid REFERENCES profiles(id),
  calculated_at timestamptz DEFAULT now(),
  UNIQUE (rebate_customer_id, quarter)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_rebate_customers_entity ON rebate_customers(entity_id);
CREATE INDEX idx_rebate_customers_rw_id ON rebate_customers(rw_customer_id);
CREATE INDEX idx_rebate_tiers_customer ON rebate_tiers(rebate_customer_id);
CREATE INDEX idx_rebate_excluded_icodes_entity ON rebate_excluded_icodes(entity_id);
CREATE INDEX idx_rebate_excluded_icodes_customer ON rebate_excluded_icodes(rebate_customer_id);
CREATE INDEX idx_rebate_invoices_entity ON rebate_invoices(entity_id);
CREATE INDEX idx_rebate_invoices_customer ON rebate_invoices(rebate_customer_id);
CREATE INDEX idx_rebate_invoices_quarter ON rebate_invoices(quarter);
CREATE INDEX idx_rebate_invoices_rw_id ON rebate_invoices(rw_invoice_id);
CREATE INDEX idx_rebate_invoice_items_invoice ON rebate_invoice_items(rebate_invoice_id);
CREATE INDEX idx_rebate_invoice_items_icode ON rebate_invoice_items(i_code);
CREATE INDEX idx_rebate_quarterly_entity ON rebate_quarterly_summaries(entity_id);
CREATE INDEX idx_rebate_quarterly_customer ON rebate_quarterly_summaries(rebate_customer_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER update_rebate_customers_updated_at
  BEFORE UPDATE ON rebate_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- rebate_customers
ALTER TABLE rebate_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view rebate customers in their entities"
  ON rebate_customers FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage rebate customers"
  ON rebate_customers FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- rebate_tiers
ALTER TABLE rebate_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view rebate tiers in their entities"
  ON rebate_tiers FOR SELECT
  USING (rebate_customer_id IN (
    SELECT id FROM rebate_customers WHERE entity_id IN (SELECT public.user_entity_ids())
  ));
CREATE POLICY "Admins/controllers can manage rebate tiers"
  ON rebate_tiers FOR ALL
  USING (rebate_customer_id IN (
    SELECT id FROM rebate_customers
    WHERE public.user_entity_role(entity_id) IN ('admin', 'controller')
  ));

-- rebate_excluded_icodes
ALTER TABLE rebate_excluded_icodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view excluded icodes in their entities"
  ON rebate_excluded_icodes FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage excluded icodes"
  ON rebate_excluded_icodes FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- rebate_invoices
ALTER TABLE rebate_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view rebate invoices in their entities"
  ON rebate_invoices FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage rebate invoices"
  ON rebate_invoices FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- rebate_invoice_items
ALTER TABLE rebate_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view rebate invoice items in their entities"
  ON rebate_invoice_items FOR SELECT
  USING (rebate_invoice_id IN (
    SELECT id FROM rebate_invoices WHERE entity_id IN (SELECT public.user_entity_ids())
  ));
CREATE POLICY "Admins/controllers can manage rebate invoice items"
  ON rebate_invoice_items FOR ALL
  USING (rebate_invoice_id IN (
    SELECT id FROM rebate_invoices
    WHERE public.user_entity_role(entity_id) IN ('admin', 'controller')
  ));

-- rebate_quarterly_summaries
ALTER TABLE rebate_quarterly_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view rebate quarterly summaries in their entities"
  ON rebate_quarterly_summaries FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Admins/controllers can manage rebate quarterly summaries"
  ON rebate_quarterly_summaries FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- ============================================================================
-- STORAGE BUCKET
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('rebate-contracts', 'rebate-contracts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view rebate contracts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'rebate-contracts');

CREATE POLICY "Admins can upload rebate contracts"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rebate-contracts');

CREATE POLICY "Admins can update rebate contracts"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'rebate-contracts');

CREATE POLICY "Admins can delete rebate contracts"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'rebate-contracts');
