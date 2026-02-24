-- Migration: Budget tables for budget vs actual comparison
-- Creates budget_versions and budget_amounts tables

-- Budget versions (one per entity per fiscal year, can have multiple drafts)
create table if not exists budget_versions (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id) on delete cascade,
  name          text not null,
  fiscal_year   int  not null,
  status        text not null default 'draft'
                check (status in ('draft', 'approved', 'archived')),
  is_active     boolean not null default false,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Only one active budget per entity per fiscal year
create unique index idx_budget_versions_active
  on budget_versions (entity_id, fiscal_year)
  where is_active = true;

create index idx_budget_versions_entity
  on budget_versions (entity_id, fiscal_year);

-- Budget line amounts (one row per account per month)
create table if not exists budget_amounts (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references entities(id) on delete cascade,
  account_id          uuid not null references accounts(id) on delete cascade,
  budget_version_id   uuid not null references budget_versions(id) on delete cascade,
  period_year         int  not null,
  period_month        int  not null check (period_month between 1 and 12),
  amount              numeric(19,4) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Unique constraint: one amount per account per period per version
create unique index idx_budget_amounts_unique
  on budget_amounts (budget_version_id, account_id, period_year, period_month);

create index idx_budget_amounts_entity_period
  on budget_amounts (entity_id, period_year, period_month);

create index idx_budget_amounts_version
  on budget_amounts (budget_version_id);

-- RLS policies
alter table budget_versions enable row level security;
alter table budget_amounts enable row level security;

-- Budget versions: users can see budgets for entities in their organization
create policy "Users can view budget versions for their entities"
  on budget_versions for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert budget versions for their entities"
  on budget_versions for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can update budget versions for their entities"
  on budget_versions for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can delete budget versions for their entities"
  on budget_versions for delete
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- Budget amounts: same RLS pattern
create policy "Users can view budget amounts for their entities"
  on budget_amounts for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert budget amounts for their entities"
  on budget_amounts for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can update budget amounts for their entities"
  on budget_amounts for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can delete budget amounts for their entities"
  on budget_amounts for delete
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- Updated_at trigger
create trigger set_budget_versions_updated_at
  before update on budget_versions
  for each row execute function update_updated_at_column();

create trigger set_budget_amounts_updated_at
  before update on budget_amounts
  for each row execute function update_updated_at_column();
