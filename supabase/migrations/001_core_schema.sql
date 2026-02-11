-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Organizations
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Entities (companies within an organization)
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  currency text DEFAULT 'USD',
  fiscal_year_end_month int DEFAULT 12,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, code)
);

-- User profiles (extends auth.users)
-- Note: We use a trigger instead of FK to auth.users since the SQL Editor
-- doesn't have permission to reference auth schema directly.
CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Organization membership with roles
CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- Entity-level access overrides
CREATE TABLE entity_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'controller', 'preparer', 'reviewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, user_id)
);

-- Audit log
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- QBO CONNECTIONS
-- ============================================================================

CREATE TABLE qbo_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  realm_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  company_name text,
  last_sync_at timestamptz,
  sync_status text DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error text,
  connected_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE qbo_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_connection_id uuid NOT NULL REFERENCES qbo_connections(id) ON DELETE CASCADE,
  sync_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  records_synced int DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- ============================================================================
-- CHART OF ACCOUNTS & BALANCES
-- ============================================================================

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  qbo_id text,
  account_number text,
  name text NOT NULL,
  fully_qualified_name text,
  classification text NOT NULL CHECK (classification IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  account_type text NOT NULL,
  account_sub_type text,
  parent_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  currency text DEFAULT 'USD',
  current_balance numeric(19,4) DEFAULT 0,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, qbo_id)
);

CREATE TABLE gl_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  beginning_balance numeric(19,4) DEFAULT 0,
  debit_total numeric(19,4) DEFAULT 0,
  credit_total numeric(19,4) DEFAULT 0,
  ending_balance numeric(19,4) DEFAULT 0,
  net_change numeric(19,4) DEFAULT 0,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, account_id, period_year, period_month)
);

CREATE TABLE trial_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  report_data jsonb NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, period_year, period_month, status)
);

-- ============================================================================
-- CLOSE MANAGEMENT
-- ============================================================================

CREATE TABLE close_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  status text DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'review', 'closed', 'locked')),
  due_date date,
  notes text,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, period_year, period_month)
);

CREATE TABLE close_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  default_role text CHECK (default_role IN ('preparer', 'reviewer')),
  account_classification text,
  account_type text,
  relative_due_day int,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  requires_reconciliation boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE close_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_period_id uuid NOT NULL REFERENCES close_periods(id) ON DELETE CASCADE,
  template_id uuid REFERENCES close_task_templates(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  category text,
  status text DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'na')),
  preparer_id uuid REFERENCES profiles(id),
  reviewer_id uuid REFERENCES profiles(id),
  due_date date,
  completed_at timestamptz,
  reviewed_at timestamptz,
  preparer_notes text,
  reviewer_notes text,
  gl_balance numeric(19,4),
  reconciled_balance numeric(19,4),
  variance numeric(19,4),
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE close_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_task_id uuid NOT NULL REFERENCES close_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE close_task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_task_id uuid NOT NULL REFERENCES close_tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SCHEDULES
-- ============================================================================

CREATE TABLE schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('prepaid', 'fixed_asset', 'debt', 'accrual', 'custom')),
  column_definitions jsonb NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  template_id uuid REFERENCES schedule_templates(id) ON DELETE SET NULL,
  close_period_id uuid REFERENCES close_periods(id) ON DELETE SET NULL,
  close_task_id uuid REFERENCES close_tasks(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('prepaid', 'fixed_asset', 'debt', 'accrual', 'custom')),
  column_definitions jsonb NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  total_amount numeric(19,4) DEFAULT 0,
  gl_balance numeric(19,4),
  variance numeric(19,4),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE schedule_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  row_order int NOT NULL,
  is_header boolean DEFAULT false,
  is_total boolean DEFAULT false,
  cell_data jsonb NOT NULL DEFAULT '{}',
  amount numeric(19,4) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- REPORTS & KPIs
-- ============================================================================

CREATE TABLE report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('income_statement', 'balance_sheet', 'cash_flow', 'custom')),
  config jsonb NOT NULL,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  report_definition_id uuid REFERENCES report_definitions(id) ON DELETE SET NULL,
  period_year int NOT NULL,
  period_month int NOT NULL,
  report_data jsonb NOT NULL,
  comparison_data jsonb,
  generated_at timestamptz DEFAULT now(),
  generated_by uuid REFERENCES profiles(id)
);

CREATE TABLE uploaded_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  name text NOT NULL,
  description text,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  category text,
  uploaded_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  formula jsonb NOT NULL,
  format text DEFAULT 'percentage' CHECK (format IN ('percentage', 'currency', 'number')),
  target_value numeric(19,4),
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE kpi_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_definition_id uuid NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  value numeric(19,4),
  computed_at timestamptz DEFAULT now(),
  UNIQUE (kpi_definition_id, entity_id, period_year, period_month)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_entities_org ON entities(organization_id);
CREATE INDEX idx_accounts_entity ON accounts(entity_id);
CREATE INDEX idx_accounts_parent ON accounts(parent_account_id);
CREATE INDEX idx_gl_balances_entity_period ON gl_balances(entity_id, period_year, period_month);
CREATE INDEX idx_gl_balances_account ON gl_balances(account_id);
CREATE INDEX idx_close_periods_entity ON close_periods(entity_id, period_year, period_month);
CREATE INDEX idx_close_tasks_period ON close_tasks(close_period_id);
CREATE INDEX idx_close_tasks_preparer ON close_tasks(preparer_id);
CREATE INDEX idx_close_tasks_reviewer ON close_tasks(reviewer_id);
CREATE INDEX idx_close_tasks_status ON close_tasks(status);
CREATE INDEX idx_close_tasks_account ON close_tasks(account_id);
CREATE INDEX idx_schedules_entity ON schedules(entity_id);
CREATE INDEX idx_schedules_period ON schedules(close_period_id);
CREATE INDEX idx_schedule_line_items_schedule ON schedule_line_items(schedule_id, row_order);
CREATE INDEX idx_kpi_values_entity_period ON kpi_values(entity_id, period_year, period_month);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_entity_access_user ON entity_access(user_id);
CREATE INDEX idx_audit_log_org_created ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_log_entity_created ON audit_log(entity_id, created_at DESC);
CREATE INDEX idx_qbo_sync_logs_connection ON qbo_sync_logs(qbo_connection_id);

-- ============================================================================
-- RLS HELPER FUNCTIONS
-- ============================================================================

-- Get organization IDs the current user belongs to
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid AS $$
  SELECT organization_id FROM organization_members
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get entity IDs the current user has access to
CREATE OR REPLACE FUNCTION public.user_entity_ids()
RETURNS SETOF uuid AS $$
  SELECT e.id FROM entities e
  INNER JOIN organization_members om ON om.organization_id = e.organization_id
  WHERE om.user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get user's role for a specific entity (checks entity override first, then org role)
CREATE OR REPLACE FUNCTION public.user_entity_role(p_entity_id uuid)
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT role FROM entity_access WHERE entity_id = p_entity_id AND user_id = auth.uid()),
    (SELECT om.role FROM organization_members om
     INNER JOIN entities e ON e.organization_id = om.organization_id
     WHERE e.id = p_entity_id AND om.user_id = auth.uid())
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can view profiles in their org" ON profiles FOR SELECT USING (
  id IN (SELECT user_id FROM organization_members WHERE organization_id IN (SELECT public.user_org_ids()))
);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their organizations" ON organizations FOR SELECT USING (
  id IN (SELECT public.user_org_ids())
);
CREATE POLICY "Anyone can create an organization" ON organizations FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update their organizations" ON organizations FOR UPDATE USING (
  id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);

-- Entities
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view entities in their org" ON entities FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);
CREATE POLICY "Admins can manage entities" ON entities FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update entities" ON entities FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);

-- Organization Members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view members in their org" ON organization_members FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);
CREATE POLICY "Admins can manage members" ON organization_members FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update members" ON organization_members FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete members" ON organization_members FOR DELETE USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role = 'admin')
);

-- Entity Access
ALTER TABLE entity_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view entity access" ON entity_access FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "Admins can manage entity access" ON entity_access FOR ALL USING (
  entity_id IN (
    SELECT e.id FROM entities e
    INNER JOIN organization_members om ON om.organization_id = e.organization_id
    WHERE om.user_id = auth.uid() AND om.role = 'admin'
  )
);

-- Accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view accounts in their entities" ON accounts FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "Admins/controllers can manage accounts" ON accounts FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller')
);

-- GL Balances
ALTER TABLE gl_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view balances in their entities" ON gl_balances FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "System can manage balances" ON gl_balances FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller')
);

-- Close Periods
ALTER TABLE close_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view close periods" ON close_periods FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "Controllers can manage close periods" ON close_periods FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller')
);

-- Close Task Templates
ALTER TABLE close_task_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view templates" ON close_task_templates FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);
CREATE POLICY "Admins can manage templates" ON close_task_templates FOR ALL USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('admin', 'controller'))
);

-- Close Tasks
ALTER TABLE close_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view tasks in their entities" ON close_tasks FOR SELECT USING (
  close_period_id IN (
    SELECT cp.id FROM close_periods cp WHERE cp.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Assigned users and admins can update tasks" ON close_tasks FOR UPDATE USING (
  preparer_id = auth.uid() OR reviewer_id = auth.uid() OR
  public.user_entity_role(
    (SELECT entity_id FROM close_periods WHERE id = close_period_id)
  ) IN ('admin', 'controller')
);
CREATE POLICY "Controllers can insert tasks" ON close_tasks FOR INSERT WITH CHECK (
  public.user_entity_role(
    (SELECT entity_id FROM close_periods WHERE id = close_period_id)
  ) IN ('admin', 'controller')
);

-- Close Task Comments
ALTER TABLE close_task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view comments on accessible tasks" ON close_task_comments FOR SELECT USING (
  close_task_id IN (
    SELECT ct.id FROM close_tasks ct
    INNER JOIN close_periods cp ON cp.id = ct.close_period_id
    WHERE cp.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Users can add comments" ON close_task_comments FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

-- Close Task Attachments
ALTER TABLE close_task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view attachments on accessible tasks" ON close_task_attachments FOR SELECT USING (
  close_task_id IN (
    SELECT ct.id FROM close_tasks ct
    INNER JOIN close_periods cp ON cp.id = ct.close_period_id
    WHERE cp.entity_id IN (SELECT public.user_entity_ids())
  )
);
CREATE POLICY "Users can upload attachments" ON close_task_attachments FOR INSERT WITH CHECK (
  uploaded_by = auth.uid()
);

-- Schedules
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view schedules" ON schedules FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "Users can manage schedules" ON schedules FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer')
);

-- Schedule Line Items
ALTER TABLE schedule_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view line items" ON schedule_line_items FOR SELECT USING (
  schedule_id IN (SELECT s.id FROM schedules s WHERE s.entity_id IN (SELECT public.user_entity_ids()))
);
CREATE POLICY "Users can manage line items" ON schedule_line_items FOR ALL USING (
  schedule_id IN (
    SELECT s.id FROM schedules s
    WHERE public.user_entity_role(s.entity_id) IN ('admin', 'controller', 'preparer')
  )
);

-- QBO Connections
ALTER TABLE qbo_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view connections" ON qbo_connections FOR SELECT USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller')
);
CREATE POLICY "Admins can manage connections" ON qbo_connections FOR ALL USING (
  public.user_entity_role(entity_id) IN ('admin', 'controller')
);

-- QBO Sync Logs
ALTER TABLE qbo_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view sync logs" ON qbo_sync_logs FOR SELECT USING (
  qbo_connection_id IN (
    SELECT qc.id FROM qbo_connections qc WHERE qc.entity_id IN (SELECT public.user_entity_ids())
  )
);

-- Trial Balances
ALTER TABLE trial_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view trial balances" ON trial_balances FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

-- Report Definitions
ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view report definitions" ON report_definitions FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

-- Generated Reports
ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view generated reports" ON generated_reports FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

-- Uploaded Reports
ALTER TABLE uploaded_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view uploaded reports" ON uploaded_reports FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);
CREATE POLICY "Users can upload reports" ON uploaded_reports FOR INSERT WITH CHECK (
  uploaded_by = auth.uid() AND entity_id IN (SELECT public.user_entity_ids())
);

-- KPI Definitions
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view KPI definitions" ON kpi_definitions FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

-- KPI Values
ALTER TABLE kpi_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view KPI values" ON kpi_values FOR SELECT USING (
  entity_id IN (SELECT public.user_entity_ids())
);

-- Audit Log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view audit log" ON audit_log FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);
CREATE POLICY "System can insert audit entries" ON audit_log FOR INSERT WITH CHECK (true);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-create profile on user signup
-- NOTE: The trigger on auth.users must be created separately.
-- Run the contents of 002_auth_trigger.sql in the Supabase Dashboard
-- under Authentication > Hooks, or via the Supabase CLI which has
-- elevated permissions to access the auth schema.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_qbo_connections_updated_at BEFORE UPDATE ON qbo_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_gl_balances_updated_at BEFORE UPDATE ON gl_balances FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_close_periods_updated_at BEFORE UPDATE ON close_periods FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_close_tasks_updated_at BEFORE UPDATE ON close_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_close_task_templates_updated_at BEFORE UPDATE ON close_task_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_schedule_line_items_updated_at BEFORE UPDATE ON schedule_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_schedule_templates_updated_at BEFORE UPDATE ON schedule_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_report_definitions_updated_at BEFORE UPDATE ON report_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_kpi_definitions_updated_at BEFORE UPDATE ON kpi_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
