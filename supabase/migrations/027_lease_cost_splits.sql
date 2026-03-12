-- ============================================================
-- 027: Inter-Entity Lease Cost Splits
-- ============================================================
-- Allows leases owned by one entity (source) to have their costs
-- partially allocated to sibling entities (destination) within
-- the same organization. Supports percentage or fixed-amount splits.

CREATE TABLE lease_cost_splits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id              uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  source_entity_id      uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  destination_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  split_type            text NOT NULL DEFAULT 'percentage'
                        CHECK (split_type IN ('percentage', 'fixed_amount')),
  split_percentage      numeric(8,6),       -- 0.000001 to 0.999999 (e.g., 0.50 = 50%)
  split_fixed_amount    numeric(19,4),       -- Fixed dollar amount per month
  description           text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Source and destination must be different entities
  CONSTRAINT chk_different_entities CHECK (source_entity_id != destination_entity_id),
  -- Percentage is required when split_type = 'percentage'
  CONSTRAINT chk_pct_required CHECK (split_type != 'percentage' OR split_percentage IS NOT NULL),
  -- Fixed amount is required when split_type = 'fixed_amount'
  CONSTRAINT chk_amt_required CHECK (split_type != 'fixed_amount' OR split_fixed_amount IS NOT NULL),
  -- Percentage must be between 0 and 1 (exclusive)
  CONSTRAINT chk_pct_range CHECK (split_percentage IS NULL OR (split_percentage > 0 AND split_percentage < 1)),
  -- Only one split per lease per destination entity
  UNIQUE (lease_id, destination_entity_id)
);

-- Indexes
CREATE INDEX idx_lease_cost_splits_lease ON lease_cost_splits(lease_id);
CREATE INDEX idx_lease_cost_splits_source ON lease_cost_splits(source_entity_id);
CREATE INDEX idx_lease_cost_splits_destination ON lease_cost_splits(destination_entity_id);
CREATE INDEX idx_lease_cost_splits_active ON lease_cost_splits(is_active) WHERE is_active = true;

-- Updated-at trigger
CREATE TRIGGER update_lease_cost_splits_updated_at
  BEFORE UPDATE ON lease_cost_splits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE lease_cost_splits ENABLE ROW LEVEL SECURITY;

-- SELECT: Both source and destination entity users can view splits
CREATE POLICY "Users can view cost splits for their entities"
  ON lease_cost_splits FOR SELECT
  USING (
    source_entity_id IN (SELECT public.user_entity_ids())
    OR destination_entity_id IN (SELECT public.user_entity_ids())
  );

-- INSERT/UPDATE/DELETE: Only source entity admins/controllers/preparers can manage
CREATE POLICY "Users can manage cost splits for source entity"
  ON lease_cost_splits FOR ALL
  USING (
    public.user_entity_role(source_entity_id) IN ('admin', 'controller', 'preparer')
  );
