-- Organization invites for user provisioning
CREATE TABLE organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer')),
  invited_by uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  token uuid DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_org_invites_org ON organization_invites(organization_id);
CREATE INDEX idx_org_invites_email ON organization_invites(email);
CREATE INDEX idx_org_invites_token ON organization_invites(token);
CREATE INDEX idx_org_invites_pending ON organization_invites(organization_id, email) WHERE status = 'pending';

-- Updated_at trigger
CREATE TRIGGER update_organization_invites_updated_at
  BEFORE UPDATE ON organization_invites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org invites" ON organization_invites FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

CREATE POLICY "Admins can create invites" ON organization_invites FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update invites" ON organization_invites FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can delete invites" ON organization_invites FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
