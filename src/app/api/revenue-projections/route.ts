import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// GET — fetch current revenue projections for an entity+period
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

    if (!entityId || !year || !month) {
      return NextResponse.json(
        { error: "entityId, year, and month are required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    const { data: projections, error } = await admin
      .from("revenue_projections")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", Number(year))
      .eq("period_month", Number(month));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ projections: projections ?? [] });
  } catch (err) {
    console.error("GET /api/revenue-projections error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT — upsert revenue projections and auto-snapshot
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { entityId, periodYear, periodMonth, projections } = body as {
      entityId: string;
      periodYear: number;
      periodMonth: number;
      projections: Array<{
        sectionId: string;
        amount: number;
        notes?: string;
      }>;
    };

    if (!entityId || !periodYear || !periodMonth || !projections?.length) {
      return NextResponse.json(
        { error: "entityId, periodYear, periodMonth, and projections are required" },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    // Upsert each projection row
    for (const proj of projections) {
      const { error } = await admin
        .from("revenue_projections")
        .upsert(
          {
            entity_id: entityId,
            period_year: periodYear,
            period_month: periodMonth,
            section_id: proj.sectionId,
            projected_amount: proj.amount,
            notes: proj.notes ?? null,
            updated_by: user.id,
          },
          {
            onConflict: "entity_id,period_year,period_month,section_id",
          }
        );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    // Auto-create today's snapshot for each projection
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
            snapshot_date: new Date().toISOString().split("T")[0],
            source: "manual",
            created_by: user.id,
          },
          {
            onConflict:
              "entity_id,period_year,period_month,section_id,snapshot_date",
          }
        );

      if (error) {
        console.error("Snapshot upsert error:", error.message);
        // Non-fatal — don't fail the main save
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/revenue-projections error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
