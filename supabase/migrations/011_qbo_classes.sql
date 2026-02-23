-- ============================================================================
-- QBO CLASSES + CLASS-LEVEL GL BALANCES
-- ============================================================================

-- QBO Class metadata synced from QuickBooks
CREATE TABLE qbo_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  qbo_id text NOT NULL,
  name text NOT NULL,
  fully_qualified_name text,
  is_active boolean DEFAULT true,
  parent_class_id uuid REFERENCES qbo_classes(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, qbo_id)
);

CREATE INDEX idx_qbo_classes_entity ON qbo_classes(entity_id);

CREATE TRIGGER update_qbo_classes_updated_at
  BEFORE UPDATE ON qbo_classes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- GL balances broken down by class (from P&L by Class report)
CREATE TABLE gl_class_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  qbo_class_id uuid NOT NULL REFERENCES qbo_classes(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  net_change numeric(19,4) DEFAULT 0,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, account_id, qbo_class_id, period_year, period_month)
);

CREATE INDEX idx_gl_class_balances_entity_period ON gl_class_balances(entity_id, period_year, period_month);
CREATE INDEX idx_gl_class_balances_account ON gl_class_balances(account_id);
CREATE INDEX idx_gl_class_balances_class ON gl_class_balances(qbo_class_id);

CREATE TRIGGER update_gl_class_balances_updated_at
  BEFORE UPDATE ON gl_class_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add optional class filter to commission account assignments
ALTER TABLE commission_account_assignments
  ADD COLUMN qbo_class_id uuid REFERENCES qbo_classes(id) ON DELETE SET NULL;

-- Replace the old unique constraint with one that handles NULL class IDs
-- (constraint name may be truncated, so look it up dynamically)
DO $$
DECLARE
  _con text;
BEGIN
  SELECT conname INTO _con
    FROM pg_constraint
   WHERE conrelid = 'commission_account_assignments'::regclass
     AND contype = 'u'
   LIMIT 1;

  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE commission_account_assignments DROP CONSTRAINT %I', _con);
  END IF;
END $$;

CREATE UNIQUE INDEX idx_commission_assignments_unique
  ON commission_account_assignments(
    commission_profile_id,
    account_id,
    COALESCE(qbo_class_id, '00000000-0000-0000-0000-000000000000')
  );

-- RLS for qbo_classes
ALTER TABLE qbo_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view classes in their entities"
  ON qbo_classes FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage classes"
  ON qbo_classes FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));

-- RLS for gl_class_balances
ALTER TABLE gl_class_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view class balances in their entities"
  ON gl_class_balances FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins/controllers can manage class balances"
  ON gl_class_balances FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller'));
