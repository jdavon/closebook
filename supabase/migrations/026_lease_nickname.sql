-- Add nickname column to leases table
-- When set, nickname is used as the display name in summaries and list views
ALTER TABLE leases ADD COLUMN nickname TEXT;
