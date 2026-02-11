import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import {
  generateDepreciationSchedule,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { VEHICLE_CLASSIFICATIONS } from "@/lib/utils/vehicle-classification";
import type { VehicleClass } from "@/lib/types/database";

/**
 * POST /api/assets/upload
 * Bulk-imports fixed assets from an XLSX or CSV spreadsheet.
 *
 * Expected columns (flexible header matching):
 *   Asset Tag, Year, Make, Model, Trim, VIN, License Plate, License State,
 *   Vehicle Class, Acquisition Date, Acquisition Cost, In-Service Date,
 *   Book Useful Life (months), Book Salvage Value, Book Method,
 *   Tax Cost Basis, Tax Method, Tax Useful Life (months),
 *   Section 179, Bonus Depreciation, Mileage, Title Number, Notes
 *
 * Minimum required per row: Acquisition Date, Acquisition Cost, In-Service Date
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const entityId = formData.get("entityId") as string;

  if (!file || !entityId) {
    return NextResponse.json(
      { error: "Missing required fields: file, entityId" },
      { status: 400 }
    );
  }

  // Parse spreadsheet
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (rawRows.length === 0) {
    return NextResponse.json(
      { error: "Spreadsheet is empty" },
      { status: 400 }
    );
  }

  // Build flexible header map
  const headers = Object.keys(rawRows[0]);
  const hm = buildHeaderMap(headers);

  const currentPeriod = getCurrentPeriod();
  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // 1-indexed + header row

    // Parse required fields
    const acquisitionDate = parseDateToISO(raw[hm.acquisitionDate]);
    const acquisitionCost = parseNumber(raw[hm.acquisitionCost]);
    const inServiceDate = parseDateToISO(raw[hm.inServiceDate]) || acquisitionDate;

    if (!acquisitionDate || !acquisitionCost) {
      results.errors.push(
        `Row ${rowNum}: missing acquisition date or cost — skipped`
      );
      results.skipped++;
      continue;
    }

    // Parse optional fields
    const vehicleYear = parseIntSafe(raw[hm.year]);
    const vehicleMake = parseString(raw[hm.make]);
    const vehicleModel = parseString(raw[hm.model]);
    const vehicleTrim = parseString(raw[hm.trim]);
    const vin = parseString(raw[hm.vin])?.toUpperCase() || null;
    const assetTag = parseString(raw[hm.assetTag]);
    const licensePlate = parseString(raw[hm.licensePlate])?.toUpperCase() || null;
    const licenseState = parseString(raw[hm.licenseState])?.toUpperCase() || null;
    const vehicleClass = resolveVehicleClass(raw[hm.vehicleClass]);
    const mileage = parseIntSafe(raw[hm.mileage]);
    const titleNumber = parseString(raw[hm.titleNumber]);
    const vehicleNotes = parseString(raw[hm.notes]);

    // Auto-generate asset name from year/make/model
    const assetName =
      [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") ||
      assetTag ||
      `Asset Row ${rowNum}`;

    // Book basis
    const bookUsefulLifeMonths = parseIntSafe(raw[hm.bookUsefulLife]) || 60;
    const bookSalvageValue = parseNumber(raw[hm.bookSalvage]) || 0;
    const bookMethod = resolveBookMethod(raw[hm.bookMethod]);

    // Tax basis
    const taxCostBasis = parseNumber(raw[hm.taxCostBasis]) || null;
    const taxMethod = resolveTaxMethod(raw[hm.taxMethod]);
    const taxUsefulLifeMonths = parseIntSafe(raw[hm.taxUsefulLife]) || null;
    const section179 = parseNumber(raw[hm.section179]) || 0;
    const bonusDepr = parseNumber(raw[hm.bonusDepr]) || 0;

    // Insert asset — cast dates that are guaranteed non-null by the guard above
    const { data: asset, error: insertError } = await supabase
      .from("fixed_assets")
      .insert({
        entity_id: entityId,
        asset_name: assetName || "Untitled Asset",
        asset_tag: assetTag ?? null,
        vehicle_year: vehicleYear ?? null,
        vehicle_make: vehicleMake ?? null,
        vehicle_model: vehicleModel ?? null,
        vehicle_trim: vehicleTrim ?? null,
        vin: vin ?? null,
        license_plate: licensePlate ?? null,
        license_state: licenseState ?? null,
        vehicle_class: vehicleClass ?? null,
        mileage_at_acquisition: mileage ?? null,
        title_number: titleNumber ?? null,
        vehicle_notes: vehicleNotes ?? null,
        acquisition_date: acquisitionDate!,
        acquisition_cost: acquisitionCost,
        in_service_date: inServiceDate!,
        book_useful_life_months: bookUsefulLifeMonths,
        book_salvage_value: bookSalvageValue,
        book_depreciation_method: bookMethod,
        tax_cost_basis: taxCostBasis,
        tax_depreciation_method: taxMethod,
        tax_useful_life_months: taxUsefulLifeMonths,
        section_179_amount: section179,
        bonus_depreciation_amount: bonusDepr,
        status: "active",
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
      in_service_date: inServiceDate!,
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

      // Update accumulated depreciation on the asset
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

// ---- Header mapping ----

function buildHeaderMap(headers: string[]) {
  const find = (patterns: string[]) => {
    for (const h of headers) {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const p of patterns) {
        if (lower.includes(p)) return h;
      }
    }
    return headers[0]; // fallback
  };

  return {
    assetTag: find(["assettag", "tag", "assetid", "unitnumber", "unit"]),
    year: find(["year", "modelyear", "vehicleyear"]),
    make: find(["make", "manufacturer", "brand"]),
    model: find(["model"]),
    trim: find(["trim", "package", "level"]),
    vin: find(["vin", "vehicleid", "serialnumber", "serial"]),
    licensePlate: find(["licenseplate", "plate", "license"]),
    licenseState: find(["licensestate", "state", "regstate"]),
    vehicleClass: find(["vehicleclass", "class", "classtype", "type", "category"]),
    mileage: find(["mileage", "miles", "odometer"]),
    titleNumber: find(["titlenumber", "title"]),
    acquisitionDate: find(["acquisitiondate", "purchasedate", "acquired", "purchase", "dateacquired"]),
    acquisitionCost: find(["acquisitioncost", "cost", "purchaseprice", "price", "amount"]),
    inServiceDate: find(["inservicedate", "inservice", "servicedate", "placedinservice"]),
    bookUsefulLife: find(["bookusefullife", "usefullife", "booklife", "lifemonths"]),
    bookSalvage: find(["booksalvage", "salvage", "salvagevalue", "residual"]),
    bookMethod: find(["bookmethod", "bookdepreciation", "deprmethod"]),
    taxCostBasis: find(["taxcostbasis", "taxbasis", "taxcost"]),
    taxMethod: find(["taxmethod", "taxdepreciation", "taxdepr"]),
    taxUsefulLife: find(["taxusefullife", "taxlife"]),
    section179: find(["section179", "sec179", "179"]),
    bonusDepr: find(["bonusdepreciation", "bonus", "bonusdepr"]),
    notes: find(["notes", "comments", "description", "memo"]),
  };
}

// ---- Value parsers ----

function parseString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parseIntSafe(value: unknown): number | null {
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "string") {
    const n = parseInt(value.replace(/[^0-9-]/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseDateToISO(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (typeof value === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      const date = new Date(d.y, d.m - 1, d.d);
      return date.toISOString().split("T")[0];
    }
  }
  return null;
}

/**
 * Resolve a vehicle class value from the spreadsheet to a valid VehicleClass.
 * Accepts: class code ("13", "15L"), class name ("Regular Cab Cube"),
 * or reporting group ("Box Truck") — returns the best match code.
 */
function resolveVehicleClass(value: unknown): VehicleClass | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();

  // Direct match by code
  if (str in VEHICLE_CLASSIFICATIONS) {
    return str as VehicleClass;
  }

  // Match by code case-insensitively
  const upperStr = str.toUpperCase();
  for (const [code, cls] of Object.entries(VEHICLE_CLASSIFICATIONS)) {
    if (code.toUpperCase() === upperStr) return code as VehicleClass;
  }

  // Match by class name (partial)
  const lowerStr = str.toLowerCase();
  for (const [code, cls] of Object.entries(VEHICLE_CLASSIFICATIONS)) {
    if (cls.className.toLowerCase() === lowerStr) return code as VehicleClass;
  }

  // Partial match on class name
  for (const [code, cls] of Object.entries(VEHICLE_CLASSIFICATIONS)) {
    if (cls.className.toLowerCase().includes(lowerStr)) return code as VehicleClass;
  }

  return null;
}

function resolveBookMethod(value: unknown): string {
  if (!value) return "straight_line";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("declining") || s.includes("ddb")) return "declining_balance";
  if (s.includes("none")) return "none";
  return "straight_line";
}

function resolveTaxMethod(value: unknown): string {
  if (!value) return "macrs_5";
  const s = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.includes("179") || s.includes("section179")) return "section_179";
  if (s.includes("bonus100") || s === "bonus") return "bonus_100";
  if (s.includes("bonus80")) return "bonus_80";
  if (s.includes("bonus60")) return "bonus_60";
  if (s.includes("macrs10") || s.includes("10year")) return "macrs_10";
  if (s.includes("macrs7") || s.includes("7year")) return "macrs_7";
  if (s.includes("macrs5") || s.includes("5year")) return "macrs_5";
  if (s.includes("macrs")) return "macrs_5";
  if (s.includes("straightline") || s.includes("sl")) return "straight_line_tax";
  if (s.includes("none")) return "none";
  return "macrs_5";
}
