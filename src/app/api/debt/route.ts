import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/debt
 * Create a new debt instrument manually.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const {
    entity_id,
    instrument_name,
    lender_name,
    debt_type,
    original_amount,
    interest_rate,
    term_months,
    start_date,
    maturity_date,
    payment_amount,
    credit_limit,
    current_draw,
    loan_number,
    payment_structure,
    day_count_convention,
    rate_type,
    index_rate_name,
    spread_margin,
    balloon_amount,
    is_secured,
    collateral_description,
    notes,
  } = body;

  if (!entity_id || !instrument_name || !original_amount || !start_date) {
    return NextResponse.json(
      { error: "Missing required fields: entity_id, instrument_name, original_amount, start_date" },
      { status: 400 }
    );
  }

  // Normalize rate if passed as percentage
  const normalizedRate = interest_rate > 1 ? interest_rate / 100 : interest_rate;
  const normalizedSpread = spread_margin != null && spread_margin > 1 ? spread_margin / 100 : spread_margin;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_instruments")
    .insert({
      entity_id,
      instrument_name,
      lender_name: lender_name || null,
      debt_type: debt_type || "term_loan",
      original_amount,
      interest_rate: normalizedRate || 0,
      term_months: term_months || null,
      start_date,
      maturity_date: maturity_date || null,
      payment_amount: payment_amount || null,
      credit_limit: credit_limit || null,
      current_draw: current_draw || null,
      loan_number: loan_number || null,
      payment_structure: payment_structure || "principal_and_interest",
      day_count_convention: day_count_convention || "30/360",
      rate_type: rate_type || "fixed",
      index_rate_name: index_rate_name || null,
      spread_margin: normalizedSpread || null,
      balloon_amount: balloon_amount || null,
      is_secured: is_secured || false,
      collateral_description: collateral_description || null,
      notes: notes || null,
      status: "active",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
