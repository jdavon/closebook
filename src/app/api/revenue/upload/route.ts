import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import { calculateAll, type RentalRow } from "@/lib/utils/revenue-calc";

/**
 * POST /api/revenue/upload
 * Accepts a multipart form with:
 *   - file: XLSX or CSV spreadsheet
 *   - entityId: string
 *   - periodYear: number
 *   - periodMonth: number
 *
 * Expected spreadsheet columns (flexible header matching):
 *   Contract #, Customer, Description, Rental Start, Rental End,
 *   Total Value, Billed Amount
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const entityId = formData.get("entityId") as string;
  const periodYear = Number(formData.get("periodYear"));
  const periodMonth = Number(formData.get("periodMonth"));

  if (!file || !entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "Missing required fields: file, entityId, periodYear, periodMonth" },
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

  // Flexible header mapping — try common variations
  const headerMap = buildHeaderMap(Object.keys(rawRows[0]));

  // Convert raw rows to typed rows
  const rows: RentalRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // 1-indexed + header row

    const contractId = String(raw[headerMap.contractId] ?? "").trim();
    const customerName = String(raw[headerMap.customerName] ?? "").trim();
    const description = String(raw[headerMap.description] ?? "").trim();
    const rentalStart = parseDate(raw[headerMap.rentalStart]);
    const rentalEnd = parseDate(raw[headerMap.rentalEnd]);
    const totalContractValue = parseNumber(raw[headerMap.totalValue]);
    const billedAmount = parseNumber(raw[headerMap.billedAmount]);

    if (!rentalStart || !rentalEnd) {
      errors.push(`Row ${rowNum}: invalid or missing rental dates`);
      continue;
    }

    if (rentalEnd < rentalStart) {
      errors.push(`Row ${rowNum}: rental end before rental start`);
      continue;
    }

    rows.push({
      contractId: contractId || `ROW-${rowNum}`,
      customerName,
      description,
      rentalStart,
      rentalEnd,
      totalContractValue,
      billedAmount,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found", details: errors },
      { status: 400 }
    );
  }

  // Calculate accruals/deferrals
  const { lines, totals } = calculateAll(rows, periodYear, periodMonth);

  // Upload file to Supabase Storage
  const timestamp = Date.now();
  const storagePath = `${entityId}/revenue/${periodYear}/${periodMonth}/${timestamp}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("uploaded-reports")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    // Storage might not exist yet — continue without file reference
    console.warn("File upload failed (storage bucket may not exist):", uploadError.message);
  }

  // Upsert revenue schedule
  const { data: schedule, error: scheduleError } = await supabase
    .from("revenue_schedules")
    .upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        source_file_name: file.name,
        source_file_path: uploadError ? null : storagePath,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
        total_earned_revenue: totals.earned,
        total_billed_revenue: totals.billed,
        total_accrued_revenue: totals.accrual,
        total_deferred_revenue: totals.deferral,
        status: "draft",
      },
      { onConflict: "entity_id,period_year,period_month" }
    )
    .select()
    .single();

  if (scheduleError) {
    return NextResponse.json(
      { error: scheduleError.message },
      { status: 500 }
    );
  }

  // Delete old line items then insert new ones
  await supabase
    .from("revenue_line_items")
    .delete()
    .eq("schedule_id", schedule.id);

  const lineInserts = lines.map((l, idx) => ({
    schedule_id: schedule.id,
    contract_id: l.contractId,
    customer_name: l.customerName,
    description: l.description,
    rental_start: l.rentalStart,
    rental_end: l.rentalEnd,
    total_contract_value: l.totalContractValue,
    daily_rate: l.dailyRate,
    days_in_period: l.daysInPeriod,
    earned_revenue: l.earnedRevenue,
    billed_amount: l.billedAmount,
    accrual_amount: l.accrualAmount,
    deferral_amount: l.deferralAmount,
    row_order: idx,
  }));

  const { error: lineError } = await supabase
    .from("revenue_line_items")
    .insert(lineInserts);

  if (lineError) {
    return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  return NextResponse.json({
    scheduleId: schedule.id,
    linesProcessed: lines.length,
    skippedRows: errors.length,
    errors: errors.length > 0 ? errors : undefined,
    totals,
  });
}

// ---- Helpers ----

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
    contractId: find(["contract", "contractid", "contractno", "contractnum"]),
    customerName: find(["customer", "client", "renter", "lessee"]),
    description: find(["description", "desc", "vehicle", "unit", "asset"]),
    rentalStart: find(["rentalstart", "startdate", "start", "pickupdate", "pickup", "from"]),
    rentalEnd: find(["rentalend", "enddate", "end", "returndate", "return", "to", "through"]),
    totalValue: find(["totalvalue", "totalcontract", "contractvalue", "total", "value", "amount"]),
    billedAmount: find(["billed", "invoiced", "billedamount", "invoicedamount", "billing"]),
  };
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof value === "number") {
    // Excel serial date number
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  return null;
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
