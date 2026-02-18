import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mappings } = await request.json();

  if (!Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json(
      { error: "mappings array is required and must not be empty" },
      { status: 400 }
    );
  }

  const rows = mappings.map(
    (m: { masterAccountId: string; entityId: string; accountId: string }) => ({
      master_account_id: m.masterAccountId,
      entity_id: m.entityId,
      account_id: m.accountId,
      created_by: user.id,
    })
  );

  const { data, error } = await supabase
    .from("master_account_mappings")
    .insert(rows)
    .select();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "One or more entity accounts are already mapped" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { mappings: data, count: data?.length ?? 0 },
    { status: 201 }
  );
}
