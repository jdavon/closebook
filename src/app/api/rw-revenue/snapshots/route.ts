import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — query RentalWorks revenue snapshot history
// Params: entityId (required), startDate, endDate, monthKey
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const monthKey = searchParams.get("monthKey");
    const includePayload = searchParams.get("includePayload") === "true";

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Default date range: last 90 days
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 90);
    const effectiveStart =
      startDate || defaultStart.toISOString().slice(0, 10);
    const effectiveEnd =
      endDate || new Date().toISOString().slice(0, 10);

    // Fetch snapshot KPIs
    const snapshotFields = [
      "id",
      "snapshot_date",
      "ytd_revenue",
      "current_month_actual",
      "current_month_projected",
      "pipeline_value",
      "quote_opportunities",
      "pipeline_order_count",
      "pipeline_quote_count",
      "closed_invoice_count",
      "date_mode",
      "data_as_of",
      includePayload ? "full_payload" : "",
    ]
      .filter(Boolean)
      .join(", ");

    const { data: snapshots, error: snapErr } = await admin
      .from("rw_revenue_snapshots")
      .select(snapshotFields)
      .eq("entity_id", entityId)
      .gte("snapshot_date", effectiveStart)
      .lte("snapshot_date", effectiveEnd)
      .order("snapshot_date", { ascending: true });

    if (snapErr) {
      return NextResponse.json(
        { error: snapErr.message },
        { status: 500 }
      );
    }

    // If monthKey is provided, also fetch month-level trend data
    let monthTrend = null;
    if (monthKey) {
      const { data: monthData, error: monthErr } = await admin
        .from("rw_revenue_snapshot_months")
        .select(
          "snapshot_date, month_key, month_label, closed, pending, pipeline, forecast, billed, earned, accrued, deferred"
        )
        .eq("entity_id", entityId)
        .eq("month_key", monthKey)
        .gte("snapshot_date", effectiveStart)
        .lte("snapshot_date", effectiveEnd)
        .order("snapshot_date", { ascending: true });

      if (!monthErr) {
        monthTrend = monthData;
      }
    }

    return NextResponse.json({
      entityId,
      dateRange: { start: effectiveStart, end: effectiveEnd },
      snapshots: snapshots ?? [],
      monthTrend,
    });
  } catch (err) {
    console.error("GET /api/rw-revenue/snapshots error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
