-- Migration: Revenue Accruals & Deferrals
-- Tracks earned vs billed revenue per rental contract per period
-- Accrual = earned but not billed; Deferral = billed but not earned

-- 1. Revenue Schedules (one per period per entity)
CREATE TABLE revenue_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  source_file_name text,
  source_file_path text,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz,
  total_accrued_revenue numeric(19,4) NOT NULL DEFAULT 0,
  total_deferred_revenue numeric(19,4) NOT NULL DEFAULT 0,
  total_earned_revenue numeric(19,4) NOT NULL DEFAULT 0,
  total_billed_revenue numeric(19,4) NOT NULL DEFAULT 0,
  accrued_account_id uuid REFERENCES accounts(id),
  deferred_account_id uuid REFERENCES accounts(id),
  revenue_account_id uuid REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, period_year, period_month)
);

-- 2. Revenue Line Items (one per rental contract)
CREATE TABLE revenue_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES revenue_schedules(id) ON DELETE CASCADE,
  contract_id text,
  customer_name text,
  description text,
  rental_start date,
  rental_end date,
  total_contract_value numeric(19,4) NOT NULL DEFAULT 0,
  daily_rate numeric(19,4) NOT NULL DEFAULT 0,
  days_in_period int NOT NULL DEFAULT 0,
  earned_revenue numeric(19,4) NOT NULL DEFAULT 0,
  billed_amount numeric(19,4) NOT NULL DEFAULT 0,
  accrual_amount numeric(19,4) NOT NULL DEFAULT 0,
  deferral_amount numeric(19,4) NOT NULL DEFAULT 0,
  row_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_revenue_line_items_schedule ON revenue_line_items(schedule_id, row_order);
CREATE INDEX idx_revenue_schedules_entity_period ON revenue_schedules(entity_id, period_year, period_month);

-- 3. RLS Policies
ALTER TABLE revenue_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_line_items ENABLE ROW LEVEL SECURITY;

-- Revenue schedules: users can view if they have entity access
CREATE POLICY "Users can view revenue schedules in their entities"
  ON revenue_schedules FOR SELECT
  USING (entity_id IN (SELECT user_entity_ids()));

-- Revenue schedules: admin/controller/preparer can manage
CREATE POLICY "Users can manage revenue schedules"
  ON revenue_schedules FOR ALL
  USING (user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));

-- Revenue line items: view if parent schedule is viewable
CREATE POLICY "Users can view revenue line items"
  ON revenue_line_items FOR SELECT
  USING (schedule_id IN (
    SELECT id FROM revenue_schedules
    WHERE entity_id IN (SELECT user_entity_ids())
  ));

-- Revenue line items: manage if parent schedule is manageable
CREATE POLICY "Users can manage revenue line items"
  ON revenue_line_items FOR ALL
  USING (schedule_id IN (
    SELECT id FROM revenue_schedules
    WHERE user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
  ));
