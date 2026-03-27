-- Add 'viewer' role to all role CHECK constraints

-- organization_members
ALTER TABLE organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer', 'viewer'));

-- entity_access
ALTER TABLE entity_access DROP CONSTRAINT IF EXISTS entity_access_role_check;
ALTER TABLE entity_access ADD CONSTRAINT entity_access_role_check
  CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer', 'viewer'));

-- organization_invites
ALTER TABLE organization_invites DROP CONSTRAINT IF EXISTS organization_invites_role_check;
ALTER TABLE organization_invites ADD CONSTRAINT organization_invites_role_check
  CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer', 'viewer'));
