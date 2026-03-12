-- ============================================================================
-- FREELANCER REBATE AGREEMENTS: Allow customers without RW Customer ID
-- ============================================================================

-- Make rw_customer_id nullable for freelancer agreements
ALTER TABLE rebate_customers ALTER COLUMN rw_customer_id DROP NOT NULL;

-- Drop the existing unique constraint and replace with a partial one
-- that only enforces uniqueness when rw_customer_id is not null
ALTER TABLE rebate_customers DROP CONSTRAINT rebate_customers_entity_id_rw_customer_id_key;

CREATE UNIQUE INDEX idx_rebate_customers_entity_rw_id
  ON rebate_customers (entity_id, rw_customer_id)
  WHERE rw_customer_id IS NOT NULL;
