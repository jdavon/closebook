-- ============================================================================
-- 039: Close Management V3 — Materiality, Soft/Hard Close, Reconciliation Templates
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Materiality Thresholds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS materiality_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  -- Threshold can be a fixed dollar amount, a percentage of the account balance, or both
  threshold_amount numeric(19,2),
  threshold_percentage numeric(8,4),
  -- Apply to specific categories or all
  applies_to_category text,  -- null = all categories
  applies_to_phase int CHECK (applies_to_phase IS NULL OR applies_to_phase BETWEEN 1 AND 4),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materiality_thresholds_org
  ON materiality_thresholds(organization_id);

ALTER TABLE materiality_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org materiality thresholds"
  ON materiality_thresholds FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage materiality thresholds"
  ON materiality_thresholds FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE TRIGGER update_materiality_thresholds_updated_at
  BEFORE UPDATE ON materiality_thresholds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Materiality Overrides (variance waivers on individual tasks)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS materiality_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_task_id uuid NOT NULL REFERENCES close_tasks(id) ON DELETE CASCADE,
  threshold_id uuid REFERENCES materiality_thresholds(id) ON DELETE SET NULL,
  variance_amount numeric(19,2),
  justification text NOT NULL,
  waived_by uuid REFERENCES auth.users(id),
  waived_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materiality_overrides_task
  ON materiality_overrides(close_task_id);

ALTER TABLE materiality_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view materiality overrides for their entities"
  ON materiality_overrides FOR SELECT USING (
    close_task_id IN (
      SELECT ct.id FROM close_tasks ct
      JOIN close_periods cp ON cp.id = ct.close_period_id
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid()
    )
  );

CREATE POLICY "Controllers can manage materiality overrides"
  ON materiality_overrides FOR ALL USING (
    close_task_id IN (
      SELECT ct.id FROM close_tasks ct
      JOIN close_periods cp ON cp.id = ct.close_period_id
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid() AND em.role IN ('admin', 'controller')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Extend close_tasks with materiality tracking
-- ---------------------------------------------------------------------------

ALTER TABLE close_tasks
  ADD COLUMN IF NOT EXISTS is_immaterial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS immaterial_reason text;

COMMENT ON COLUMN close_tasks.is_immaterial IS
  'True when task variance is below materiality threshold and has been waived';
COMMENT ON COLUMN close_tasks.immaterial_reason IS
  'Justification for marking variance as immaterial';

-- ---------------------------------------------------------------------------
-- 4. Soft/Hard Close — extend close_periods
-- ---------------------------------------------------------------------------

ALTER TABLE close_periods
  ADD COLUMN IF NOT EXISTS soft_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS soft_closed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS hard_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hard_closed_by uuid REFERENCES auth.users(id);

-- Update the status CHECK constraint to include soft_closed
-- (Postgres does not support ALTER CHECK directly, so we drop and recreate)
-- Note: existing "open", "in_progress", "review", "closed", "locked" values are preserved
-- Adding "soft_closed" between "review" and "closed"
ALTER TABLE close_periods DROP CONSTRAINT IF EXISTS close_periods_status_check;
ALTER TABLE close_periods ADD CONSTRAINT close_periods_status_check
  CHECK (status IN ('open', 'in_progress', 'review', 'soft_closed', 'closed', 'locked'));

COMMENT ON COLUMN close_periods.soft_closed_at IS
  'Timestamp when period entered soft-close (all tasks complete, awaiting final review)';
COMMENT ON COLUMN close_periods.hard_closed_at IS
  'Timestamp when period was hard-closed (immutable audit trail)';

-- ---------------------------------------------------------------------------
-- 5. Reconciliation Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reconciliation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  -- Template defines what fields the workpaper form should capture
  -- JSONB array of { fieldName, fieldLabel, fieldType, required }
  field_definitions jsonb NOT NULL DEFAULT '[]',
  -- Optional variance tolerance for this template
  variance_tolerance_amount numeric(19,2),
  variance_tolerance_percentage numeric(8,4),
  is_active boolean DEFAULT true,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_templates_org
  ON reconciliation_templates(organization_id);

ALTER TABLE reconciliation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org reconciliation templates"
  ON reconciliation_templates FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage reconciliation templates"
  ON reconciliation_templates FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE TRIGGER update_reconciliation_templates_updated_at
  BEFORE UPDATE ON reconciliation_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Reconciliation Workpapers (completed reconciliation data per task)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reconciliation_workpapers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_task_id uuid NOT NULL REFERENCES close_tasks(id) ON DELETE CASCADE,
  template_id uuid REFERENCES reconciliation_templates(id) ON DELETE SET NULL,
  -- Freeform workpaper data, captures values from template fields
  workpaper_data jsonb NOT NULL DEFAULT '{}',
  -- Summary
  gl_balance numeric(19,2),
  subledger_balance numeric(19,2),
  variance numeric(19,2),
  is_within_tolerance boolean DEFAULT false,
  -- Audit trail
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_workpapers_task
  ON reconciliation_workpapers(close_task_id);

ALTER TABLE reconciliation_workpapers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workpapers for their entities"
  ON reconciliation_workpapers FOR SELECT USING (
    close_task_id IN (
      SELECT ct.id FROM close_tasks ct
      JOIN close_periods cp ON cp.id = ct.close_period_id
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid()
    )
  );

CREATE POLICY "Preparers can manage workpapers for their entities"
  ON reconciliation_workpapers FOR ALL USING (
    close_task_id IN (
      SELECT ct.id FROM close_tasks ct
      JOIN close_periods cp ON cp.id = ct.close_period_id
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid()
    )
  );

CREATE TRIGGER update_reconciliation_workpapers_updated_at
  BEFORE UPDATE ON reconciliation_workpapers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Link close_tasks to reconciliation_template (optional)
-- ---------------------------------------------------------------------------

ALTER TABLE close_tasks
  ADD COLUMN IF NOT EXISTS reconciliation_template_id uuid REFERENCES reconciliation_templates(id) ON DELETE SET NULL;

ALTER TABLE close_task_templates
  ADD COLUMN IF NOT EXISTS reconciliation_template_id uuid REFERENCES reconciliation_templates(id) ON DELETE SET NULL;
