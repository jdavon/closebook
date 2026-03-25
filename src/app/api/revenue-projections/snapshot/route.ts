import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// GET — fetch historical snapshots for an entity/period (powers the Trends chart)
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
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    let query = admin
      .from("revenue_projection_snapshots")
      .select("*")
      .eq("entity_id", entityId)
      .order("snapshot_date", { ascending: true });

    if (year && month) {
      query = query
        .eq("period_year", Number(year))
        .eq("period_month", Number(month));
    }

    const { data: snapshots, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ snapshots: snapshots ?? [] });
  } catch (err) {
    console.error("GET /api/revenue-projections/snapshot error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// POST — store a daily run-rate snapshot
// Can be called by the external tool, a cron job, or manually
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { entityId, periodYear, periodMonth, projections, source } = body as {
      entityId: string;
      periodYear: number;
      periodMonth: number;
      projections: Array<{ sectionId: string; amount: number }>;
      source?: string;
    };

    if (!entityId || !periodYear || !periodMonth || !projections?.length) {
      return NextResponse.json(
        { error: "entityId, periodYear, periodMonth, and projections are required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();
    const snapshotDate = new Date().toISOString().split("T")[0];

    for (const proj of projections) {
      const { error } = await admin
        .from("revenue_projection_snapshots")
        .upsert(
          {
            entity_id: entityId,
            period_year: periodYear,
            period_month: periodMonth,
            section_id: proj.sectionId,
            projected_amount: proj.amount,
            snapshot_date: snapshotDate,
            source: source ?? "manual",
            created_by: user.id,
          },
          {
            onConflict:
              "entity_id,period_year,period_month,section_id,snapshot_date",
          }
        );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, snapshotDate });
  } catch (err) {
    console.error("POST /api/revenue-projections/snapshot error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
