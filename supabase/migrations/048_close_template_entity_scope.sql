-- Add entity scoping to close task templates
-- When entity_ids is NULL, template applies to all entities
-- When populated, template only generates tasks for those specific entities
ALTER TABLE close_task_templates
  ADD COLUMN IF NOT EXISTS entity_ids uuid[] DEFAULT NULL;

COMMENT ON COLUMN close_task_templates.entity_ids IS
  'When NULL the template applies to every entity; otherwise only to listed entity UUIDs';
