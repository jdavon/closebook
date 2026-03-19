import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET /api/close/materiality — List materiality thresholds for the user's org
// POST /api/close/materiality — Create a new threshold
// ---------------------------------------------------------------------------

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization" }, { status: 404 });
  }

  const { data: thresholds } = await supabase
    .from("materiality_thresholds")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .order("created_at");

  return NextResponse.json({ thresholds: thresholds ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization" }, { status: 404 });
  }

  const body = await request.json();
  const {
    name,
    description,
    thresholdAmount,
    thresholdPercentage,
    appliesToCategory,
    appliesToPhase,
    isActive,
  } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("materiality_thresholds")
    .insert({
      organization_id: membership.organization_id,
      name,
      description: description || null,
      threshold_amount: thresholdAmount ?? null,
      threshold_percentage: thresholdPercentage ?? null,
      applies_to_category: appliesToCategory || null,
      applies_to_phase: appliesToPhase || null,
      is_active: isActive ?? true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ threshold: data });
}

// ---------------------------------------------------------------------------
// PUT /api/close/materiality — Update a threshold
// DELETE /api/close/materiality — Delete a threshold
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description || null;
  if (updates.thresholdAmount !== undefined) updateData.threshold_amount = updates.thresholdAmount;
  if (updates.thresholdPercentage !== undefined) updateData.threshold_percentage = updates.thresholdPercentage;
  if (updates.appliesToCategory !== undefined) updateData.applies_to_category = updates.appliesToCategory || null;
  if (updates.appliesToPhase !== undefined) updateData.applies_to_phase = updates.appliesToPhase || null;
  if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

  const { error } = await supabase
    .from("materiality_thresholds")
    .update(updateData)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("materiality_thresholds")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
