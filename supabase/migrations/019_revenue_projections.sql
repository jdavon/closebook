-- Migration: Revenue projection tables for dashboard forecasting
-- Creates revenue_projections (current active projections) and
-- revenue_projection_snapshots (daily run-rate snapshots for variance tracking)

-- Current active projection per entity/period/section
create table if not exists revenue_projections (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references entities(id) on delete cascade,
  period_year       int  not null,
  period_month      int  not null check (period_month between 1 and 12),
  section_id        text not null,  -- matches IS section IDs: "revenue", "other_income"
  projected_amount  numeric(19,4) not null default 0,
  notes             text,
  updated_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index idx_revenue_projections_unique
  on revenue_projections (entity_id, period_year, period_month, section_id);

create index idx_revenue_projections_entity_period
  on revenue_projections (entity_id, period_year, period_month);

-- Daily snapshots of projected run rates for variance analysis
create table if not exists revenue_projection_snapshots (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references entities(id) on delete cascade,
  period_year       int  not null,
  period_month      int  not null check (period_month between 1 and 12),
  section_id        text not null,
  projected_amount  numeric(19,4) not null,
  snapshot_date     date not null default current_date,
  source            text not null default 'manual',  -- "manual" | "external_tool"
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create unique index idx_revenue_snapshots_unique
  on revenue_projection_snapshots (entity_id, period_year, period_month, section_id, snapshot_date);

create index idx_revenue_snapshots_entity_period
  on revenue_projection_snapshots (entity_id, period_year, period_month);

-- RLS policies
alter table revenue_projections enable row level security;
alter table revenue_projection_snapshots enable row level security;

-- revenue_projections: CRUD for org members
create policy "Users can view revenue projections for their entities"
  on revenue_projections for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert revenue projections for their entities"
  on revenue_projections for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can update revenue projections for their entities"
  on revenue_projections for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can delete revenue projections for their entities"
  on revenue_projections for delete
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- revenue_projection_snapshots: CRUD for org members
create policy "Users can view revenue projection snapshots for their entities"
  on revenue_projection_snapshots for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert revenue projection snapshots for their entities"
  on revenue_projection_snapshots for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can update revenue projection snapshots for their entities"
  on revenue_projection_snapshots for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can delete revenue projection snapshots for their entities"
  on revenue_projection_snapshots for delete
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- Updated_at trigger for revenue_projections
create trigger set_revenue_projections_updated_at
  before update on revenue_projections
  for each row execute function update_updated_at_column();
