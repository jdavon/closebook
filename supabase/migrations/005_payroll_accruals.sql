-- Migration: Payroll Accruals (Paylocity Integration)
-- Tracks accrued wages, payroll taxes, PTO liability, and benefits per period

-- 1. Paylocity Connections (one per entity)
CREATE TABLE paylocity_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE UNIQUE,
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,
  access_token text,
  token_expires_at timestamptz,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('testing', 'production')),
  company_id text NOT NULL,
  connected_by uuid REFERENCES auth.users(id),
  last_sync_at timestamptz,
  sync_status text NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Payroll Accruals (period-level accrual records)
CREATE TABLE payroll_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  accrual_type text NOT NULL CHECK (accrual_type IN ('wages', 'payroll_tax', 'pto', 'benefits')),
  description text NOT NULL,
  amount numeric(19,4) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('paylocity_sync', 'manual')),
  payroll_sync_id uuid,
  account_id uuid REFERENCES accounts(id),
  offset_account_id uuid REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  reversal_period_year int,
  reversal_period_month int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, period_year, period_month, accrual_type, description)
);

-- 3. Payroll Sync Logs
CREATE TABLE payroll_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'error')),
  employees_synced int NOT NULL DEFAULT 0,
  accruals_generated int NOT NULL DEFAULT 0,
  error_message text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payroll_accruals_entity_period ON payroll_accruals(entity_id, period_year, period_month);
CREATE INDEX idx_payroll_sync_logs_entity ON payroll_sync_logs(entity_id, started_at DESC);

-- 4. RLS Policies
ALTER TABLE paylocity_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_sync_logs ENABLE ROW LEVEL SECURITY;

-- Paylocity connections
CREATE POLICY "Users can view paylocity connections in their entities"
  ON paylocity_connections FOR SELECT
  USING (entity_id IN (SELECT user_entity_ids()));

CREATE POLICY "Admins can manage paylocity connections"
  ON paylocity_connections FOR ALL
  USING (user_entity_role(entity_id) IN ('admin', 'controller'));

-- Payroll accruals
CREATE POLICY "Users can view payroll accruals in their entities"
  ON payroll_accruals FOR SELECT
  USING (entity_id IN (SELECT user_entity_ids()));

CREATE POLICY "Users can manage payroll accruals"
  ON payroll_accruals FOR ALL
  USING (user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));

-- Payroll sync logs
CREATE POLICY "Users can view payroll sync logs in their entities"
  ON payroll_sync_logs FOR SELECT
  USING (entity_id IN (SELECT user_entity_ids()));

CREATE POLICY "Users can manage payroll sync logs"
  ON payroll_sync_logs FOR ALL
  USING (user_entity_role(entity_id) IN ('admin', 'controller'));
