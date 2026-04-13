import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/assets/settings?entityId=...
 * Returns entity-level rental asset settings (currently: opening balance date).
 */
export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("entities")
    .select("id, rental_asset_opening_date")
    .eq("id", entityId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  return NextResponse.json({
    entity_id: data.id,
    rental_asset_opening_date: data.rental_asset_opening_date,
  });
}

/**
 * PATCH /api/assets/settings
 * Body: { entityId, rental_asset_opening_date }
 * Updates the opening balance date for the rental asset register.
 */
export async function PATCH(request: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, rental_asset_opening_date } = body;

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }
  if (!rental_asset_opening_date) {
    return NextResponse.json(
      { error: "rental_asset_opening_date required" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rental_asset_opening_date)) {
    return NextResponse.json(
      { error: "rental_asset_opening_date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("entities")
    .update({ rental_asset_opening_date })
    .eq("id", entityId)
    .select("id, rental_asset_opening_date")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entity_id: data.id,
    rental_asset_opening_date: data.rental_asset_opening_date,
  });
}
