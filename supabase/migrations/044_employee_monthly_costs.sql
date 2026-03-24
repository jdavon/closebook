-- Employee monthly payroll costs
-- Stores actual paycheck data synced from Paylocity plus accrued estimates
-- for months without full paycheck data. Read locally without API calls.

create table if not exists employee_monthly_costs (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  paylocity_company_id text not null,
  employee_name text not null,
  job_title text,
  pay_type text,                         -- 'Salary' or 'Hourly'
  cost_center_code text,                 -- for entity mapping via cost-center-config
  annual_comp numeric(12,2) default 0,   -- snapshot of annual comp at sync time
  year integer not null,
  month integer not null check (month between 1 and 12),
  gross_pay numeric(12,2) default 0,     -- actual gross from paychecks
  er_taxes numeric(12,2) default 0,      -- estimated employer payroll taxes
  er_benefits numeric(12,2) default 0,   -- employer-paid benefits (medical, 401k match)
  total_cost numeric(12,2) default 0,    -- gross + er_taxes + er_benefits
  hours_worked numeric(8,2) default 0,
  regular_hours numeric(8,2) default 0,
  overtime_hours numeric(8,2) default 0,
  check_count integer default 0,         -- number of paychecks in this month
  is_accrual boolean default false,      -- true = estimated, false = actual paycheck data
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (employee_id, paylocity_company_id, year, month)
);

-- Index for fast reads by year (the primary query pattern)
create index if not exists idx_emp_monthly_costs_year
  on employee_monthly_costs (year, month);

-- RLS
alter table employee_monthly_costs enable row level security;

create policy "Authenticated users can read employee_monthly_costs"
  on employee_monthly_costs for select
  to authenticated
  using (true);

create policy "Authenticated users can insert employee_monthly_costs"
  on employee_monthly_costs for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update employee_monthly_costs"
  on employee_monthly_costs for update
  to authenticated
  using (true)
  with check (true);
