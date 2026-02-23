-- ============================================================================
-- MULTI-CLASS INCLUDE/EXCLUDE FILTER FOR COMMISSION ASSIGNMENTS
-- ============================================================================
-- Replaces the single qbo_class_id FK with:
--   class_filter_mode: 'all' | 'include' | 'exclude'
--   qbo_class_ids: uuid[] (array of class IDs)
-- ============================================================================

-- Add new columns
ALTER TABLE commission_account_assignments
  ADD COLUMN class_filter_mode text NOT NULL DEFAULT 'all'
    CHECK (class_filter_mode IN ('all', 'include', 'exclude')),
  ADD COLUMN qbo_class_ids uuid[] NOT NULL DEFAULT '{}';

-- Migrate any existing single-class assignments to the new schema
UPDATE commission_account_assignments
SET class_filter_mode = 'include',
    qbo_class_ids = ARRAY[qbo_class_id]
WHERE qbo_class_id IS NOT NULL;

-- Drop old unique index that references qbo_class_id
DROP INDEX IF EXISTS idx_commission_assignments_unique;

-- Drop old FK column
ALTER TABLE commission_account_assignments
  DROP COLUMN qbo_class_id;

-- New unique constraint: one account per profile (class filter is metadata on the row)
CREATE UNIQUE INDEX idx_commission_assignments_unique
  ON commission_account_assignments(commission_profile_id, account_id);
