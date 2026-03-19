import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");
  const includeDismissed = searchParams.get("includeDismissed") === "true";

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = await createClient();

  let query = supabase
    .from("drift_alerts")
    .select("*, accounts!inner(name, account_number, account_type, classification)")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!includeDismissed) {
    query = query.eq("is_dismissed", false);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const { alertId, dismissAll, entityId } = await request.json();

  const supabase = await createClient();

  if (dismissAll && entityId) {
    const { error } = await supabase
      .from("drift_alerts")
      .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
      .eq("entity_id", entityId)
      .eq("is_dismissed", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  if (!alertId) {
    return NextResponse.json({ error: "alertId required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("drift_alerts")
    .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
    .eq("id", alertId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
