import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("asset_depreciation_rules")
    .select("*")
    .eq("entity_id", entityId)
    .order("reporting_group");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    entity_id,
    reporting_group,
    book_useful_life_months,
    book_salvage_pct,
    book_depreciation_method,
  } = body;

  if (!entity_id || !reporting_group) {
    return NextResponse.json(
      { error: "entity_id and reporting_group required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("asset_depreciation_rules")
    .insert({
      entity_id,
      reporting_group,
      book_useful_life_months: book_useful_life_months ?? null,
      book_salvage_pct: book_salvage_pct ?? null,
      book_depreciation_method: book_depreciation_method ?? "straight_line",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Rule for "${reporting_group}" already exists` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, book_useful_life_months, book_salvage_pct, book_depreciation_method } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (book_useful_life_months !== undefined)
    updates.book_useful_life_months = book_useful_life_months;
  if (book_salvage_pct !== undefined)
    updates.book_salvage_pct = book_salvage_pct;
  if (book_depreciation_method !== undefined)
    updates.book_depreciation_method = book_depreciation_method;

  const { data, error } = await supabase
    .from("asset_depreciation_rules")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("asset_depreciation_rules")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
