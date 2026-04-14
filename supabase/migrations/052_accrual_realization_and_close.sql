-- Migration: Accrual Realization Rate + Close Lock + Variance Tracking
-- Supports ASC 606 variable consideration by applying an entity-specific
-- realization rate to unbilled earned revenue, and locks month-end close
-- snapshots so subsequent invoice activity can be variance-tracked.

-- ── Entity-level realization rate config ────────────────────────────────────
create table if not exists entity_accrual_config (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references entities(id) on delete cascade,
  realization_rate    numeric(6,4) not null default 1.0000
                       check (realization_rate >= 0 and realization_rate <= 1),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);

create unique index idx_entity_accrual_config_entity
  on entity_accrual_config (entity_id);

-- ── Monthly close lock (immutable snapshot) ─────────────────────────────────
create table if not exists accrual_close_periods (
  id                      uuid primary key default gen_random_uuid(),
  entity_id               uuid not null references entities(id) on delete cascade,
  period_year             int not null,
  period_month            int not null,            -- 1-12
  close_as_of_date        date not null,           -- user-selected lock date
  realization_rate_used   numeric(6,4) not null,
  gross_unbilled_earned   numeric(19,4) not null default 0,
  expected_discount       numeric(19,4) not null default 0,
  net_unbilled_earned     numeric(19,4) not null default 0,
  timing_accrual          numeric(19,4) not null default 0,  -- earned-billed on invoiced items
  timing_deferral         numeric(19,4) not null default 0,
  total_net_accrual       numeric(19,4) not null default 0,  -- JE debit to Unbilled A/R
  total_net_deferral      numeric(19,4) not null default 0,  -- JE credit to Deferred Rev
  line_count              int not null default 0,
  notes                   text,
  closed_at               timestamptz not null default now(),
  closed_by               uuid references auth.users(id),
  status                  text not null default 'closed'
                           check (status in ('closed', 'reversed'))
);

create unique index idx_accrual_close_periods_period
  on accrual_close_periods (entity_id, period_year, period_month);

create index idx_accrual_close_periods_entity
  on accrual_close_periods (entity_id, period_year desc, period_month desc);

-- ── Individual close lines (one per accrued order/invoice) ──────────────────
create table if not exists accrual_close_lines (
  id                      uuid primary key default gen_random_uuid(),
  close_period_id         uuid not null references accrual_close_periods(id)
                           on delete cascade,
  entity_id               uuid not null references entities(id) on delete cascade,
  line_type               text not null
                           check (line_type in ('unbilled_earned', 'timing_accrual', 'timing_deferral')),
  -- Source identifiers (from RW)
  order_number            text,
  invoice_number          text,                    -- populated for timing lines
  customer                text,
  order_description       text,
  rental_start_date       date,
  rental_end_date         date,
  -- Amounts as of close
  gross_amount            numeric(19,4) not null,      -- list/rack-rate amount
  realization_rate_applied numeric(6,4) not null,
  expected_discount       numeric(19,4) not null default 0,
  net_amount              numeric(19,4) not null,      -- amount booked to JE
  -- Variance tracking (populated as actual invoices land)
  matched_invoice_number  text,
  matched_invoice_date    date,
  actual_invoice_subtotal numeric(19,4),
  variance_amount         numeric(19,4),               -- actual - net_amount
  line_status             text not null default 'accrued'
                           check (line_status in ('accrued', 'invoiced', 'written_off', 'partial')),
  resolved_at             timestamptz,
  resolved_by             uuid references auth.users(id),
  writeoff_notes          text,
  created_at              timestamptz not null default now()
);

create index idx_accrual_close_lines_period
  on accrual_close_lines (close_period_id);

create index idx_accrual_close_lines_order
  on accrual_close_lines (entity_id, order_number)
  where order_number is not null;

create index idx_accrual_close_lines_status
  on accrual_close_lines (entity_id, line_status, close_period_id);

-- ── Auto-update trigger for entity_accrual_config.updated_at ────────────────
create or replace function touch_entity_accrual_config_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_entity_accrual_config on entity_accrual_config;
create trigger trg_touch_entity_accrual_config
  before update on entity_accrual_config
  for each row execute function touch_entity_accrual_config_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table entity_accrual_config enable row level security;
alter table accrual_close_periods enable row level security;
alter table accrual_close_lines enable row level security;

-- entity_accrual_config: read + write for org members
create policy "Users can view accrual config for their entities"
  on entity_accrual_config for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can upsert accrual config for their entities"
  on entity_accrual_config for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

create policy "Users can update accrual config for their entities"
  on entity_accrual_config for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

-- accrual_close_periods: read for org members, insert/update for member+
create policy "Users can view close periods for their entities"
  on accrual_close_periods for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can create close periods for their entities"
  on accrual_close_periods for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

create policy "Users can update close periods for their entities"
  on accrual_close_periods for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

-- accrual_close_lines: mirror parent period access
create policy "Users can view close lines for their entities"
  on accrual_close_lines for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert close lines for their entities"
  on accrual_close_lines for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

create policy "Users can update close lines for their entities"
  on accrual_close_lines for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );
