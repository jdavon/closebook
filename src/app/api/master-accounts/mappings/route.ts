import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Verify user belongs to this organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Use admin client to bypass RLS — the !inner joins with RLS can
  // silently drop mapping rows when nested table access is restricted.
  // Access is already verified above via organization membership.
  const adminClient = createAdminClient();

  // Paginate to avoid the PostgREST default max-rows cap (1000).
  const PAGE_SIZE = 1000;
  let allMappings: unknown[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await adminClient
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
        accounts (
          id,
          name,
          account_number,
          classification,
          account_type,
          current_balance
        ),
        entities (
          id,
          name,
          code
        )
      `
      )
      .eq("master_accounts.organization_id", organizationId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    allMappings = allMappings.concat(data ?? []);

    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return NextResponse.json({ mappings: allMappings });
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
