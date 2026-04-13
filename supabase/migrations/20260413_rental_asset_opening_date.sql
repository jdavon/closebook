-- ============================================================================
-- RENTAL ASSET OPENING DATE
-- ============================================================================
-- Entity-level setting controlling the opening balance cutoff for the rental
-- asset register. Imported accumulated depreciation is anchored to this date;
-- depreciation schedules are generated from the month after this date forward.
--
-- Default 2024-12-31 supports clients closing books for FY2025 where the
-- 2024 year-end balance is the source of truth and 2025 activity needs to be
-- layered on. Each entity can be shifted independently going forward.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS rental_asset_opening_date date NOT NULL DEFAULT '2024-12-31';

COMMENT ON COLUMN entities.rental_asset_opening_date IS
  'Opening balance cutoff for the rental asset register. Imports anchor accumulated depreciation to this date; depreciation generation starts the following month.';
