-- Custom vehicle classes: entity-scoped user-defined asset classes
-- Each custom class links to a master type (Vehicle or Trailer) for GL grouping

create table if not exists custom_vehicle_classes (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references entities(id) on delete cascade,
  class_code  text not null,
  class_name  text not null,
  reporting_group text not null,
  master_type text not null check (master_type in ('Vehicle', 'Trailer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_id, class_code)
);

-- RLS
alter table custom_vehicle_classes enable row level security;

create policy "Users can view custom classes for their entities"
  on custom_vehicle_classes for select
  using (
    entity_id in (
      select ea.entity_id from entity_access ea where ea.user_id = auth.uid()
    )
  );

create policy "Admins and controllers can manage custom classes"
  on custom_vehicle_classes for all
  using (
    entity_id in (
      select ea.entity_id from entity_access ea
      where ea.user_id = auth.uid() and ea.role in ('admin', 'controller')
    )
  );
