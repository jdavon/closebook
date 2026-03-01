-- Add rw_customer_number to rebate_customers
-- This stores the public-facing account number (e.g., "C00123")
-- as opposed to rw_customer_id which is the internal RW GUID used for API calls.

ALTER TABLE rebate_customers
  ADD COLUMN rw_customer_number text;
