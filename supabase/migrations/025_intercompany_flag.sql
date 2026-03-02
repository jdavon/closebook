-- Migration 025: Add intercompany flag to master accounts
-- Accounts tagged as intercompany will be eliminated (zeroed out)
-- on consolidated financial statements (organization/reporting entity scope).
-- They still appear at the entity level.

ALTER TABLE master_accounts
  ADD COLUMN is_intercompany boolean NOT NULL DEFAULT false;

-- Index for efficient filtering during consolidation
CREATE INDEX idx_master_accounts_intercompany
  ON master_accounts(organization_id, is_intercompany)
  WHERE is_intercompany = true;
