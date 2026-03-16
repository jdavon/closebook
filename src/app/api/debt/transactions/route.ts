import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/debt/transactions?debtId=...
 * Fetch all transactions for a debt instrument.
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
    .from("debt_transactions")
    .select("*")
    .eq("debt_instrument_id", debtId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * POST /api/debt/transactions
 * Create a new transaction (draw, payment, fee, etc.) for a debt instrument.
 *
 * Body: {
 *   debt_instrument_id, transaction_date, effective_date, transaction_type,
 *   amount, to_principal?, to_interest?, to_fees?, running_balance?,
 *   reference_number?, description?, statement_date?, notes?
 * }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const {
    debt_instrument_id,
    transaction_date,
    effective_date,
    transaction_type,
    amount,
    to_principal,
    to_interest,
    to_fees,
    running_balance,
    reference_number,
    description,
    statement_date,
    notes,
  } = body;

  if (!debt_instrument_id || !transaction_date || !effective_date || !transaction_type || amount == null) {
    return NextResponse.json(
      { error: "Missing required fields: debt_instrument_id, transaction_date, effective_date, transaction_type, amount" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_transactions")
    .insert({
      debt_instrument_id,
      transaction_date,
      effective_date,
      transaction_type,
      amount,
      to_principal: to_principal ?? 0,
      to_interest: to_interest ?? 0,
      to_fees: to_fees ?? 0,
      running_balance: running_balance ?? null,
      reference_number: reference_number ?? null,
      description: description ?? null,
      statement_date: statement_date ?? null,
      notes: notes ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update current_draw on the instrument if this is an advance or principal payment
  if (["advance", "principal_payment", "payoff"].includes(transaction_type)) {
    // Fetch current instrument
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: instrument } = await (supabase as any)
      .from("debt_instruments")
      .select("current_draw, original_amount")
      .eq("id", debt_instrument_id)
      .single();

    if (instrument) {
      let newDraw = instrument.current_draw ?? instrument.original_amount ?? 0;
      if (transaction_type === "advance") {
        newDraw += Math.abs(amount);
      } else if (transaction_type === "principal_payment") {
        newDraw -= Math.abs(to_principal ?? amount);
      } else if (transaction_type === "payoff") {
        newDraw = 0;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("debt_instruments")
        .update({ current_draw: Math.max(0, newDraw) })
        .eq("id", debt_instrument_id);
    }
  }

  return NextResponse.json(data, { status: 201 });
}
