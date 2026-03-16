import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/debt/rates?debtId=...
 * Fetch rate history for a debt instrument.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const debtId = request.nextUrl.searchParams.get("debtId");
  if (!debtId) {
    return NextResponse.json({ error: "Missing debtId" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_rate_history")
    .select("*")
    .eq("debt_instrument_id", debtId)
    .order("effective_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * POST /api/debt/rates
 * Record a rate change for a debt instrument.
 *
 * Body: {
 *   debt_instrument_id, effective_date, interest_rate,
 *   index_rate?, spread?, change_reason?, notes?
 * }
 *
 * Also updates the instrument's current interest_rate.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const {
    debt_instrument_id,
    effective_date,
    interest_rate,
    index_rate,
    spread,
    change_reason,
    notes,
  } = body;

  if (!debt_instrument_id || !effective_date || interest_rate == null) {
    return NextResponse.json(
      { error: "Missing required fields: debt_instrument_id, effective_date, interest_rate" },
      { status: 400 }
    );
  }

  // Normalize rate (if passed as percentage like 9.25, convert to decimal 0.0925)
  const normalizedRate = interest_rate > 1 ? interest_rate / 100 : interest_rate;
  const normalizedIndex = index_rate != null ? (index_rate > 1 ? index_rate / 100 : index_rate) : null;
  const normalizedSpread = spread != null ? (spread > 1 ? spread / 100 : spread) : null;

  // Insert rate history record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_rate_history")
    .insert({
      debt_instrument_id,
      effective_date,
      interest_rate: normalizedRate,
      index_rate: normalizedIndex,
      spread: normalizedSpread,
      change_reason: change_reason ?? null,
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update the instrument's current interest rate to the latest
  // Find the most recent rate change
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: latestRate } = await (supabase as any)
    .from("debt_rate_history")
    .select("interest_rate, spread")
    .eq("debt_instrument_id", debt_instrument_id)
    .order("effective_date", { ascending: false })
    .limit(1)
    .single();

  if (latestRate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("debt_instruments")
      .update({
        interest_rate: latestRate.interest_rate,
        spread_margin: latestRate.spread,
      })
      .eq("id", debt_instrument_id);
  }

  return NextResponse.json(data, { status: 201 });
}
