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
  const periodYear = searchParams.get("periodYear");
  const periodMonth = searchParams.get("periodMonth");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  let query = supabase
    .from("consolidation_eliminations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (periodYear && periodMonth) {
    query = query
      .eq("period_year", parseInt(periodYear))
      .eq("period_month", parseInt(periodMonth));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ eliminations: data });
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
  const {
    organizationId,
    periodYear,
    periodMonth,
    description,
    memo,
    debitMasterAccountId,
    creditMasterAccountId,
    amount,
    eliminationType,
    isRecurring,
  } = body;

  if (
    !organizationId ||
    !periodYear ||
    !periodMonth ||
    !description ||
    !debitMasterAccountId ||
    !creditMasterAccountId ||
    !amount
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (debitMasterAccountId === creditMasterAccountId) {
    return NextResponse.json(
      { error: "Debit and credit accounts must be different" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("consolidation_eliminations")
    .insert({
      organization_id: organizationId,
      period_year: periodYear,
      period_month: periodMonth,
      description,
      memo: memo || null,
      debit_master_account_id: debitMasterAccountId,
      credit_master_account_id: creditMasterAccountId,
      amount,
      elimination_type: eliminationType || "intercompany",
      is_recurring: isRecurring ?? false,
      status: "draft",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ elimination: data }, { status: 201 });
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
  const { id, status } = body;

  if (!id || !status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("consolidation_eliminations")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ elimination: data });
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
    .from("consolidation_eliminations")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
