-- ============================================================================
-- FIXED ASSETS MODULE (Vehicle-Focused)
-- ============================================================================

-- Fixed asset register — stores individual vehicle assets with book and tax basis
CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Asset identification
  asset_name text NOT NULL,
  asset_tag text,

  -- Vehicle-specific fields
  vehicle_year int,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  vin text,
  license_plate text,
  license_state text,
  mileage_at_acquisition int,
  vehicle_type text CHECK (vehicle_type IS NULL OR vehicle_type IN (
    'sedan', 'suv', 'truck', 'van', 'heavy_truck', 'trailer', 'other'
  )),
  title_number text,
  registration_expiry date,
  vehicle_notes text,

  -- Book basis
  acquisition_date date NOT NULL,
  acquisition_cost numeric(19,4) NOT NULL,
  in_service_date date NOT NULL,
  book_useful_life_months int NOT NULL DEFAULT 60,
  book_salvage_value numeric(19,4) DEFAULT 0,
  book_depreciation_method text NOT NULL DEFAULT 'straight_line'
    CHECK (book_depreciation_method IN ('straight_line', 'declining_balance', 'none')),
  book_accumulated_depreciation numeric(19,4) DEFAULT 0,
  book_net_value numeric(19,4) GENERATED ALWAYS AS (acquisition_cost - book_accumulated_depreciation) STORED,

  -- Tax basis
  tax_cost_basis numeric(19,4),
  tax_depreciation_method text NOT NULL DEFAULT 'macrs_5'
    CHECK (tax_depreciation_method IN (
      'macrs_5', 'macrs_7', 'macrs_10',
      'section_179', 'bonus_100', 'bonus_80', 'bonus_60',
      'straight_line_tax', 'none'
    )),
  tax_useful_life_months int DEFAULT 60,
  tax_accumulated_depreciation numeric(19,4) DEFAULT 0,
  tax_net_value numeric(19,4) GENERATED ALWAYS AS (
    COALESCE(tax_cost_basis, acquisition_cost) - tax_accumulated_depreciation
  ) STORED,
  section_179_amount numeric(19,4) DEFAULT 0,
  bonus_depreciation_amount numeric(19,4) DEFAULT 0,

  -- GL account linkage
  cost_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  accum_depr_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  depr_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,

  -- Status and disposition
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disposed', 'fully_depreciated', 'inactive')),
  disposed_date date,
  disposed_sale_price numeric(19,4),
  disposed_book_gain_loss numeric(19,4),
  disposed_tax_gain_loss numeric(19,4),
  disposition_method text CHECK (disposition_method IS NULL OR disposition_method IN (
    'sale', 'trade_in', 'scrap', 'theft', 'casualty', 'donation'
  )),

  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Monthly depreciation entries for each asset (book and tax)
CREATE TABLE fixed_asset_depreciation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,

  book_depreciation numeric(19,4) NOT NULL DEFAULT 0,
  book_accumulated numeric(19,4) NOT NULL DEFAULT 0,
  book_net_value numeric(19,4) NOT NULL DEFAULT 0,

  tax_depreciation numeric(19,4) NOT NULL DEFAULT 0,
  tax_accumulated numeric(19,4) NOT NULL DEFAULT 0,
  tax_net_value numeric(19,4) NOT NULL DEFAULT 0,

  is_manual_override boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (fixed_asset_id, period_year, period_month)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_fixed_assets_entity ON fixed_assets(entity_id);
CREATE INDEX idx_fixed_assets_status ON fixed_assets(entity_id, status);
CREATE INDEX idx_fixed_assets_cost_account ON fixed_assets(cost_account_id);
CREATE INDEX idx_fixed_assets_accum_depr_account ON fixed_assets(accum_depr_account_id);
CREATE INDEX idx_fixed_asset_depr_asset ON fixed_asset_depreciation(fixed_asset_id);
CREATE INDEX idx_fixed_asset_depr_period ON fixed_asset_depreciation(fixed_asset_id, period_year, period_month);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fixed assets" ON fixed_assets FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Users can manage fixed assets" ON fixed_assets FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

ALTER TABLE fixed_asset_depreciation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view depreciation" ON fixed_asset_depreciation FOR SELECT USING (
  fixed_asset_id IN (
    SELECT fa.id FROM fixed_assets fa WHERE fa.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage depreciation" ON fixed_asset_depreciation FOR ALL USING (
  fixed_asset_id IN (
    SELECT fa.id FROM fixed_assets fa
    WHERE public.user_entity_role(fa.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_fixed_assets_updated_at
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_fixed_asset_depreciation_updated_at
  BEFORE UPDATE ON fixed_asset_depreciation
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
