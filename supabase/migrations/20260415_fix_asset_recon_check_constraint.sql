-- Fix stale CHECK constraint on asset_reconciliations.gl_account_group.
--
-- Migration 031 created the table with a CHECK restricting gl_account_group to
-- ('vehicles_net', 'trailers_net'). The reconciliation feature was later
-- refactored (see migration 041 asset_recon_gl_links) to use four sub-groups:
-- vehicles_cost, vehicles_accum_depr, trailers_cost, trailers_accum_depr.
-- The CHECK on asset_reconciliations was never updated, so Mark Reconciled
-- silently fails the constraint for any of the four real group keys.
--
-- Keep the legacy 'vehicles_net' / 'trailers_net' values in the whitelist so
-- any existing rows remain valid.

ALTER TABLE asset_reconciliations
  DROP CONSTRAINT IF EXISTS asset_reconciliations_gl_account_group_check;

ALTER TABLE asset_reconciliations
  ADD CONSTRAINT asset_reconciliations_gl_account_group_check
  CHECK (gl_account_group IN (
    'vehicles_cost',
    'vehicles_accum_depr',
    'trailers_cost',
    'trailers_accum_depr',
    'vehicles_net',
    'trailers_net'
  ));
