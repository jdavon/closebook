-- ============================================================================
-- DEBT SCHEDULE V2 — ERP-grade enhancements
-- Adds: loan numbers, variable rate support, rate history, transaction ledger,
--       payment structures, day count conventions, current/LT classification,
--       covenant tracking, collateral, and fee tracking
-- ============================================================================

-- ============================================================================
-- 1. ALTER debt_instruments — add new fields
-- ============================================================================

-- Loan identification
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS loan_number text;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS external_account_number text;

-- Expanded debt types
ALTER TABLE debt_instruments DROP CONSTRAINT IF EXISTS debt_instruments_debt_type_check;
ALTER TABLE debt_instruments ADD CONSTRAINT debt_instruments_debt_type_check
  CHECK (debt_type IN (
    'term_loan', 'line_of_credit', 'revolving_credit',
    'mortgage', 'equipment_loan', 'balloon_loan',
    'bridge_loan', 'sba_loan', 'other'
  ));

-- Rate structure
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'fixed'
  CHECK (rate_type IN ('fixed', 'variable', 'adjustable'));
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS index_rate_name text;  -- e.g. "Prime", "SOFR", "LIBOR"
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS spread_margin numeric(8,6) DEFAULT 0; -- margin over index
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS rate_floor numeric(8,6);  -- minimum rate
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS rate_ceiling numeric(8,6); -- maximum rate
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS rate_reset_frequency text
  CHECK (rate_reset_frequency IS NULL OR rate_reset_frequency IN ('daily', 'monthly', 'quarterly', 'semi_annual', 'annual'));
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS next_rate_reset_date date;

-- Payment structure
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS payment_structure text NOT NULL DEFAULT 'principal_and_interest'
  CHECK (payment_structure IN (
    'principal_and_interest', 'interest_only', 'balloon',
    'custom', 'revolving'
  ));
ALTER TABLE debt_instruments DROP CONSTRAINT IF EXISTS debt_instruments_payment_frequency_check;
ALTER TABLE debt_instruments ADD CONSTRAINT debt_instruments_payment_frequency_check
  CHECK (payment_frequency IN ('monthly', 'quarterly', 'semi_annual', 'annual', 'on_demand'));
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS balloon_amount numeric(19,4);
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS balloon_date date;

-- Interest calculation
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS day_count_convention text NOT NULL DEFAULT '30/360'
  CHECK (day_count_convention IN ('30/360', 'actual/360', 'actual/365', 'actual/actual'));

-- Origination & fees
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS origination_date date;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS origination_fee numeric(19,4) DEFAULT 0;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS origination_fee_amortized boolean DEFAULT true;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS annual_fee numeric(19,4) DEFAULT 0;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS unused_line_fee_rate numeric(8,6) DEFAULT 0; -- for LOCs

-- Renewal tracking
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS is_renewable boolean DEFAULT false;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS last_renewal_date date;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS next_renewal_date date;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS renewal_term_months int;

-- Security / Collateral
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS is_secured boolean DEFAULT false;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS collateral_description text;

-- Classification helpers
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS current_portion numeric(19,4) DEFAULT 0;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS long_term_portion numeric(19,4) DEFAULT 0;

-- Additional GL linkage
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS current_liability_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS fee_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

-- Notes
ALTER TABLE debt_instruments ADD COLUMN IF NOT EXISTS notes text;

-- ============================================================================
-- 2. ALTER debt_amortization — add rate tracking per period
-- ============================================================================

ALTER TABLE debt_amortization ADD COLUMN IF NOT EXISTS interest_rate numeric(8,6);
ALTER TABLE debt_amortization ADD COLUMN IF NOT EXISTS fees numeric(19,4) NOT NULL DEFAULT 0;
ALTER TABLE debt_amortization ADD COLUMN IF NOT EXISTS cumulative_principal numeric(19,4) NOT NULL DEFAULT 0;
ALTER TABLE debt_amortization ADD COLUMN IF NOT EXISTS cumulative_interest numeric(19,4) NOT NULL DEFAULT 0;

-- ============================================================================
-- 3. NEW TABLE: debt_rate_history — tracks variable rate changes over time
-- ============================================================================

CREATE TABLE IF NOT EXISTS debt_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_instrument_id uuid NOT NULL REFERENCES debt_instruments(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  interest_rate numeric(8,6) NOT NULL, -- new annual rate as decimal
  index_rate numeric(8,6),            -- the index portion (e.g. Prime rate)
  spread numeric(8,6),                -- the spread/margin portion
  change_reason text,                 -- e.g. "Note Renewal", "Index Adjustment", "Rate Reset"
  notes text,
  created_at timestamptz DEFAULT now(),

  UNIQUE (debt_instrument_id, effective_date)
);

-- ============================================================================
-- 4. NEW TABLE: debt_transactions — draws, payments, fees, adjustments
-- ============================================================================

CREATE TABLE IF NOT EXISTS debt_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_instrument_id uuid NOT NULL REFERENCES debt_instruments(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  effective_date date NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'advance', 'principal_payment', 'interest_payment', 'fee_payment',
    'late_fee', 'misc_fee', 'origination_fee', 'annual_fee',
    'payment_reversal', 'note_renewal', 'payoff', 'adjustment'
  )),
  amount numeric(19,4) NOT NULL,       -- positive for draws/fees, negative for payments
  to_principal numeric(19,4) DEFAULT 0,
  to_interest numeric(19,4) DEFAULT 0,
  to_fees numeric(19,4) DEFAULT 0,
  running_balance numeric(19,4),        -- balance after this transaction
  reference_number text,                -- check number, wire reference, etc.
  description text,
  statement_date date,                  -- bank statement date this appeared on
  is_reconciled boolean DEFAULT false,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 5. NEW TABLE: debt_covenants — financial covenant tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS debt_covenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_instrument_id uuid NOT NULL REFERENCES debt_instruments(id) ON DELETE CASCADE,
  covenant_name text NOT NULL,          -- e.g. "Debt Service Coverage Ratio"
  covenant_type text NOT NULL CHECK (covenant_type IN (
    'financial_ratio', 'reporting', 'operational', 'negative', 'affirmative'
  )),
  description text,
  threshold_value numeric(19,4),        -- required ratio or amount
  threshold_operator text CHECK (threshold_operator IN ('>=', '<=', '>', '<', '=')),
  measurement_frequency text DEFAULT 'quarterly'
    CHECK (measurement_frequency IN ('monthly', 'quarterly', 'semi_annual', 'annual')),
  next_measurement_date date,
  last_measured_value numeric(19,4),
  last_measured_date date,
  is_in_compliance boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_debt_instruments_loan_number ON debt_instruments(loan_number);
CREATE INDEX IF NOT EXISTS idx_debt_rate_history_instrument ON debt_rate_history(debt_instrument_id);
CREATE INDEX IF NOT EXISTS idx_debt_rate_history_date ON debt_rate_history(debt_instrument_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_debt_transactions_instrument ON debt_transactions(debt_instrument_id);
CREATE INDEX IF NOT EXISTS idx_debt_transactions_date ON debt_transactions(debt_instrument_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_debt_transactions_type ON debt_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_debt_covenants_instrument ON debt_covenants(debt_instrument_id);
CREATE INDEX IF NOT EXISTS idx_debt_instruments_current_liability ON debt_instruments(current_liability_account_id);

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE debt_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_covenants ENABLE ROW LEVEL SECURITY;

-- Rate History
CREATE POLICY "Users can view rate history" ON debt_rate_history FOR SELECT USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di WHERE di.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Users can manage rate history" ON debt_rate_history FOR ALL USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di
    WHERE public.user_entity_role(di.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Transactions
CREATE POLICY "Users can view debt transactions" ON debt_transactions FOR SELECT USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di WHERE di.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Users can manage debt transactions" ON debt_transactions FOR ALL USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di
    WHERE public.user_entity_role(di.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- Covenants
CREATE POLICY "Users can view covenants" ON debt_covenants FOR SELECT USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di WHERE di.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Users can manage covenants" ON debt_covenants FOR ALL USING (
  debt_instrument_id IN (
    SELECT di.id FROM debt_instruments di
    WHERE public.user_entity_role(di.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- ============================================================================
-- 8. TRIGGERS
-- ============================================================================

CREATE TRIGGER update_debt_transactions_updated_at
  BEFORE UPDATE ON debt_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_debt_covenants_updated_at
  BEFORE UPDATE ON debt_covenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
