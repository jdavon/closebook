-- Per-paycheck detail storage for monthly cost drill-down
-- Stores individual paychecks with earning breakdowns (REG, OT, DT, MEAL),
-- employer benefits, and raw detail lines for full transparency.

create table if not exists employee_paycheck_details (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  paylocity_company_id text not null,
  employee_name text not null,
  year integer not null,
  check_date text not null,
  begin_date text not null,
  end_date text not null,
  transaction_number text,
  -- Summary-level
  gross_pay numeric(12,2) default 0,
  net_pay numeric(12,2) default 0,
  hours numeric(8,2) default 0,
  -- Earning breakdown
  regular_hours numeric(8,2) default 0,
  regular_dollars numeric(12,2) default 0,
  overtime_hours numeric(8,2) default 0,
  overtime_dollars numeric(12,2) default 0,
  doubletime_hours numeric(8,2) default 0,
  doubletime_dollars numeric(12,2) default 0,
  meal_dollars numeric(12,2) default 0,
  other_earnings_dollars numeric(12,2) default 0,
  -- Employer costs
  er_taxes_estimated numeric(12,2) default 0,
  er_benefits numeric(12,2) default 0,
  er_benefit_detail jsonb default '{}',
  -- Raw detail lines for full drill-down
  detail_lines jsonb default '[]',
  -- Metadata
  synced_at timestamptz default now(),

  unique (employee_id, paylocity_company_id, year, check_date, transaction_number)
);

create index if not exists idx_paycheck_details_lookup
  on employee_paycheck_details (employee_id, paylocity_company_id, year);

alter table employee_paycheck_details enable row level security;

create policy "Authenticated users can read employee_paycheck_details"
  on employee_paycheck_details for select to authenticated using (true);

create policy "Authenticated users can insert employee_paycheck_details"
  on employee_paycheck_details for insert to authenticated with check (true);

create policy "Authenticated users can update employee_paycheck_details"
  on employee_paycheck_details for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete employee_paycheck_details"
  on employee_paycheck_details for delete to authenticated using (true);
