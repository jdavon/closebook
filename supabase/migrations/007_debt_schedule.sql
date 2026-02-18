-- ============================================================================
-- DEBT SCHEDULE MODULE
-- Tracks term loans and lines of credit with auto-generated amortization
-- ============================================================================

-- Debt instrument register — stores individual loans and LOCs
CREATE TABLE debt_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Instrument identification
  instrument_name text NOT NULL,
  lender_name text,
  debt_type text NOT NULL CHECK (debt_type IN ('term_loan', 'line_of_credit')),

  -- Term loan fields
  original_amount numeric(19,4) NOT NULL DEFAULT 0,
  interest_rate numeric(8,6) NOT NULL DEFAULT 0,   -- annual rate as decimal (0.065 = 6.5%)
  term_months int,
  start_date date NOT NULL,
  maturity_date date,
  payment_amount numeric(19,4),
  payment_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (payment_frequency IN ('monthly')),

  -- Line of credit fields
  credit_limit numeric(19,4),
  current_draw numeric(19,4) DEFAULT 0,

  -- GL account linkage
  liability_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  interest_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,

  -- Fixed asset linkage (optional — for asset-backed debt)
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,

  -- Status
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paid_off', 'inactive')),

  -- Upload tracking
  source_file_name text,
  uploaded_at timestamptz,

  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Monthly amortization entries for each instrument
CREATE TABLE debt_amortization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_instrument_id uuid NOT NULL REFERENCES debt_instruments(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  beginning_balance numeric(19,4) NOT NULL DEFAULT 0,
  payment numeric(19,4) NOT NULL DEFAULT 0,
  principal numeric(19,4) NOT NULL DEFAULT 0,
  interest numeric(19,4) NOT NULL DEFAULT 0,
  ending_balance numeric(19,4) NOT NULL DEFAULT 0,

  is_manual_override boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (debt_instrument_id, period_year, period_month)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_debt_instruments_entity ON debt_instruments(entity_id);
CREATE INDEX idx_debt_instruments_status ON debt_instruments(entity_id, status);
CREATE INDEX idx_debt_instruments_liability_account ON debt_instruments(liability_account_id);
CREATE INDEX idx_debt_instruments_interest_account ON debt_instruments(interest_expense_account_id);
CREATE INDEX idx_debt_instruments_fixed_asset ON debt_instruments(fixed_asset_id);
CREATE INDEX idx_debt_amortization_instrument ON debt_amortization(debt_instrument_id);
CREATE INDEX idx_debt_amortization_period ON debt_amortization(debt_instrument_id, period_year, period_month);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE debt_instruments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view debt instruments" ON debt_instruments FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

CREATE POLICY "Users can manage debt instruments" ON debt_instruments FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

ALTER TABLE debt_amortization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view amortization" ON debt_amortization FOR SELECT USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di WHERE di.entity_id IN (SELECT public.user_entity_ids())
  )
);

CREATE POLICY "Users can manage amortization" ON debt_amortization FOR ALL USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di
    WHERE public.user_entity_role(di.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_debt_instruments_updated_at
  BEFORE UPDATE ON debt_instruments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_debt_amortization_updated_at
  BEFORE UPDATE ON debt_amortization
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
