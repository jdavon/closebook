import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import type { GateCheckStatus } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// GET /api/close/gate-checks?closePeriodId=
// Returns current gate check statuses
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const closePeriodId = url.searchParams.get("closePeriodId");

  if (!closePeriodId) {
    return NextResponse.json(
      { error: "closePeriodId is required" },
      { status: 400 }
    );
  }

  const { data: checks } = await supabase
    .from("close_gate_checks")
    .select("*")
    .eq("close_period_id", closePeriodId)
    .order("created_at");

  return NextResponse.json({ checks: checks ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/close/gate-checks
// Runs all gate checks for a period and updates statuses
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { closePeriodId } = body;

  if (!closePeriodId) {
    return NextResponse.json(
      { error: "closePeriodId is required" },
      { status: 400 }
    );
  }

  // Load period details
  const { data: period } = await supabase
    .from("close_periods")
    .select("*")
    .eq("id", closePeriodId)
    .single();

  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  const entityId = period.entity_id;
  const periodYear = period.period_year;
  const periodMonth = period.period_month;

  // Get org info
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Run all checks
  const results: Array<{
    checkType: string;
    status: GateCheckStatus;
    resultData: Record<string, unknown>;
  }> = [];

  // --- Check 1: Trial Balance Footing (Dr = Cr) ---
  try {
    const glBalances = await fetchAllPaginated<{
      debit_total: number;
      credit_total: number;
    }>((offset, limit) =>
      admin
        .from("gl_balances")
        .select("debit_total, credit_total, account_id, accounts!inner(id)")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .range(offset, offset + limit - 1)
    );

    let totalDebits = 0;
    let totalCredits = 0;
    for (const row of glBalances) {
      totalDebits += Number(row.debit_total ?? 0);
      totalCredits += Number(row.credit_total ?? 0);
    }

    totalDebits = Math.round(totalDebits * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;
    const variance = Math.round((totalDebits - totalCredits) * 100) / 100;
    const isBalanced = Math.abs(variance) < 0.01;

    results.push({
      checkType: "trial_balance_footing",
      status: glBalances.length === 0 ? "skipped" : isBalanced ? "passed" : "failed",
      resultData: {
        totalDebits,
        totalCredits,
        variance,
        accountCount: glBalances.length,
      },
    });
  } catch (err) {
    console.error("TB footing check error:", err);
    results.push({
      checkType: "trial_balance_footing",
      status: "warning",
      resultData: { error: "Failed to run check" },
    });
  }

  // --- Check 2: Balance Sheet Balance (A = L + E) ---
  try {
    const glBalances = await fetchAllPaginated<{
      ending_balance: number;
      accounts: { classification: string };
    }>((offset, limit) =>
      admin
        .from("gl_balances")
        .select("ending_balance, accounts!inner(id, classification)")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .range(offset, offset + limit - 1)
    );

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const row of glBalances) {
      const bal = Number(row.ending_balance ?? 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const classification = (row as any).accounts?.classification;
      if (classification === "Asset") totalAssets += bal;
      else if (classification === "Liability") totalLiabilities += bal;
      else if (classification === "Equity") totalEquity += bal;
    }

    totalAssets = Math.round(totalAssets * 100) / 100;
    totalLiabilities = Math.round(totalLiabilities * 100) / 100;
    totalEquity = Math.round(totalEquity * 100) / 100;
    const difference = Math.round(
      (totalAssets - totalLiabilities - totalEquity) * 100
    ) / 100;
    const isBalanced = Math.abs(difference) < 0.01;

    results.push({
      checkType: "balance_sheet_balance",
      status: glBalances.length === 0 ? "skipped" : isBalanced ? "passed" : "failed",
      resultData: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        difference,
      },
    });
  } catch (err) {
    console.error("BS balance check error:", err);
    results.push({
      checkType: "balance_sheet_balance",
      status: "warning",
      resultData: { error: "Failed to run check" },
    });
  }

  // --- Check 3: Intercompany Net-Zero ---
  try {
    // Only relevant if org has multiple entities
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id")
      .eq("organization_id", membership?.organization_id ?? "")
      .eq("is_active", true);

    if (!orgEntities || orgEntities.length <= 1) {
      results.push({
        checkType: "intercompany_net_zero",
        status: "skipped",
        resultData: { reason: "Single entity — no intercompany balances" },
      });
    } else {
      // Look for accounts with intercompany patterns
      const entityIds = orgEntities.map((e: { id: string }) => e.id);
      const { data: icAccounts } = await admin
        .from("accounts")
        .select("id, entity_id, name")
        .in("entity_id", entityIds)
        .eq("is_active", true)
        .or("name.ilike.%due from%,name.ilike.%due to%,name.ilike.%intercompany%");

      if (!icAccounts || icAccounts.length === 0) {
        results.push({
          checkType: "intercompany_net_zero",
          status: "skipped",
          resultData: { reason: "No intercompany accounts found" },
        });
      } else {
        const icAccountIds = icAccounts.map((a: { id: string }) => a.id);
        const icBalances = await fetchAllPaginated<{
          account_id: string;
          entity_id: string;
          ending_balance: number;
        }>((offset, limit) =>
          admin
            .from("gl_balances")
            .select("account_id, entity_id, ending_balance")
            .in("account_id", icAccountIds)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .range(offset, offset + limit - 1)
        );

        let netBalance = 0;
        for (const row of icBalances) {
          netBalance += Number(row.ending_balance ?? 0);
        }
        netBalance = Math.round(netBalance * 100) / 100;
        const isNetZero = Math.abs(netBalance) < 0.01;

        results.push({
          checkType: "intercompany_net_zero",
          status: isNetZero ? "passed" : "failed",
          resultData: {
            netBalance,
            icAccountCount: icAccounts.length,
            icBalanceCount: icBalances.length,
          },
        });
      }
    }
  } catch (err) {
    console.error("IC net-zero check error:", err);
    results.push({
      checkType: "intercompany_net_zero",
      status: "warning",
      resultData: { error: "Failed to run check" },
    });
  }

  // --- Check 4: Debt Reconciliation ---
  try {
    const { data: debtRecons } = await admin
      .from("debt_reconciliations")
      .select("gl_account_group, is_reconciled, variance")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    if (!debtRecons || debtRecons.length === 0) {
      results.push({
        checkType: "debt_reconciliation",
        status: "skipped",
        resultData: { reason: "No debt reconciliation data for this period" },
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unreconciled = debtRecons.filter((r: any) => !r.is_reconciled);
      results.push({
        checkType: "debt_reconciliation",
        status: unreconciled.length === 0 ? "passed" : "failed",
        resultData: {
          totalGroups: debtRecons.length,
          reconciledGroups: debtRecons.length - unreconciled.length,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          unreconciledGroups: unreconciled.map((r: any) => ({
            group: r.gl_account_group,
            variance: r.variance,
          })),
        },
      });
    }
  } catch (err) {
    console.error("Debt recon check error:", err);
    results.push({
      checkType: "debt_reconciliation",
      status: "warning",
      resultData: { error: "Failed to run check" },
    });
  }

  // --- Check 5: Asset Reconciliation ---
  try {
    const { data: assetRecons } = await admin
      .from("asset_reconciliations")
      .select("gl_account_group, is_reconciled, variance")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    if (!assetRecons || assetRecons.length === 0) {
      results.push({
        checkType: "asset_reconciliation",
        status: "skipped",
        resultData: { reason: "No asset reconciliation data for this period" },
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unreconciled = assetRecons.filter((r: any) => !r.is_reconciled);
      results.push({
        checkType: "asset_reconciliation",
        status: unreconciled.length === 0 ? "passed" : "failed",
        resultData: {
          totalGroups: assetRecons.length,
          reconciledGroups: assetRecons.length - unreconciled.length,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          unreconciledGroups: unreconciled.map((r: any) => ({
            group: r.gl_account_group,
            variance: r.variance,
          })),
        },
      });
    }
  } catch (err) {
    console.error("Asset recon check error:", err);
    results.push({
      checkType: "asset_reconciliation",
      status: "warning",
      resultData: { error: "Failed to run check" },
    });
  }

  // Update all gate check rows
  for (const result of results) {
    await supabase
      .from("close_gate_checks")
      .update({
        status: result.status,
        result_data: result.resultData,
        checked_at: new Date().toISOString(),
      })
      .eq("close_period_id", closePeriodId)
      .eq("check_type", result.checkType);
  }

  // Return updated checks
  const { data: updatedChecks } = await supabase
    .from("close_gate_checks")
    .select("*")
    .eq("close_period_id", closePeriodId)
    .order("created_at");

  return NextResponse.json({ checks: updatedChecks ?? [] });
}
