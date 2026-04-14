import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shape of a close line submitted from the client
interface IncomingLine {
  lineType: "unbilled_earned" | "timing_accrual" | "timing_deferral";
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  customer?: string | null;
  orderDescription?: string | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  grossAmount: number;
  realizationRateApplied: number;
  expectedDiscount?: number;
  netAmount: number;
}

// GET /api/accrual/closes?entityId= — list closes (most recent first)
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const entityId = new URL(request.url).searchParams.get("entityId");
    if (!entityId) {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("accrual_close_periods")
      .select("*")
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ closes: data ?? [] });
  } catch (err) {
    console.error("GET /api/accrual/closes error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accrual/closes — create an immutable close snapshot
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
      entityId,
      periodYear,
      periodMonth,
      closeAsOfDate,
      realizationRate,
      lines,
      notes,
    } = body as {
      entityId: string;
      periodYear: number;
      periodMonth: number;
      closeAsOfDate: string; // "YYYY-MM-DD"
      realizationRate: number;
      lines: IncomingLine[];
      notes?: string | null;
    };

    if (!entityId || !periodYear || !periodMonth || !closeAsOfDate) {
      return NextResponse.json(
        { error: "entityId, periodYear, periodMonth, closeAsOfDate are required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(lines)) {
      return NextResponse.json({ error: "lines must be an array" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Reject duplicate close for same period (immutability)
    const { data: existing } = await admin
      .from("accrual_close_periods")
      .select("id, status")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Period ${periodYear}-${String(periodMonth).padStart(2, "0")} is already closed (${existing.status}). Closes are immutable.` },
        { status: 409 },
      );
    }

    // Aggregate totals from lines
    let grossUnbilledEarned = 0;
    let expectedDiscount = 0;
    let netUnbilledEarned = 0;
    let timingAccrual = 0;
    let timingDeferral = 0;

    for (const line of lines) {
      if (line.lineType === "unbilled_earned") {
        grossUnbilledEarned += line.grossAmount;
        expectedDiscount += line.expectedDiscount ?? 0;
        netUnbilledEarned += line.netAmount;
      } else if (line.lineType === "timing_accrual") {
        timingAccrual += line.netAmount;
      } else if (line.lineType === "timing_deferral") {
        timingDeferral += line.netAmount;
      }
    }

    const totalNetAccrual = timingAccrual + netUnbilledEarned;
    const totalNetDeferral = timingDeferral;

    // Create the close period
    const { data: period, error: periodErr } = await admin
      .from("accrual_close_periods")
      .insert({
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        close_as_of_date: closeAsOfDate,
        realization_rate_used: realizationRate,
        gross_unbilled_earned: round2(grossUnbilledEarned),
        expected_discount: round2(expectedDiscount),
        net_unbilled_earned: round2(netUnbilledEarned),
        timing_accrual: round2(timingAccrual),
        timing_deferral: round2(timingDeferral),
        total_net_accrual: round2(totalNetAccrual),
        total_net_deferral: round2(totalNetDeferral),
        line_count: lines.length,
        notes: notes ?? null,
        closed_by: user.id,
        status: "closed",
      })
      .select()
      .single();

    if (periodErr || !period) {
      return NextResponse.json(
        { error: periodErr?.message ?? "Failed to create close period" },
        { status: 500 },
      );
    }

    // Insert lines
    if (lines.length > 0) {
      const rows = lines.map((line) => ({
        close_period_id: period.id,
        entity_id: entityId,
        line_type: line.lineType,
        order_number: line.orderNumber ?? null,
        invoice_number: line.invoiceNumber ?? null,
        customer: line.customer ?? null,
        order_description: line.orderDescription ?? null,
        rental_start_date: line.rentalStartDate ?? null,
        rental_end_date: line.rentalEndDate ?? null,
        gross_amount: round2(line.grossAmount),
        realization_rate_applied: line.realizationRateApplied,
        expected_discount: round2(line.expectedDiscount ?? 0),
        net_amount: round2(line.netAmount),
        line_status: "accrued" as const,
      }));

      const { error: linesErr } = await admin
        .from("accrual_close_lines")
        .insert(rows);

      if (linesErr) {
        // Rollback the period if lines fail
        await admin.from("accrual_close_periods").delete().eq("id", period.id);
        return NextResponse.json(
          { error: `Failed to insert close lines: ${linesErr.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ closeId: period.id, period });
  } catch (err) {
    console.error("POST /api/accrual/closes error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
