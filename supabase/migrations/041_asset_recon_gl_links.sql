-- Links entity GL accounts to reconciliation groups for the fixed asset reconciliation.
-- Each entity can map one or more GL accounts to each recon group.

create table if not exists asset_recon_gl_links (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id) on delete cascade,
  recon_group   text not null,  -- e.g. 'vehicles_cost', 'vehicles_accum_depr', 'trailers_cost', 'trailers_accum_depr'
  account_id    uuid not null references accounts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (entity_id, recon_group, account_id)
);

alter table asset_recon_gl_links enable row level security;

create policy "Users can view recon GL links for their entities"
  on asset_recon_gl_links for select
  using (
    entity_id in (
      select ea.entity_id from entity_access ea where ea.user_id = auth.uid()
    )
  );

create policy "Admins and controllers can manage recon GL links"
  on asset_recon_gl_links for all
  using (
    entity_id in (
      select ea.entity_id from entity_access ea
      where ea.user_id = auth.uid() and ea.role in ('admin', 'controller')
    )
  );
