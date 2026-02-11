import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/paylocity/disconnect
 * Removes Paylocity connection for an entity.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId } = await request.json();

  if (!entityId) {
    return NextResponse.json(
      { error: "Missing entityId" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("paylocity_connections")
    .delete()
    .eq("entity_id", entityId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
