import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("drift_monitored_accounts")
    .select("id, account_id, accounts!inner(name, account_number, account_type, classification)")
    .eq("entity_id", entityId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { entityId, accountIds } = await request.json();

  if (!entityId || !Array.isArray(accountIds)) {
    return NextResponse.json(
      { error: "entityId and accountIds[] required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Delete existing monitored accounts for this entity
  await supabase
    .from("drift_monitored_accounts")
    .delete()
    .eq("entity_id", entityId);

  // Insert new selections
  if (accountIds.length > 0) {
    const rows = accountIds.map((accountId: string) => ({
      entity_id: entityId,
      account_id: accountId,
    }));

    const { error } = await supabase
      .from("drift_monitored_accounts")
      .insert(rows);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, count: accountIds.length });
}
