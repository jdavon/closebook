import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/assets/settings?entityId=...
 * Returns entity-level rental asset settings.
 */
export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("entities")
    .select("id, rental_asset_opening_date, combine_fleet_accum_depr")
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
    combine_fleet_accum_depr: data.combine_fleet_accum_depr ?? false,
  });
}

/**
 * PATCH /api/assets/settings
 * Body: { entityId, rental_asset_opening_date?, combine_fleet_accum_depr? }
 * Fields are optional — the caller only sends what's changing.
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
  const { entityId, rental_asset_opening_date, combine_fleet_accum_depr } = body;

  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const update: {
    rental_asset_opening_date?: string;
    combine_fleet_accum_depr?: boolean;
  } = {};

  if (rental_asset_opening_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rental_asset_opening_date)) {
      return NextResponse.json(
        { error: "rental_asset_opening_date must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    update.rental_asset_opening_date = rental_asset_opening_date;
  }

  if (combine_fleet_accum_depr !== undefined) {
    if (typeof combine_fleet_accum_depr !== "boolean") {
      return NextResponse.json(
        { error: "combine_fleet_accum_depr must be a boolean" },
        { status: 400 }
      );
    }
    update.combine_fleet_accum_depr = combine_fleet_accum_depr;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("entities")
    .update(update)
    .eq("id", entityId)
    .select("id, rental_asset_opening_date, combine_fleet_accum_depr")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entity_id: data.id,
    rental_asset_opening_date: data.rental_asset_opening_date,
    combine_fleet_accum_depr: data.combine_fleet_accum_depr ?? false,
  });
}
