-- Migration 017: Support intra-entity allocation (reclass) adjustments
-- Allows moving amounts between master accounts within the same entity.
-- When source_entity_id = destination_entity_id, a destination_master_account_id
-- is required so the amount moves FROM master_account_id TO destination_master_account_id.

-- Add destination master account column (nullable — only used for reclass)
ALTER TABLE allocation_adjustments
  ADD COLUMN destination_master_account_id uuid REFERENCES master_accounts(id) ON DELETE CASCADE;

-- Drop the old constraint that forced different entities
ALTER TABLE allocation_adjustments
  DROP CONSTRAINT chk_different_entities;

-- New constraint: same-entity allocations MUST specify a destination master account
ALTER TABLE allocation_adjustments
  ADD CONSTRAINT chk_reclass_requires_dest_account CHECK (
    source_entity_id != destination_entity_id
    OR destination_master_account_id IS NOT NULL
  );

-- New constraint: reclass destination account must differ from source account
ALTER TABLE allocation_adjustments
  ADD CONSTRAINT chk_reclass_different_accounts CHECK (
    destination_master_account_id IS NULL
    OR master_account_id != destination_master_account_id
  );

-- Index for the new column
CREATE INDEX idx_alloc_adj_dest_master_account
  ON allocation_adjustments(destination_master_account_id)
  WHERE destination_master_account_id IS NOT NULL;
