-- ============================================================================
-- MASTER TYPE OVERRIDE
-- ============================================================================
-- Allow an asset to declare a master type independent of its vehicle class.
-- Intended for accounting-adjustment rows (class = ADJ, masterType = null by
-- default) so a user can pin the adjustment to Vehicle or Trailer for GL
-- grouping and reporting. When null, reporting falls back to the class's
-- derived master type.

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS master_type_override text
    CHECK (master_type_override IS NULL OR master_type_override IN ('Vehicle', 'Trailer'));

COMMENT ON COLUMN fixed_assets.master_type_override IS
  'Manual master type selection (Vehicle or Trailer) that overrides the class-derived master type. Intended for accounting-adjustment assets where the class has no inherent master type.';
