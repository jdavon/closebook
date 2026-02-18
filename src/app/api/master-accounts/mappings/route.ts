import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  // Get all mappings for master accounts in this organization
  const { data: mappings, error } = await supabase
    .from("master_account_mappings")
    .select(
      `
      id,
      master_account_id,
      entity_id,
      account_id,
      created_by,
      created_at,
      master_accounts!inner (
        id,
        organization_id,
        account_number,
        name,
        classification
      ),
      accounts!inner (
        id,
        name,
        account_number,
        classification,
        account_type,
        current_balance
      ),
      entities!inner (
        id,
        name,
        code
      )
    `
    )
    .eq("master_accounts.organization_id", organizationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ mappings });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { masterAccountId, entityId, accountId } = body;

  if (!masterAccountId || !entityId || !accountId) {
    return NextResponse.json(
      {
        error:
          "masterAccountId, entityId, and accountId are required",
      },
      { status: 400 }
    );
  }

  const { data: mapping, error } = await supabase
    .from("master_account_mappings")
    .insert({
      master_account_id: masterAccountId,
      entity_id: entityId,
      account_id: accountId,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "This entity account is already mapped to a master account",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ mapping }, { status: 201 });
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
  const { id, masterAccountId } = body;

  if (!id || !masterAccountId) {
    return NextResponse.json(
      { error: "id and masterAccountId are required" },
      { status: 400 }
    );
  }

  const { data: mapping, error } = await supabase
    .from("master_account_mappings")
    .update({ master_account_id: masterAccountId })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ mapping });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("master_account_mappings")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
