import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateDepreciationSchedule,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";
import { getCurrentPeriod } from "@/lib/utils/dates";

interface AssetImportRow {
  asset_tag?: string;
  asset_name?: string;
  vehicle_class?: string;
  vehicle_year?: number | null;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_trim?: string;
  vin?: string;
  license_plate?: string;
  license_state?: string;
  mileage_at_acquisition?: number | null;
  title_number?: string;
  registration_expiry?: string;
  vehicle_notes?: string;
  acquisition_date: string;
  acquisition_cost: number;
  in_service_date: string;
  book_useful_life_months?: number;
  book_salvage_value?: number;
  book_depreciation_method?: string;
  tax_cost_basis?: number | null;
  tax_depreciation_method?: string;
  tax_useful_life_months?: number | null;
  section_179_amount?: number;
  bonus_depreciation_amount?: number;
  status?: string;
}

/**
 * POST /api/assets/import
 * Bulk-imports fixed assets from pre-parsed JSON rows (from the import wizard).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, rows } = body as {
    entityId: string;
    rows: AssetImportRow[];
  };

  if (!entityId || !rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "Missing entityId or rows" },
      { status: 400 }
    );
  }

  const currentPeriod = getCurrentPeriod();
  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row.acquisition_date || !row.acquisition_cost || !row.in_service_date) {
      results.errors.push(
        `Row ${rowNum}: missing acquisition date, cost, or in-service date — skipped`
      );
      results.skipped++;
      continue;
    }

    const acquisitionCost = Number(row.acquisition_cost);
    if (isNaN(acquisitionCost) || acquisitionCost <= 0) {
      results.errors.push(`Row ${rowNum}: invalid acquisition cost — skipped`);
      results.skipped++;
      continue;
    }

    const assetName =
      row.asset_name ||
      [row.vehicle_year, row.vehicle_make, row.vehicle_model]
        .filter(Boolean)
        .join(" ") ||
      row.asset_tag ||
      `Asset Row ${rowNum}`;

    const bookUsefulLifeMonths = row.book_useful_life_months || 60;
    const bookSalvageValue = row.book_salvage_value || 0;
    const bookMethod = row.book_depreciation_method || "straight_line";
    const taxCostBasis = row.tax_cost_basis ?? null;
    const taxMethod = row.tax_depreciation_method || "macrs_5";
    const taxUsefulLifeMonths = row.tax_useful_life_months ?? null;
    const section179 = row.section_179_amount || 0;
    const bonusDepr = row.bonus_depreciation_amount || 0;
    const status = row.status || "active";

    const { data: asset, error: insertError } = await supabase
      .from("fixed_assets")
      .insert({
        entity_id: entityId,
        asset_name: assetName,
        asset_tag: row.asset_tag || null,
        vehicle_year: row.vehicle_year ?? null,
        vehicle_make: row.vehicle_make || null,
        vehicle_model: row.vehicle_model || null,
        vehicle_trim: row.vehicle_trim || null,
        vin: row.vin?.toUpperCase() || null,
        license_plate: row.license_plate?.toUpperCase() || null,
        license_state: row.license_state?.toUpperCase() || null,
        vehicle_class: row.vehicle_class || null,
        mileage_at_acquisition: row.mileage_at_acquisition ?? null,
        title_number: row.title_number || null,
        registration_expiry: row.registration_expiry || null,
        vehicle_notes: row.vehicle_notes || null,
        acquisition_date: row.acquisition_date,
        acquisition_cost: acquisitionCost,
        in_service_date: row.in_service_date,
        book_useful_life_months: bookUsefulLifeMonths,
        book_salvage_value: bookSalvageValue,
        book_depreciation_method: bookMethod,
        tax_cost_basis: taxCostBasis,
        tax_depreciation_method: taxMethod,
        tax_useful_life_months: taxUsefulLifeMonths,
        section_179_amount: section179,
        bonus_depreciation_amount: bonusDepr,
        status,
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      results.errors.push(`Row ${rowNum}: ${insertError.message}`);
      results.skipped++;
      continue;
    }

    // Generate depreciation schedule through current period
    const deprInput: AssetForDepreciation = {
      acquisition_cost: acquisitionCost,
      in_service_date: row.in_service_date,
      book_useful_life_months: bookUsefulLifeMonths,
      book_salvage_value: bookSalvageValue,
      book_depreciation_method: bookMethod,
      tax_cost_basis: taxCostBasis,
      tax_depreciation_method: taxMethod,
      tax_useful_life_months: taxUsefulLifeMonths,
      section_179_amount: section179,
      bonus_depreciation_amount: bonusDepr,
    };

    const schedule = generateDepreciationSchedule(
      deprInput,
      currentPeriod.year,
      currentPeriod.month
    );

    if (schedule.length > 0) {
      const deprEntries = schedule.map((entry) => ({
        fixed_asset_id: asset.id,
        period_year: entry.period_year,
        period_month: entry.period_month,
        book_depreciation: entry.book_depreciation,
        book_accumulated: entry.book_accumulated,
        book_net_value: entry.book_net_value,
        tax_depreciation: entry.tax_depreciation,
        tax_accumulated: entry.tax_accumulated,
        tax_net_value: entry.tax_net_value,
      }));

      await supabase.from("fixed_asset_depreciation").insert(deprEntries);

      const lastEntry = schedule[schedule.length - 1];
      await supabase
        .from("fixed_assets")
        .update({
          book_accumulated_depreciation: lastEntry.book_accumulated,
          tax_accumulated_depreciation: lastEntry.tax_accumulated,
        })
        .eq("id", asset.id);
    }

    results.imported++;
  }

  return NextResponse.json(results);
}
