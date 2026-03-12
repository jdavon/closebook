-- Add record_type column to rebate_invoice_items for category grouping
-- Values: 'R' (Rental), 'S' (Sales), 'L' (Loss & Damage), 'M' (Miscellaneous/Labor), or NULL
ALTER TABLE rebate_invoice_items ADD COLUMN record_type text;

-- Index for efficient grouping queries
CREATE INDEX idx_rebate_invoice_items_record_type ON rebate_invoice_items(record_type);
