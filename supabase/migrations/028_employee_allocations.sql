-- Employee allocation overrides
-- Stores user-editable department, class, and company (entity) allocations
-- for employees from Paylocity. Overrides the default cost-center-based mapping.

create table employee_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  paylocity_company_id text not null,
  department text,
  class text,
  allocated_entity_id uuid,
  allocated_entity_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique(employee_id, paylocity_company_id)
);

-- Index for fast lookup by company
create index idx_employee_allocations_company on employee_allocations(paylocity_company_id);

-- RLS
alter table employee_allocations enable row level security;

-- Authenticated users can read all allocations
create policy "Authenticated users can read employee allocations"
  on employee_allocations for select
  to authenticated
  using (true);

-- Authenticated users can insert/update allocations
create policy "Authenticated users can insert employee allocations"
  on employee_allocations for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update employee allocations"
  on employee_allocations for update
  to authenticated
  using (true);
