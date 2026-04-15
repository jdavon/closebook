-- Reclassify existing rebate_invoices rows after moving "CUBE" variants
-- (PROD CUBE, CAMERA CUBE, WARDROBE CUBE) from studio → vehicle.
--
-- Background: classifyEquipmentType() in src/lib/utils/rebate-calculations.ts
-- previously grouped PROD/CAMERA/WARDROBE CUBE under "studio". These are all
-- cube trucks, consistent with the existing "LOADED CUBE" → vehicle rule.
-- The rule was corrected; this migration re-derives equipment_type for every
-- already-synced invoice using the new rules, so rebate calculations reflect
-- the correct equipment category without needing a full re-sync from RentalWorks.
--
-- Precedence matches the JS function: Vehicle → G&L → Studio → Pro Supplies.
-- Idempotent: only rows whose computed value differs from the stored value
-- are updated.

UPDATE rebate_invoices
SET equipment_type = CASE
  WHEN order_description IS NULL OR order_description = '' THEN 'pro_supplies'
  WHEN UPPER(order_description) LIKE '%VEHICLE%'
    OR UPPER(order_description) LIKE '%CARGO VAN%'
    OR UPPER(order_description) LIKE '%PROMASTER%'
    OR UPPER(order_description) LIKE '%3 TON%'
    OR UPPER(order_description) LIKE '%3-TON%'
    OR UPPER(order_description) LIKE '%LOADED CUBE%'
    OR UPPER(order_description) LIKE '%PROD CUBE%'
    OR UPPER(order_description) LIKE '%CAMERA CUBE%'
    OR UPPER(order_description) LIKE '%WARDROBE CUBE%'
  THEN 'vehicle'
  WHEN UPPER(order_description) LIKE '%GRIP%'
    OR UPPER(order_description) LIKE '%G&L%'
    OR UPPER(order_description) LIKE '%G & L%'
    OR UPPER(order_description) LIKE '%G+L%'
  THEN 'grip_lighting'
  WHEN UPPER(order_description) LIKE '%STUDIO%' THEN 'studio'
  ELSE 'pro_supplies'
END
WHERE equipment_type IS DISTINCT FROM (CASE
  WHEN order_description IS NULL OR order_description = '' THEN 'pro_supplies'
  WHEN UPPER(order_description) LIKE '%VEHICLE%'
    OR UPPER(order_description) LIKE '%CARGO VAN%'
    OR UPPER(order_description) LIKE '%PROMASTER%'
    OR UPPER(order_description) LIKE '%3 TON%'
    OR UPPER(order_description) LIKE '%3-TON%'
    OR UPPER(order_description) LIKE '%LOADED CUBE%'
    OR UPPER(order_description) LIKE '%PROD CUBE%'
    OR UPPER(order_description) LIKE '%CAMERA CUBE%'
    OR UPPER(order_description) LIKE '%WARDROBE CUBE%'
  THEN 'vehicle'
  WHEN UPPER(order_description) LIKE '%GRIP%'
    OR UPPER(order_description) LIKE '%G&L%'
    OR UPPER(order_description) LIKE '%G & L%'
    OR UPPER(order_description) LIKE '%G+L%'
  THEN 'grip_lighting'
  WHEN UPPER(order_description) LIKE '%STUDIO%' THEN 'studio'
  ELSE 'pro_supplies'
END);

-- NOTE: rebate_invoices caches equipment_type at sync time, but downstream
-- fields (rebate_rate, net_rebate, tier_label, etc.) are computed at sync
-- time from that equipment_type. After this migration, any invoice whose
-- equipment_type changed will have stale rebate totals until the rebate
-- calculation is re-run. Trigger a rebate recalculation for affected
-- customers (or a full resync) to refresh those fields.
