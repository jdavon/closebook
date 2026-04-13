import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { calculateDispositionGainLoss } from "@/lib/utils/depreciation";

interface DisposalImportRow {
  asset_tag: string;
  disposed_date: string;
  disposed_sale_price?: number | string;
  disposition_method?: string;
  disposed_buyer?: string;
  notes?: string;
}

const VALID_METHODS = new Set([
  "sale",
  "trade_in",
  "scrap",
  "theft",
  "casualty",
  "donation",
]);

function resolveMethod(value: string | undefined): string {
  if (!value) return "sale";
  const s = value.toLowerCase().replace(/[^a-z_]/g, "");
  if (s.includes("trade")) return "trade_in";
  if (s.includes("scrap")) return "scrap";
  if (s.includes("theft")) return "theft";
  if (s.includes("casualty")) return "casualty";
  if (s.includes("donat")) return "donation";
  if (VALID_METHODS.has(s)) return s;
  return "sale";
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

/**
 * POST /api/assets/import-disposals
 * Body: { entityId, rows: DisposalImportRow[] }
 *
 * Bulk-disposes existing fixed assets. Each row must match an asset by
 * asset_tag within the entity. Accumulated depreciation at the time of
 * disposal is sourced from fixed_asset_depreciation for the disposal month
 * (falling back to the most recent entry or the asset header if missing),
 * and gain/loss is calculated from sale price vs. net book value.
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
    rows: DisposalImportRow[];
  };

  if (!entityId || !rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "Missing entityId or rows" },
      { status: 400 }
    );
  }

  const results = {
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  // Pre-fetch all referenced assets in one query
  const tags = rows
    .map((r) => (r.asset_tag ?? "").trim())
    .filter((t): t is string => !!t);

  const { data: existingAssets } = await supabase
    .from("fixed_assets")
    .select(
      "id, asset_tag, asset_name, acquisition_cost, book_accumulated_depreciation, book_salvage_value, tax_cost_basis, tax_accumulated_depreciation, status"
    )
    .eq("entity_id", entityId)
    .in("asset_tag", tags);

  type AssetSnapshot = NonNullable<typeof existingAssets>[number];
  const assetByTag: Record<string, AssetSnapshot> = {};
  for (const a of existingAssets ?? []) {
    if (a.asset_tag) assetByTag[a.asset_tag] = a;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    const assetTag = (row.asset_tag ?? "").trim();
    if (!assetTag) {
      results.errors.push(`Row ${rowNum}: missing asset_tag — skipped`);
      results.skipped++;
      continue;
    }

    const asset = assetByTag[assetTag];
    if (!asset) {
      results.errors.push(
        `Row ${rowNum}: asset_tag "${assetTag}" not found — skipped`
      );
      results.skipped++;
      continue;
    }

    const disposedDate = parseDate(row.disposed_date);
    if (!disposedDate) {
      results.errors.push(
        `Row ${rowNum} (${assetTag}): invalid or missing disposed_date — skipped`
      );
      results.skipped++;
      continue;
    }

    const salePrice =
      row.disposed_sale_price != null && row.disposed_sale_price !== ""
        ? Number(row.disposed_sale_price)
        : 0;
    if (isNaN(salePrice)) {
      results.errors.push(
        `Row ${rowNum} (${assetTag}): invalid sale price — skipped`
      );
      results.skipped++;
      continue;
    }

    const method = resolveMethod(row.disposition_method);

    // Look up accumulated depreciation at the disposal month.
    // Prefer the depreciation entry for the disposal period; fall back to the
    // most recent entry on or before disposal; finally fall back to the
    // asset header's cumulative value.
    const [dispYear, dispMonth] = disposedDate.split("-").map(Number);
    const { data: priorEntries } = await supabase
      .from("fixed_asset_depreciation")
      .select("period_year, period_month, book_accumulated, tax_accumulated")
      .eq("fixed_asset_id", asset.id)
      .or(
        `period_year.lt.${dispYear},and(period_year.eq.${dispYear},period_month.lte.${dispMonth})`
      )
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(1);

    const atDisposalBookAccum =
      priorEntries && priorEntries.length > 0
        ? Number(priorEntries[0].book_accumulated)
        : Number(asset.book_accumulated_depreciation ?? 0);
    const atDisposalTaxAccum =
      priorEntries && priorEntries.length > 0
        ? Number(priorEntries[0].tax_accumulated)
        : Number(asset.tax_accumulated_depreciation ?? 0);

    const taxBasis = Number(asset.tax_cost_basis ?? asset.acquisition_cost);

    const { bookGainLoss, taxGainLoss } = calculateDispositionGainLoss(
      Number(asset.acquisition_cost),
      atDisposalBookAccum,
      Number(asset.book_salvage_value ?? 0),
      taxBasis,
      atDisposalTaxAccum,
      salePrice
    );

    const update: Record<string, unknown> = {
      status: "disposed",
      disposed_date: disposedDate,
      disposed_sale_price: salePrice,
      disposed_book_gain_loss: bookGainLoss,
      disposed_tax_gain_loss: taxGainLoss,
      disposition_method: method,
      disposed_buyer: row.disposed_buyer?.trim() || null,
    };
    if (row.notes?.trim()) {
      update.vehicle_notes = row.notes.trim();
    }

    const { error: updateErr } = await supabase
      .from("fixed_assets")
      .update(update)
      .eq("id", asset.id);

    if (updateErr) {
      results.errors.push(
        `Row ${rowNum} (${assetTag}): ${updateErr.message}`
      );
      results.skipped++;
      continue;
    }

    // Trim any depreciation entries after the disposal month so the schedule
    // doesn't continue accruing expense post-sale.
    await supabase
      .from("fixed_asset_depreciation")
      .delete()
      .eq("fixed_asset_id", asset.id)
      .or(
        `period_year.gt.${dispYear},and(period_year.eq.${dispYear},period_month.gt.${dispMonth})`
      );

    results.updated++;
  }

  return NextResponse.json(results);
}
