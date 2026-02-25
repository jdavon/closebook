-- Migration 016: Allocation adjustments for inter-entity cost transfers
-- Allows users to move costs from one entity to another.
-- Supports single-month or monthly-spread schedules.

CREATE TABLE allocation_adjustments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_entity_id        uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  destination_entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  master_account_id       uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  amount                  numeric(19,4) NOT NULL DEFAULT 0,
  description             text NOT NULL,
  notes                   text,
  is_excluded             boolean NOT NULL DEFAULT false,

  -- Schedule type: single month or spread across a range
  schedule_type           text NOT NULL DEFAULT 'single_month'
                          CHECK (schedule_type IN ('single_month', 'monthly_spread')),

  -- For single_month schedule
  period_year             int,
  period_month            int CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),

  -- For monthly_spread schedule
  start_year              int,
  start_month             int CHECK (start_month IS NULL OR start_month BETWEEN 1 AND 12),
  end_year                int,
  end_month               int CHECK (end_month IS NULL OR end_month BETWEEN 1 AND 12),

  -- Metadata
  created_by              uuid REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Source and destination must be different entities
  CONSTRAINT chk_different_entities CHECK (source_entity_id != destination_entity_id),

  -- Single month requires period fields
  CONSTRAINT chk_single_month_period CHECK (
    schedule_type != 'single_month' OR (period_year IS NOT NULL AND period_month IS NOT NULL)
  ),

  -- Monthly spread requires start/end fields
  CONSTRAINT chk_spread_period CHECK (
    schedule_type != 'monthly_spread' OR (
      start_year IS NOT NULL AND start_month IS NOT NULL AND
      end_year IS NOT NULL AND end_month IS NOT NULL
    )
  )
);

-- Indexes
CREATE INDEX idx_alloc_adj_org
  ON allocation_adjustments(organization_id);
CREATE INDEX idx_alloc_adj_source
  ON allocation_adjustments(source_entity_id, period_year, period_month);
CREATE INDEX idx_alloc_adj_destination
  ON allocation_adjustments(destination_entity_id, period_year, period_month);
CREATE INDEX idx_alloc_adj_master_account
  ON allocation_adjustments(master_account_id);
CREATE INDEX idx_alloc_adj_not_excluded
  ON allocation_adjustments(organization_id, is_excluded)
  WHERE is_excluded = false;

-- RLS
ALTER TABLE allocation_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view allocation adjustments"
  ON allocation_adjustments FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
  );

CREATE POLICY "Admins and controllers can insert allocation adjustments"
  ON allocation_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can update allocation adjustments"
  ON allocation_adjustments FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can delete allocation adjustments"
  ON allocation_adjustments FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_allocation_adjustments_updated_at
  BEFORE UPDATE ON allocation_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
