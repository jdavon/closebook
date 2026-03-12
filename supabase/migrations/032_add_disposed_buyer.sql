-- Add buyer field to fixed_assets for tracking who purchased a sold vehicle
ALTER TABLE fixed_assets ADD COLUMN disposed_buyer text;
