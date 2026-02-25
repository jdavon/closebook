-- ============================================================================
-- REPORTING ENTITIES
-- Virtual groupings of entities for sub-consolidated financial reporting.
-- A reporting entity aggregates data from its member entities without
-- holding its own GL data.
-- ============================================================================

-- Reporting Entities (organization-level groupings)
CREATE TABLE reporting_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, code)
);

-- Junction table: which entities belong to each reporting entity
CREATE TABLE reporting_entity_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporting_entity_id uuid NOT NULL REFERENCES reporting_entities(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (reporting_entity_id, entity_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_reporting_entities_org ON reporting_entities(organization_id);
CREATE INDEX idx_reporting_entity_members_re ON reporting_entity_members(reporting_entity_id);
CREATE INDEX idx_reporting_entity_members_entity ON reporting_entity_members(entity_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Reporting Entities
ALTER TABLE reporting_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reporting entities" ON reporting_entities FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

CREATE POLICY "Admins and controllers can insert reporting entities" ON reporting_entities FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update reporting entities" ON reporting_entities FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete reporting entities" ON reporting_entities FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

-- Reporting Entity Members
ALTER TABLE reporting_entity_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reporting entity members" ON reporting_entity_members FOR SELECT USING (
  reporting_entity_id IN (
    SELECT id FROM reporting_entities
    WHERE organization_id IN (SELECT public.user_org_ids())
  )
);

CREATE POLICY "Admins and controllers can insert reporting entity members" ON reporting_entity_members FOR INSERT WITH CHECK (
  reporting_entity_id IN (
    SELECT re.id FROM reporting_entities re
    INNER JOIN organization_members om ON om.organization_id = re.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update reporting entity members" ON reporting_entity_members FOR UPDATE USING (
  reporting_entity_id IN (
    SELECT re.id FROM reporting_entities re
    INNER JOIN organization_members om ON om.organization_id = re.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete reporting entity members" ON reporting_entity_members FOR DELETE USING (
  reporting_entity_id IN (
    SELECT re.id FROM reporting_entities re
    INNER JOIN organization_members om ON om.organization_id = re.organization_id
    WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'controller')
  )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_reporting_entities_updated_at
  BEFORE UPDATE ON reporting_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
