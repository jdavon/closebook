import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("custom_vehicle_classes")
    .select("*")
    .eq("entity_id", entityId)
    .order("class_code");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { entity_id, class_code, class_name, reporting_group, master_type } = body;

  if (!entity_id || !class_code || !class_name || !reporting_group || !master_type) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }
  if (!["Vehicle", "Trailer"].includes(master_type)) {
    return NextResponse.json({ error: "master_type must be Vehicle or Trailer" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("custom_vehicle_classes")
    .insert({ entity_id, class_code, class_name, reporting_group, master_type })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: `Class code "${class_code}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, class_code, class_name, reporting_group, master_type } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (class_code !== undefined) updates.class_code = class_code;
  if (class_name !== undefined) updates.class_name = class_name;
  if (reporting_group !== undefined) updates.reporting_group = reporting_group;
  if (master_type !== undefined) {
    if (!["Vehicle", "Trailer"].includes(master_type)) {
      return NextResponse.json({ error: "master_type must be Vehicle or Trailer" }, { status: 400 });
    }
    updates.master_type = master_type;
  }

  const { data, error } = await supabase
    .from("custom_vehicle_classes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: `Class code "${class_code}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("custom_vehicle_classes")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
