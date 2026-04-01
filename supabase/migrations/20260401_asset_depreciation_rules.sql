-- Depreciation rules by reporting group
-- Provides default depreciation assumptions for assets in a reporting group
-- that don't have hard-coded useful life / salvage values on the asset itself.

CREATE TABLE IF NOT EXISTS asset_depreciation_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  reporting_group text NOT NULL,
  book_useful_life_months integer,       -- default useful life in months
  book_salvage_pct        numeric(5,2),  -- salvage value as % of acquisition cost (e.g. 10.00 = 10%)
  book_depreciation_method text NOT NULL DEFAULT 'straight_line',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, reporting_group)
);

-- RLS
ALTER TABLE asset_depreciation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view depreciation rules for their entities"
  ON asset_depreciation_rules FOR SELECT
  USING (
    entity_id IN (SELECT public.user_entity_ids())
  );

CREATE POLICY "Users can manage depreciation rules for their entities"
  ON asset_depreciation_rules FOR ALL
  USING (
    public.user_entity_role(entity_id) IN ('admin', 'controller')
  );
