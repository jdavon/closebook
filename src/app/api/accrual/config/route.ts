import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/accrual/config?entityId= — fetch realization rate + notes
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
      .from("entity_accrual_config")
      .select("entity_id, realization_rate, notes, updated_at, updated_by")
      .eq("entity_id", entityId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Default: no rule set, rate = 1.0 (no discount expected)
    return NextResponse.json({
      entityId,
      realizationRate: data?.realization_rate ?? 1.0,
      notes: data?.notes ?? null,
      updatedAt: data?.updated_at ?? null,
      updatedBy: data?.updated_by ?? null,
      hasRule: Boolean(data),
    });
  } catch (err) {
    console.error("GET /api/accrual/config error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT /api/accrual/config — upsert realization rate + notes
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { entityId, realizationRate, notes } = body as {
      entityId: string;
      realizationRate: number;
      notes?: string | null;
    };

    if (!entityId || typeof realizationRate !== "number") {
      return NextResponse.json(
        { error: "entityId and realizationRate (number) are required" },
        { status: 400 },
      );
    }
    if (realizationRate < 0 || realizationRate > 1) {
      return NextResponse.json(
        { error: "realizationRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("entity_accrual_config")
      .upsert(
        {
          entity_id: entityId,
          realization_rate: realizationRate,
          notes: notes ?? null,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entity_id" },
      )
      .select("entity_id, realization_rate, notes, updated_at, updated_by")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      entityId: data.entity_id,
      realizationRate: data.realization_rate,
      notes: data.notes,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
      hasRule: true,
    });
  } catch (err) {
    console.error("PUT /api/accrual/config error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
