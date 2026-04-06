import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateAll, type RentalRow } from "@/lib/utils/revenue-calc";

export const maxDuration = 60;

/**
 * POST /api/qbo/rental-accruals
 *
 * Fetches invoices from QuickBooks, parses the "Rental Period" custom field,
 * and calculates revenue accruals/deferrals for the target accounting period.
 *
 * Body: { entityId, periodYear, periodMonth }
 *
 * For each invoice whose rental period overlaps the target month:
 *   - Earned = pro-rata share of the invoice total based on calendar days
 *   - Billed = invoice total if TxnDate falls in the target month, else 0
 *   - Accrual = earned - billed (if positive)
 *   - Deferral = billed - earned (if positive)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, periodYear, periodMonth } = await request.json();

  if (!entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "entityId, periodYear, and periodMonth are required" },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();

  // Get QBO connection
  const { data: connection, error: connError } = await adminClient
    .from("qbo_connections")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (connError || !connection) {
    return NextResponse.json(
      { error: "No QuickBooks connection found for this entity" },
      { status: 404 },
    );
  }

  // Refresh token
  const accessToken = await refreshTokenIfNeeded(connection, adminClient);

  // Fetch invoices from the past 12 months to catch any rental period
  // that might overlap with the target accounting month
  const fetchStart = new Date(periodYear, periodMonth - 13, 1);
  const fetchStartStr = fetchStart.toISOString().split("T")[0];

  const query = `SELECT * FROM Invoice WHERE TxnDate >= '${fetchStartStr}' ORDERBY TxnDate DESC MAXRESULTS 1000`;
  const qboResponse = await fetch(
    `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!qboResponse.ok) {
    const body = await qboResponse.text().catch(() => "");
    return NextResponse.json(
      { error: `QBO API error (HTTP ${qboResponse.status})`, detail: body },
      { status: 502 },
    );
  }

  const qboData = await qboResponse.json();
  const invoices: QBOInvoice[] = qboData.QueryResponse?.Invoice ?? [];

  // Parse invoices into RentalRows
  const rows: RentalRow[] = [];
  const skipped: { docNumber: string; reason: string }[] = [];

  for (const inv of invoices) {
    // Skip voided invoices
    if (inv.Balance === undefined && inv.TotalAmt === 0) continue;

    // Find the "Rental Period" custom field
    const rentalPeriodField = inv.CustomField?.find(
      (cf) =>
        cf.Name?.toLowerCase().includes("rental period") ||
        cf.Name?.toLowerCase().includes("rental dates"),
    );

    if (!rentalPeriodField?.StringValue) {
      skipped.push({
        docNumber: inv.DocNumber ?? inv.Id,
        reason: "No Rental Period custom field",
      });
      continue;
    }

    const parsed = parseRentalPeriod(rentalPeriodField.StringValue);
    if (!parsed) {
      skipped.push({
        docNumber: inv.DocNumber ?? inv.Id,
        reason: `Could not parse rental period: "${rentalPeriodField.StringValue}"`,
      });
      continue;
    }

    // Determine billed amount for this period:
    // If the invoice's TxnDate falls in the target month, billed = total; else 0
    const txnDate = new Date(inv.TxnDate);
    const txnYear = txnDate.getUTCFullYear();
    const txnMonth = txnDate.getUTCMonth() + 1;
    const billedInPeriod =
      txnYear === periodYear && txnMonth === periodMonth
        ? inv.TotalAmt
        : 0;

    const customerName =
      inv.CustomerRef?.name ?? inv.CustomerRef?.value ?? "";

    rows.push({
      contractId: inv.DocNumber ?? inv.Id,
      customerName,
      description: getInvoiceDescription(inv),
      rentalStart: parsed.start,
      rentalEnd: parsed.end,
      totalContractValue: inv.TotalAmt,
      billedAmount: billedInPeriod,
    });
  }

  // Filter to only invoices whose rental period overlaps the target month
  const periodStart = new Date(periodYear, periodMonth - 1, 1);
  const periodEnd = new Date(periodYear, periodMonth, 0); // last day of month

  const overlapping = rows.filter((r) => {
    return r.rentalEnd >= periodStart && r.rentalStart <= periodEnd;
  });

  if (overlapping.length === 0) {
    return NextResponse.json({
      message: "No invoices with rental periods overlapping this month",
      totalInvoicesFetched: invoices.length,
      skipped,
    });
  }

  // Calculate accruals/deferrals
  const { lines, totals } = calculateAll(overlapping, periodYear, periodMonth);

  // Store in revenue_schedules / revenue_line_items
  const { data: schedule, error: scheduleError } = await adminClient
    .from("revenue_schedules")
    .upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        source_file_name: "QuickBooks Invoices",
        source_file_path: null,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
        total_earned_revenue: totals.earned,
        total_billed_revenue: totals.billed,
        total_accrued_revenue: totals.accrual,
        total_deferred_revenue: totals.deferral,
        status: "draft",
      },
      { onConflict: "entity_id,period_year,period_month" },
    )
    .select()
    .single();

  if (scheduleError) {
    return NextResponse.json(
      { error: scheduleError.message },
      { status: 500 },
    );
  }

  // Replace old line items
  await adminClient
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

  const { error: lineError } = await adminClient
    .from("revenue_line_items")
    .insert(lineInserts);

  if (lineError) {
    return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  return NextResponse.json({
    scheduleId: schedule.id,
    linesProcessed: lines.length,
    totalInvoicesFetched: invoices.length,
    skippedCount: skipped.length,
    skipped: skipped.length > 0 ? skipped : undefined,
    totals,
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface QBOCustomField {
  DefinitionId?: string;
  Name?: string;
  Type?: string;
  StringValue?: string;
}

interface QBOInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  TotalAmt: number;
  Balance?: number;
  CustomerRef?: { value?: string; name?: string };
  CustomField?: QBOCustomField[];
  Line?: Array<{
    Description?: string;
    Amount?: number;
    DetailType?: string;
    SalesItemLineDetail?: { ItemRef?: { name?: string } };
  }>;
  PrivateNote?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse "Rental Period" custom field value.
 * Expected format: "MM/DD/YYYY - MM/DD/YYYY"
 * Also handles: "M/D/YYYY - M/D/YYYY", "MM/DD/YYYY-MM/DD/YYYY" (no spaces)
 */
function parseRentalPeriod(
  value: string,
): { start: Date; end: Date } | null {
  // Match two date-like patterns separated by a dash (with optional spaces)
  const match = value.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  );
  if (!match) return null;

  const start = parseUSDate(match[1]);
  const end = parseUSDate(match[2]);

  if (!start || !end) return null;
  if (end < start) return null;

  return { start, end };
}

/** Parse "MM/DD/YYYY" or "M/D/YYYY" into a Date (UTC midnight). */
function parseUSDate(str: string): Date | null {
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Use UTC to avoid timezone shifts
  return new Date(Date.UTC(year, month - 1, day));
}

/** Extract a meaningful description from the invoice lines. */
function getInvoiceDescription(inv: QBOInvoice): string {
  if (inv.PrivateNote) return inv.PrivateNote;
  const lineDescs = inv.Line?.filter((l) => l.Description)
    .map((l) => l.Description!)
    .slice(0, 2);
  if (lineDescs && lineDescs.length > 0) return lineDescs.join("; ");
  const itemNames = inv.Line?.filter((l) => l.SalesItemLineDetail?.ItemRef?.name)
    .map((l) => l.SalesItemLineDetail!.ItemRef!.name!)
    .slice(0, 2);
  if (itemNames && itemNames.length > 0) return itemNames.join("; ");
  return "";
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

async function refreshTokenIfNeeded(
  connection: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    realm_id: string;
  },
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const expiresAt = new Date(connection.access_token_expires_at);
  const now = new Date();
  const fiveMinBuffer = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > fiveMinBuffer) {
    return connection.access_token;
  }

  const clientId = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Token refresh failed (HTTP ${response.status})`);
  }

  const tokens = await response.json();
  const newExpiry = new Date(
    Date.now() + tokens.expires_in * 1000,
  ).toISOString();

  await adminClient
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: newExpiry,
    })
    .eq("id", connection.id);

  return tokens.access_token as string;
}
