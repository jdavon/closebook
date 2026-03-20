-- Fix RLS policies on asset_recon_gl_links to use helper functions
-- matching the debt_reconciliation_accounts pattern that works.

DROP POLICY IF EXISTS "Users can view recon GL links for their entities" ON asset_recon_gl_links;
DROP POLICY IF EXISTS "Admins and controllers can manage recon GL links" ON asset_recon_gl_links;

CREATE POLICY "Users can view recon GL links for their entities"
  ON asset_recon_gl_links FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

CREATE POLICY "Admins and controllers can manage recon GL links"
  ON asset_recon_gl_links FOR ALL
  USING (public.user_entity_role(entity_id) IN ('admin', 'controller', 'preparer'));
