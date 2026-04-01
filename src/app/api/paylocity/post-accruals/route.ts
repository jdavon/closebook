import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/paylocity/post-accruals
 *
 * Posts draft payroll accruals for a given period/entity and generates
 * auto-reversing entries for the first day of the next period.
 *
 * This is the standard accrual accounting workflow:
 * 1. Month-end: DR Expense / CR Liability (the accrual)
 * 2. Next month day 1: DR Liability / CR Expense (the reversal)
 *
 * When actual payroll hits, the real expense flows through normally
 * and the net effect of the accrual + reversal is zero.
 *
 * Body: { entityId: string, periodYear: number, periodMonth: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, periodYear, periodMonth } = await request.json();

  if (!entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "Missing: entityId, periodYear, periodMonth" },
      { status: 400 }
    );
  }

  // 1. Fetch all draft accruals for this period/entity
  const { data: drafts, error: fetchError } = await supabase
    .from("payroll_accruals")
    .select("*")
    .eq("entity_id", entityId)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .eq("status", "draft");

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!drafts || drafts.length === 0) {
    return NextResponse.json(
      { error: "No draft accruals found for this period" },
      { status: 400 }
    );
  }

  // 2. Calculate the reversal period (next month)
  let reversalYear = periodYear;
  let reversalMonth = periodMonth + 1;
  if (reversalMonth > 12) {
    reversalMonth = 1;
    reversalYear += 1;
  }

  // 3. Mark all drafts as posted and set reversal period
  const draftIds = drafts.map((d) => d.id);
  const { error: postError } = await supabase
    .from("payroll_accruals")
    .update({
      status: "posted",
      reversal_period_year: reversalYear,
      reversal_period_month: reversalMonth,
      updated_at: new Date().toISOString(),
    })
    .in("id", draftIds);

  if (postError) {
    return NextResponse.json({ error: postError.message }, { status: 500 });
  }

  // 4. Delete any existing reversals for this period's accruals in the reversal period
  //    (in case user re-posts after a re-sync)
  await supabase
    .from("payroll_accruals")
    .delete()
    .eq("entity_id", entityId)
    .eq("period_year", reversalYear)
    .eq("period_month", reversalMonth)
    .eq("source", "auto_reversal");

  // 5. Generate auto-reversal entries in the next period
  //    These are the OPPOSITE of the accruals — they reverse the accrued liability
  //    on day 1 of the next month so that when actual payroll posts, the expense
  //    lands cleanly.
  const reversalRows = drafts.map((accrual) => ({
    entity_id: entityId,
    period_year: reversalYear,
    period_month: reversalMonth,
    accrual_type: accrual.accrual_type,
    description: `Reversal: ${accrual.description}`,
    amount: -Math.abs(Number(accrual.amount)),
    source: "auto_reversal",
    status: "posted",
    // Swap debit/credit accounts for the reversal
    account_id: accrual.offset_account_id,
    offset_account_id: accrual.account_id,
    notes: `Auto-reversal of ${periodMonth}/${periodYear} accrual`,
  }));

  if (reversalRows.length > 0) {
    const { error: reversalError } = await supabase
      .from("payroll_accruals")
      .insert(reversalRows);

    if (reversalError) {
      return NextResponse.json(
        { error: `Posted accruals but reversal generation failed: ${reversalError.message}` },
        { status: 500 }
      );
    }
  }

  const totalAmount = drafts.reduce(
    (sum, d) => sum + Math.abs(Number(d.amount)),
    0
  );

  return NextResponse.json({
    success: true,
    posted: draftIds.length,
    reversalsGenerated: reversalRows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    reversalPeriod: `${reversalYear}-${String(reversalMonth).padStart(2, "0")}`,
  });
}
