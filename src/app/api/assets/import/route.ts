import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  parseOpeningDate,
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
  book_accumulated_depreciation?: number;
  tax_accumulated_depreciation?: number;
  status?: string;
}

/**
 * POST /api/assets/import
 * Bulk-imports fixed assets from pre-parsed JSON rows (from the import wizard).
 * If an asset_tag already exists for the entity, the existing asset is updated
 * (upsert behavior). Otherwise a new asset is created.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

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

  // Fetch entity's opening balance date setting
  const { data: entityRow, error: entityErr } = await supabase
    .from("entities")
    .select("rental_asset_opening_date")
    .eq("id", entityId)
    .single();

  if (entityErr || !entityRow) {
    return NextResponse.json(
      { error: "Entity not found" },
      { status: 404 }
    );
  }

  const openingDateIso = entityRow.rental_asset_opening_date;
  const openingPeriod = parseOpeningDate(openingDateIso);

  // Pre-fetch existing assets by asset_tag for this entity so we can detect updates
  const tagsInImport = rows
    .map((r) => r.asset_tag?.trim())
    .filter((t): t is string => !!t);

  const existingByTag: Record<string, string> = {}; // asset_tag → id
  if (tagsInImport.length > 0) {
    const { data: existing } = await supabase
      .from("fixed_assets")
      .select("id, asset_tag")
      .eq("entity_id", entityId)
      .in("asset_tag", tagsInImport);

    if (existing) {
      for (const a of existing) {
        if (a.asset_tag) existingByTag[a.asset_tag] = a.id;
      }
    }
  }

  const currentPeriod = getCurrentPeriod();
  const results = {
    imported: 0,
    updated: 0,
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
    if (isNaN(acquisitionCost)) {
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

    const assetTag = row.asset_tag?.trim() || null;
    const existingId = assetTag ? existingByTag[assetTag] : undefined;

    const assetFields = {
      entity_id: entityId,
      asset_name: assetName,
      asset_tag: assetTag,
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
    };

    let assetId: string;

    if (existingId) {
      // ---- UPDATE existing asset ----
      const { error: updateError } = await supabase
        .from("fixed_assets")
        .update(assetFields)
        .eq("id", existingId);

      if (updateError) {
        results.errors.push(`Row ${rowNum} (update ${assetTag}): ${updateError.message}`);
        results.skipped++;
        continue;
      }

      assetId = existingId;

      // Delete old depreciation schedule — will be regenerated below
      await supabase
        .from("fixed_asset_depreciation")
        .delete()
        .eq("fixed_asset_id", assetId);

      results.updated++;
    } else {
      // ---- INSERT new asset ----
      const { data: asset, error: insertError } = await supabase
        .from("fixed_assets")
        .insert({ ...assetFields, created_by: user.id })
        .select("id")
        .single();

      if (insertError) {
        results.errors.push(`Row ${rowNum}: ${insertError.message}`);
        results.skipped++;
        continue;
      }

      assetId = asset.id;
      results.imported++;
    }

    // ---- Generate depreciation schedule ----
    const userBookAccumDepr =
      row.book_accumulated_depreciation != null
        ? Number(row.book_accumulated_depreciation)
        : null;
    const userTaxAccumDepr =
      row.tax_accumulated_depreciation != null
        ? Number(row.tax_accumulated_depreciation)
        : null;
    const hasUserOverride =
      (userBookAccumDepr !== null && !isNaN(userBookAccumDepr)) ||
      (userTaxAccumDepr !== null && !isNaN(userTaxAccumDepr));

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

    // An asset placed in service on or before the opening date is an "existing"
    // asset at opening: imported accumulated depreciation (if any) is anchored
    // to the opening period and the schedule rolls forward from there.
    // Assets placed in service after the opening date are post-opening additions;
    // their depreciation is generated from the in-service date forward.
    const inService = new Date(row.in_service_date);
    const openingDateObj = new Date(openingDateIso);
    const isExistingAtOpening = inService <= openingDateObj;

    if (isExistingAtOpening && hasUserOverride) {
      const finalBookAccum =
        userBookAccumDepr !== null && !isNaN(userBookAccumDepr)
          ? userBookAccumDepr
          : 0;
      const finalTaxAccum =
        userTaxAccumDepr !== null && !isNaN(userTaxAccumDepr)
          ? userTaxAccumDepr
          : 0;
      const effectiveTaxBasis = taxCostBasis ?? acquisitionCost;

      // 1. Write the opening balance row anchored at the opening period.
      await supabase.from("fixed_asset_depreciation").insert({
        fixed_asset_id: assetId,
        period_year: openingPeriod.year,
        period_month: openingPeriod.month,
        book_depreciation: 0,
        book_accumulated: finalBookAccum,
        book_net_value:
          Math.round((acquisitionCost - finalBookAccum) * 100) / 100,
        tax_depreciation: 0,
        tax_accumulated: finalTaxAccum,
        tax_net_value:
          Math.round((effectiveTaxBasis - finalTaxAccum) * 100) / 100,
        notes: "Opening balance",
      });

      // 2. Generate post-opening schedule through the current period.
      const opening = buildOpeningBalance(
        openingDateIso,
        finalBookAccum,
        finalTaxAccum
      );

      const schedule = generateDepreciationSchedule(
        deprInput,
        currentPeriod.year,
        currentPeriod.month,
        opening
      );

      if (schedule.length > 0) {
        const deprEntries = schedule.map((entry) => ({
          fixed_asset_id: assetId,
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
          .eq("id", assetId);
      } else {
        // No forward periods to generate — just sync the header with opening.
        await supabase
          .from("fixed_assets")
          .update({
            book_accumulated_depreciation: finalBookAccum,
            tax_accumulated_depreciation: finalTaxAccum,
          })
          .eq("id", assetId);
      }
    } else {
      const schedule = generateDepreciationSchedule(
        deprInput,
        currentPeriod.year,
        currentPeriod.month
      );

      if (schedule.length > 0) {
        const deprEntries = schedule.map((entry) => ({
          fixed_asset_id: assetId,
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
          .eq("id", assetId);
      }
    }
  }

  return NextResponse.json(results);
}
