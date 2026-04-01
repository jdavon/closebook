-- Dedicated GL account mappings for payroll accrual types.
-- Stores the configured debit (expense) and credit (liability) accounts
-- per entity per accrual type, so the sync can auto-populate account IDs.

CREATE TABLE IF NOT EXISTS payroll_gl_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  accrual_type text NOT NULL CHECK (accrual_type IN ('wages', 'payroll_tax', 'pto', 'benefits')),
  debit_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  credit_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, accrual_type)
);

-- Enable RLS
ALTER TABLE payroll_gl_mappings ENABLE ROW LEVEL SECURITY;

-- RLS policies (match pattern used by other tables)
CREATE POLICY "Users can view payroll GL mappings"
  ON payroll_gl_mappings FOR SELECT
  USING (true);

CREATE POLICY "Users can insert payroll GL mappings"
  ON payroll_gl_mappings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update payroll GL mappings"
  ON payroll_gl_mappings FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete payroll GL mappings"
  ON payroll_gl_mappings FOR DELETE
  USING (true);
