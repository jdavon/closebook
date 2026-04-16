-- Per-entity toggle to combine Vehicle + Trailer accumulated depreciation into a
-- single reconciliation group. Used when the entity's QuickBooks chart of accounts
-- has one shared Accum. Depreciation GL account instead of separate vehicle/trailer
-- accounts — in that case the subledger split by master type can't reconcile to GL.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS combine_fleet_accum_depr boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN entities.combine_fleet_accum_depr IS
  'When true, reconciliation shows a single Fleet — Accumulated Depreciation group (sum of vehicle + trailer accum depr) instead of the separate per-master-type groups. Toggle per-entity from the Rental Asset Register Settings dialog.';

-- Allow the new fleet_accum_depr key in the reconciliation state check constraint.
ALTER TABLE asset_reconciliations
  DROP CONSTRAINT IF EXISTS asset_reconciliations_gl_account_group_check;

ALTER TABLE asset_reconciliations
  ADD CONSTRAINT asset_reconciliations_gl_account_group_check
  CHECK (gl_account_group IN (
    'vehicles_cost',
    'vehicles_accum_depr',
    'trailers_cost',
    'trailers_accum_depr',
    'fleet_accum_depr',
    'vehicles_net',
    'trailers_net'
  ));
