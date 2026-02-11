-- Migration: Replace simple vehicle_type with fleet classification vehicle_class
-- The vehicle_class column stores the class code (e.g., '13', '15L', '8MU')
-- Reporting Group and Master Type are derived in application code from a static lookup

-- 1. Drop existing CHECK constraint on vehicle_type
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_vehicle_type_check;

-- 2. Migrate existing vehicle_type values to class codes before renaming
UPDATE fixed_assets SET vehicle_type = '3'  WHERE vehicle_type = 'sedan';
UPDATE fixed_assets SET vehicle_type = '12' WHERE vehicle_type = 'suv';
UPDATE fixed_assets SET vehicle_type = '17' WHERE vehicle_type = 'truck';
UPDATE fixed_assets SET vehicle_type = '11' WHERE vehicle_type = 'van';
UPDATE fixed_assets SET vehicle_type = '13' WHERE vehicle_type = 'heavy_truck';
UPDATE fixed_assets SET vehicle_type = '1R' WHERE vehicle_type = 'trailer';
UPDATE fixed_assets SET vehicle_type = NULL  WHERE vehicle_type = 'other';

-- 3. Rename column
ALTER TABLE fixed_assets RENAME COLUMN vehicle_type TO vehicle_class;

-- 4. Add new CHECK constraint with all 43 valid class codes
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_vehicle_class_check
  CHECK (vehicle_class IS NULL OR vehicle_class IN (
    '1R', '2', '2R', '3', '3R', '4', '5', '6', '7', '8', '8MU', '9',
    '11', '12', '13', '13T', '14', '15', '15I', '15L', '16', '17', '18',
    '20', '20T', '21', '22', '23', '24', '26', '27', '28', '28P', '28S',
    '29', '30', '31', '32', '33', '34', '40', '51', '52'
  ));

-- 5. Add an index on vehicle_class for filtering
CREATE INDEX IF NOT EXISTS idx_fixed_assets_vehicle_class ON fixed_assets(vehicle_class);
