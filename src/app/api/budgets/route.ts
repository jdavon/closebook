import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
type AnyClient = any;

// GET — list budget versions for an entity
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const admin: AnyClient = createAdminClient();

  const { data: versions, error } = await admin
    .from("budget_versions")
    .select("*")
    .eq("entity_id", entityId)
    .order("fiscal_year", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ versions: versions ?? [] });
}

// POST — create a new budget version
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, name, fiscalYear, notes } = body;

  if (!entityId || !name || !fiscalYear) {
    return NextResponse.json(
      { error: "entityId, name, and fiscalYear are required" },
      { status: 400 }
    );
  }

  const admin: AnyClient = createAdminClient();

  const { data: version, error } = await admin
    .from("budget_versions")
    .insert({
      entity_id: entityId,
      name,
      fiscal_year: fiscalYear,
      notes: notes ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ version });
}

// PATCH — update a budget version (status, is_active, name, notes)
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { versionId, ...updates } = body;

  if (!versionId) {
    return NextResponse.json(
      { error: "versionId is required" },
      { status: 400 }
    );
  }

  const admin: AnyClient = createAdminClient();

  // If setting is_active = true, deactivate other versions for same entity+year
  if (updates.is_active === true) {
    const { data: version } = await (admin as any)
      .from("budget_versions")
      .select("entity_id, fiscal_year")
      .eq("id", versionId)
      .single();

    if (version) {
      await (admin as any)
        .from("budget_versions")
        .update({ is_active: false })
        .eq("entity_id", version.entity_id)
        .eq("fiscal_year", version.fiscal_year)
        .neq("id", versionId);
    }
  }

  const allowedFields: Record<string, unknown> = {};
  if ("name" in updates) allowedFields.name = updates.name;
  if ("notes" in updates) allowedFields.notes = updates.notes;
  if ("status" in updates) allowedFields.status = updates.status;
  if ("is_active" in updates) allowedFields.is_active = updates.is_active;

  const { data: updated, error } = await admin
    .from("budget_versions")
    .update(allowedFields)
    .eq("id", versionId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ version: updated });
}

// DELETE — delete a budget version and its amounts
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");

  if (!versionId) {
    return NextResponse.json(
      { error: "versionId is required" },
      { status: 400 }
    );
  }

  const admin: AnyClient = createAdminClient();

  // Delete amounts first (cascade should handle it, but be explicit)
  await admin
    .from("budget_amounts")
    .delete()
    .eq("budget_version_id", versionId);

  const { error } = await admin
    .from("budget_versions")
    .delete()
    .eq("id", versionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
