-- Move custom_vehicle_classes from entity-scoped to organization-scoped.
-- Classes should be shared across all entities in an organization.

-- 1. Add organization_id column
ALTER TABLE custom_vehicle_classes
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Backfill from existing entity_id → entities.organization_id
UPDATE custom_vehicle_classes cvc
SET organization_id = e.organization_id
FROM entities e
WHERE cvc.entity_id = e.id
  AND cvc.organization_id IS NULL;

-- 3. Make organization_id NOT NULL now that all rows are backfilled
ALTER TABLE custom_vehicle_classes
  ALTER COLUMN organization_id SET NOT NULL;

-- 4. Make entity_id nullable (no longer the primary scope)
ALTER TABLE custom_vehicle_classes
  ALTER COLUMN entity_id DROP NOT NULL;

-- 5. Drop the old entity-level unique constraint and add org-level one
ALTER TABLE custom_vehicle_classes
  DROP CONSTRAINT IF EXISTS custom_vehicle_classes_entity_id_class_code_key;

ALTER TABLE custom_vehicle_classes
  ADD CONSTRAINT custom_vehicle_classes_org_class_code_key
  UNIQUE (organization_id, class_code);

-- 6. Update RLS policies to use organization-level access
DROP POLICY IF EXISTS "Users can view custom vehicle classes" ON custom_vehicle_classes;
DROP POLICY IF EXISTS "Users can manage custom vehicle classes" ON custom_vehicle_classes;

CREATE POLICY "Users can view custom vehicle classes"
  ON custom_vehicle_classes FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage custom vehicle classes"
  ON custom_vehicle_classes FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );
