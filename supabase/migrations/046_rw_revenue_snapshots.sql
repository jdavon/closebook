-- Migration: Daily RentalWorks revenue snapshots for Versatile Studios
-- Captures processed revenue projection data from the RW API daily via cron,
-- enabling day-over-day trend analysis and projection modeling.

-- One row per entity per day — KPIs as columns, full payload as JSONB
create table if not exists rw_revenue_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  entity_id               uuid not null references entities(id) on delete cascade,
  snapshot_date            date not null default current_date,

  -- Top-level KPIs (structured for SQL queries)
  ytd_revenue             numeric(19,4) not null,
  current_month_actual    numeric(19,4) not null,
  current_month_projected numeric(19,4) not null,
  pipeline_value          numeric(19,4) not null,
  quote_opportunities     numeric(19,4) not null,

  -- Counts for trend tracking
  pipeline_order_count    int not null default 0,
  pipeline_quote_count    int not null default 0,
  closed_invoice_count    int not null default 0,

  -- Full processed response for detail drill-down
  full_payload            jsonb not null,

  -- Metadata
  date_mode               text not null default 'invoice_date',
  data_as_of              timestamptz not null,
  created_at              timestamptz not null default now()
);

create unique index idx_rw_rev_snap_unique
  on rw_revenue_snapshots (entity_id, snapshot_date, date_mode);

create index idx_rw_rev_snap_entity_date
  on rw_revenue_snapshots (entity_id, snapshot_date desc);

-- One row per month per snapshot day — enables direct SQL on month-level trends
create table if not exists rw_revenue_snapshot_months (
  id                uuid primary key default gen_random_uuid(),
  snapshot_id       uuid not null references rw_revenue_snapshots(id) on delete cascade,
  entity_id         uuid not null references entities(id) on delete cascade,
  snapshot_date     date not null,
  month_key         text not null,      -- "2026-03"
  month_label       text not null,      -- "Mar 26"

  closed            numeric(19,4) not null default 0,
  pending           numeric(19,4) not null default 0,
  pipeline          numeric(19,4) not null default 0,
  forecast          numeric(19,4),       -- null if no forecast
  billed            numeric(19,4) not null default 0,
  earned            numeric(19,4) not null default 0,
  accrued           numeric(19,4) not null default 0,
  deferred          numeric(19,4) not null default 0
);

create unique index idx_rw_rev_snap_months_unique
  on rw_revenue_snapshot_months (entity_id, snapshot_date, month_key);

create index idx_rw_rev_snap_months_lookup
  on rw_revenue_snapshot_months (entity_id, month_key, snapshot_date desc);

create index idx_rw_rev_snap_months_snap_id
  on rw_revenue_snapshot_months (snapshot_id);

-- RLS policies
alter table rw_revenue_snapshots enable row level security;
alter table rw_revenue_snapshot_months enable row level security;

-- rw_revenue_snapshots: read for org members (cron writes via admin client)
create policy "Users can view RW revenue snapshots for their entities"
  on rw_revenue_snapshots for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

-- rw_revenue_snapshot_months: read for org members
create policy "Users can view RW revenue snapshot months for their entities"
  on rw_revenue_snapshot_months for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );
