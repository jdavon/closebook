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

  // Recalculate current_draw and running balances for all transactions
  await recalculateCurrentDraw(supabase, debt_instrument_id);

  return NextResponse.json(data, { status: 201 });
}

/**
 * PATCH /api/debt/transactions
 * Update an existing transaction and recalculate the instrument's current_draw
 * by replaying all balance-affecting transactions from scratch.
 *
 * Body: { id, ...fields_to_update }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
  }

  // Fetch existing transaction to get debt_instrument_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("debt_transactions")
    .select("debt_instrument_id")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // Update the transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("debt_transactions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recalculate current_draw by replaying all transactions
  await recalculateCurrentDraw(supabase, existing.debt_instrument_id);

  return NextResponse.json(data);
}

/**
 * DELETE /api/debt/transactions?id=...
 * Delete a transaction and recalculate the instrument's current_draw.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing required param: id" }, { status: 400 });
  }

  // Fetch the transaction to get the debt_instrument_id before deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("debt_transactions")
    .select("debt_instrument_id")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("debt_transactions")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recalculate current_draw and running balances
  await recalculateCurrentDraw(supabase, existing.debt_instrument_id);

  return NextResponse.json({ success: true });
}

/**
 * Recalculate an instrument's current_draw by replaying all balance-affecting
 * transactions from the original amount.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recalculateCurrentDraw(supabase: any, debtInstrumentId: string) {
  const { data: instrument } = await supabase
    .from("debt_instruments")
    .select("original_amount")
    .eq("id", debtInstrumentId)
    .single();

  if (!instrument) return;

  const { data: txns } = await supabase
    .from("debt_transactions")
    .select("id, transaction_type, amount, to_principal")
    .eq("debt_instrument_id", debtInstrumentId)
    .order("effective_date", { ascending: true })
    .order("created_at", { ascending: true });

  let balance = instrument.original_amount ?? 0;
  for (const txn of txns ?? []) {
    if (txn.transaction_type === "advance") {
      balance += Math.abs(txn.amount);
    } else if (txn.transaction_type === "principal_payment") {
      balance -= Math.abs(txn.to_principal ?? txn.amount);
    } else if (txn.transaction_type === "payoff") {
      balance = 0;
    }
    balance = Math.max(0, balance);

    // Update running_balance on each transaction
    await supabase
      .from("debt_transactions")
      .update({ running_balance: Math.round(balance * 100) / 100 })
      .eq("id", txn.id);
  }

  await supabase
    .from("debt_instruments")
    .update({ current_draw: Math.max(0, balance) })
    .eq("id", debtInstrumentId);
}
