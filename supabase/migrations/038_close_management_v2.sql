-- ============================================================================
-- 038: Close Management V2 — Phases, Auto-Discovery, Gate Checks
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add phase + source_module to close_task_templates
-- ---------------------------------------------------------------------------

ALTER TABLE close_task_templates
  ADD COLUMN IF NOT EXISTS phase int NOT NULL DEFAULT 3
    CHECK (phase BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS source_module text;

COMMENT ON COLUMN close_task_templates.phase IS
  '1=Pre-Close, 2=Adjustments, 3=Reconciliations, 4=Review & Reporting';
COMMENT ON COLUMN close_task_templates.source_module IS
  'Links template to a module: debt, assets, leases, payroll, intercompany, schedules, tb, financial_statements';

-- ---------------------------------------------------------------------------
-- 2. Add phase + source linkage to close_tasks
-- ---------------------------------------------------------------------------

ALTER TABLE close_tasks
  ADD COLUMN IF NOT EXISTS phase int NOT NULL DEFAULT 3
    CHECK (phase BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS source_module text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS is_auto_generated boolean DEFAULT false;

COMMENT ON COLUMN close_tasks.phase IS
  '1=Pre-Close, 2=Adjustments, 3=Reconciliations, 4=Review & Reporting';
COMMENT ON COLUMN close_tasks.source_module IS
  'Module that auto-generated this task (null = template-based)';
COMMENT ON COLUMN close_tasks.source_record_id IS
  'FK to the specific source record (debt_instrument, lease, etc.)';

CREATE INDEX IF NOT EXISTS idx_close_tasks_phase
  ON close_tasks(close_period_id, phase);
CREATE INDEX IF NOT EXISTS idx_close_tasks_source
  ON close_tasks(source_module, source_record_id);

-- ---------------------------------------------------------------------------
-- 3. New table: close_gate_checks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS close_gate_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_period_id uuid NOT NULL REFERENCES close_periods(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passed', 'failed', 'warning', 'skipped')),
  is_critical boolean DEFAULT true,
  result_data jsonb DEFAULT '{}',
  checked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (close_period_id, check_type)
);

CREATE INDEX IF NOT EXISTS idx_gate_checks_period
  ON close_gate_checks(close_period_id);

-- RLS
ALTER TABLE close_gate_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view gate checks for their entities"
  ON close_gate_checks FOR SELECT USING (
    close_period_id IN (
      SELECT cp.id FROM close_periods cp
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid()
    )
  );

CREATE POLICY "Controllers can manage gate checks"
  ON close_gate_checks FOR ALL USING (
    close_period_id IN (
      SELECT cp.id FROM close_periods cp
      JOIN entity_members em ON em.entity_id = cp.entity_id
      WHERE em.user_id = auth.uid()
        AND em.role IN ('admin', 'controller')
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_close_gate_checks_updated_at
  BEFORE UPDATE ON close_gate_checks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
