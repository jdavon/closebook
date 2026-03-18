-- Add change tracking to trial_balances so we can detect when QBO data actually changed
-- content_hash: SHA-256 of the raw report_data JSON, used to detect changes without comparing full payloads
-- data_changed_at: only updated when content_hash differs from previous sync (i.e., QBO data actually changed)

ALTER TABLE trial_balances
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS data_changed_at timestamptz;

-- Backfill data_changed_at to synced_at for existing rows (assume they changed when synced)
UPDATE trial_balances
SET data_changed_at = synced_at
WHERE data_changed_at IS NULL AND synced_at IS NOT NULL;
