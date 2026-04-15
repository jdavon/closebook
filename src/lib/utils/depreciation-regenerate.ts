// Shared helper to rebuild an asset's depreciation subledger from the
// opening-balance cutoff through a target period, preserving any rows
// flagged is_manual_override. Used by the dispose, undo-dispose, and
// bulk-dispose flows so the subledger stays in sync without the user
// having to click "Regenerate" separately.
//
// Works with any Supabase client shape — pass the browser client from a
// client component or the admin client from a server route.

import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
} from "./depreciation";

type AssetRow = {
  id: string;
  entity_id: string;
  acquisition_cost: number | string;
  in_service_date: string;
  book_useful_life_months: number;
  book_salvage_value: number | string;
  book_depreciation_method: string;
  tax_cost_basis: number | string | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  section_179_amount: number | string;
  bonus_depreciation_amount: number | string;
  disposed_date: string | null;
};

/**
 * Regenerate an asset's depreciation subledger and update its header.
 *
 * - Pulls the entity's rental_asset_opening_date and the asset's opening
 *   balance row (marked is_manual_override). Both anchor the schedule.
 * - Uses the asset's stored UL / salvage / method (matches the "Regenerate
 *   through current period" button on the depreciation page).
 * - Deletes non-manual subledger rows, inserts the generated schedule for
 *   any period not already held by a manual override.
 * - For disposed assets, `generateDepreciationSchedule` naturally stops
 *   emitting after the disposal month (book_depreciation = 0 in that month).
 */
export async function regenerateAssetSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  assetId: string,
  throughYear: number,
  throughMonth: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: asset, error: assetErr } = await supabase
    .from("fixed_assets")
    .select(
      "id, entity_id, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, disposed_date"
    )
    .eq("id", assetId)
    .single();
  if (assetErr || !asset) return { ok: false, error: assetErr?.message ?? "Asset not found" };

  const a = asset as AssetRow;

  const { data: entity, error: entErr } = await supabase
    .from("entities")
    .select("rental_asset_opening_date")
    .eq("id", a.entity_id)
    .single();
  if (entErr || !entity) return { ok: false, error: entErr?.message ?? "Entity not found" };
  const openingDateIso = (entity as { rental_asset_opening_date: string })
    .rental_asset_opening_date;
  const [oy, om] = openingDateIso.split("-").map(Number);

  const { data: openingRowData } = await supabase
    .from("fixed_asset_depreciation")
    .select("book_accumulated, tax_accumulated")
    .eq("fixed_asset_id", assetId)
    .eq("period_year", oy)
    .eq("period_month", om)
    .maybeSingle();

  const openingRow = openingRowData as
    | { book_accumulated: number | string; tax_accumulated: number | string }
    | null;

  const { data: manualRows } = await supabase
    .from("fixed_asset_depreciation")
    .select("period_year, period_month")
    .eq("fixed_asset_id", assetId)
    .eq("is_manual_override", true);

  const manualPeriods = new Set(
    ((manualRows as { period_year: number; period_month: number }[] | null) ?? []).map(
      (r) => `${r.period_year}-${r.period_month}`
    )
  );

  const assetForCalc: AssetForDepreciation = {
    acquisition_cost: Number(a.acquisition_cost),
    in_service_date: a.in_service_date,
    book_useful_life_months: a.book_useful_life_months,
    book_salvage_value: Number(a.book_salvage_value),
    book_depreciation_method: a.book_depreciation_method,
    tax_cost_basis: a.tax_cost_basis != null ? Number(a.tax_cost_basis) : null,
    tax_depreciation_method: a.tax_depreciation_method,
    tax_useful_life_months: a.tax_useful_life_months,
    section_179_amount: Number(a.section_179_amount ?? 0),
    bonus_depreciation_amount: Number(a.bonus_depreciation_amount ?? 0),
    disposed_date: a.disposed_date,
  };

  const opening = buildOpeningBalance(
    openingDateIso,
    openingRow ? Number(openingRow.book_accumulated) : 0,
    openingRow ? Number(openingRow.tax_accumulated) : 0
  );

  const schedule = generateDepreciationSchedule(
    assetForCalc,
    throughYear,
    throughMonth,
    opening
  );

  // Wipe non-manual rows, then reinsert everything from the generated
  // schedule except periods held by a manual override.
  const { error: delErr } = await supabase
    .from("fixed_asset_depreciation")
    .delete()
    .eq("fixed_asset_id", assetId)
    .eq("is_manual_override", false);
  if (delErr) return { ok: false, error: delErr.message };

  const rowsToInsert = schedule
    .filter(
      (entry) => !manualPeriods.has(`${entry.period_year}-${entry.period_month}`)
    )
    .map((entry) => ({
      fixed_asset_id: assetId,
      period_year: entry.period_year,
      period_month: entry.period_month,
      book_depreciation: entry.book_depreciation,
      book_accumulated: entry.book_accumulated,
      book_net_value: entry.book_net_value,
      tax_depreciation: entry.tax_depreciation,
      tax_accumulated: entry.tax_accumulated,
      tax_net_value: entry.tax_net_value,
      is_manual_override: false,
    }));

  if (rowsToInsert.length > 0) {
    const { error: insErr } = await supabase
      .from("fixed_asset_depreciation")
      .insert(rowsToInsert);
    if (insErr) return { ok: false, error: insErr.message };
  }

  // Mirror the final accumulated to the asset header so UI cards stay in
  // sync. Schedule is empty only when the asset is in service after the
  // target period — skip the update in that case.
  if (schedule.length > 0) {
    const last = schedule[schedule.length - 1];
    await supabase
      .from("fixed_assets")
      .update({
        book_accumulated_depreciation: last.book_accumulated,
        tax_accumulated_depreciation: last.tax_accumulated,
      })
      .eq("id", assetId);
  }

  return { ok: true };
}
