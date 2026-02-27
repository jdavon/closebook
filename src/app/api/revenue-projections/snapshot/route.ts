import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

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
