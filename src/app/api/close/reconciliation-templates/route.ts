import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET /api/close/reconciliation-templates
// POST /api/close/reconciliation-templates
// PUT /api/close/reconciliation-templates
// DELETE /api/close/reconciliation-templates?id=
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

  const { data: templates } = await supabase
    .from("reconciliation_templates")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .order("display_order")
    .order("name");

  return NextResponse.json({ templates: templates ?? [] });
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
    category,
    fieldDefinitions,
    varianceToleranceAmount,
    varianceTolerancePercentage,
  } = body;

  if (!name || !category) {
    return NextResponse.json(
      { error: "name and category are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("reconciliation_templates")
    .insert({
      organization_id: membership.organization_id,
      name,
      description: description || null,
      category,
      field_definitions: fieldDefinitions ?? [],
      variance_tolerance_amount: varianceToleranceAmount ?? null,
      variance_tolerance_percentage: varianceTolerancePercentage ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ template: data });
}

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
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.fieldDefinitions !== undefined) updateData.field_definitions = updates.fieldDefinitions;
  if (updates.varianceToleranceAmount !== undefined) updateData.variance_tolerance_amount = updates.varianceToleranceAmount;
  if (updates.varianceTolerancePercentage !== undefined) updateData.variance_tolerance_percentage = updates.varianceTolerancePercentage;
  if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

  const { error } = await supabase
    .from("reconciliation_templates")
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
    .from("reconciliation_templates")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
