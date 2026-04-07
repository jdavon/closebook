-- Date-effective employee allocations
-- Allows multiple allocation periods per employee, each with an effective date.
-- For a given date, the active allocation is the one with the most recent
-- effective_date <= that date.

-- Add effective_date column (existing rows get '2000-01-01' = "always in effect")
ALTER TABLE employee_allocations
  ADD COLUMN effective_date date NOT NULL DEFAULT '2000-01-01';

-- Drop old unique constraint (one allocation per employee)
ALTER TABLE employee_allocations
  DROP CONSTRAINT employee_allocations_employee_id_paylocity_company_id_key;

-- New unique constraint: one allocation per employee per effective date
ALTER TABLE employee_allocations
  ADD CONSTRAINT employee_allocations_employee_company_effective_date_key
    UNIQUE (employee_id, paylocity_company_id, effective_date);

-- Index for fast "find most recent allocation" lookups
CREATE INDEX idx_employee_allocations_date_lookup
  ON employee_allocations (employee_id, paylocity_company_id, effective_date DESC);

-- RLS: allow authenticated users to delete allocation periods
CREATE POLICY "Authenticated users can delete employee allocations"
  ON employee_allocations FOR DELETE
  TO authenticated
  USING (true);
