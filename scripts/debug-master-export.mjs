// Debug: reproduce the master export pipeline's data-load + schedule-build
// for NCNT to see if anything throws when running against real data.
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve("./.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const rest = async (p) => {
  const r = await fetch(`${URL}/rest/v1${p}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
};

const ENTITY = "cb56911c-8c00-4cba-9ea0-6f62b6c46ffd";
const asOfDate = "2026-04-16";
const [asOfYear, asOfMonth] = asOfDate.split("-").map(Number);

console.log("Loading dependencies...");
const [allAssets, rules, settings, recons] = await Promise.all([
  rest(`/fixed_assets?select=*&entity_id=eq.${ENTITY}&offset=0&limit=3000`),
  rest(`/asset_depreciation_rules?select=*&entity_id=eq.${ENTITY}`),
  rest(`/entities?select=rental_asset_opening_date&id=eq.${ENTITY}`),
  rest(
    `/asset_reconciliations?select=*&entity_id=eq.${ENTITY}&or=(period_year.lt.${asOfYear},and(period_year.eq.${asOfYear},period_month.lte.${asOfMonth}))&order=period_year.asc,period_month.asc`
  ),
]);

console.log(`assets: ${allAssets.length}`);
console.log(`rules: ${rules.length}`);
console.log(`settings opening: ${settings[0]?.rental_asset_opening_date}`);
console.log(`recons: ${recons.length}`);

// Count assets with missing fields
let missingInService = 0;
let missingMethod = 0;
let missingCost = 0;
for (const a of allAssets) {
  if (!a.in_service_date) missingInService++;
  if (!a.book_depreciation_method) missingMethod++;
  if (a.acquisition_cost == null) missingCost++;
}
console.log(
  `missing: in_service=${missingInService}, method=${missingMethod}, cost=${missingCost}`
);

// Try to "build schedules" in a way that mimics the engine's parseDate
// to see if any asset breaks it.
let errors = 0;
for (const a of allAssets) {
  try {
    if (!a.in_service_date) throw new Error("null in_service_date");
    const parts = a.in_service_date.split("T")[0].split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(month)) throw new Error(`bad date ${a.in_service_date}`);
    if (a.disposed_date) {
      const dparts = a.disposed_date.split("T")[0].split("-");
      if (isNaN(parseInt(dparts[0], 10)) || isNaN(parseInt(dparts[1], 10))) {
        throw new Error(`bad disposed_date ${a.disposed_date}`);
      }
    }
  } catch (err) {
    errors++;
    if (errors <= 5)
      console.log(`  ${a.id} (${a.asset_tag ?? a.asset_name}): ${err.message}`);
  }
}
console.log(`parse errors: ${errors}`);
