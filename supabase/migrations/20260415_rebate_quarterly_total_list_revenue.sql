-- Add total_list_revenue to rebate_quarterly_summaries.
--
-- total_revenue (existing) is sum(final_amount): rebate-applicable revenue
-- after exclusions, tax, discount, and with manually-excluded invoices zeroed.
-- The rebate tracker summary page needs to show ALL revenue generated per
-- customer (including excluded invoices and excluded line items), which is
-- sum(list_total) from rebate_invoices. We track that separately so existing
-- rebate-applicable displays (customer detail tier logic, quarterly summary
-- table) stay correct.

ALTER TABLE rebate_quarterly_summaries
  ADD COLUMN IF NOT EXISTS total_list_revenue numeric(19,4) NOT NULL DEFAULT 0;

-- Backfill from rebate_invoices so the summary page has data immediately
-- (without waiting for a Calculate All run). Quarter is derived the same
-- way as getQuarter() in src/lib/utils/rebate-calculations.ts — using
-- billing_end_date when present, falling back to invoice_date.
WITH totals_by_quarter AS (
  SELECT
    rebate_customer_id,
    EXTRACT(YEAR  FROM COALESCE(billing_end_date, invoice_date))::int AS yr,
    ((EXTRACT(MONTH FROM COALESCE(billing_end_date, invoice_date))::int - 1) / 3 + 1) AS qnum,
    SUM(list_total) AS total_list_revenue
  FROM rebate_invoices
  WHERE COALESCE(billing_end_date, invoice_date) IS NOT NULL
  GROUP BY 1, 2, 3
)
UPDATE rebate_quarterly_summaries qs
SET total_list_revenue = tbq.total_list_revenue
FROM totals_by_quarter tbq
WHERE qs.rebate_customer_id = tbq.rebate_customer_id
  AND qs.year = tbq.yr
  AND qs.quarter_num = tbq.qnum;
