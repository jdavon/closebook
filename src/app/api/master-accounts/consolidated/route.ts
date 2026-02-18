import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface BalanceBucket {
  ending_balance: number;
  debit_total: number;
  credit_total: number;
  net_change: number;
  beginning_balance: number;
}

function emptyBucket(): BalanceBucket {
  return {
    ending_balance: 0,
    debit_total: 0,
    credit_total: 0,
    net_change: 0,
    beginning_balance: 0,
  };
}

async function fetchPeriodBalances(
  adminClient: ReturnType<typeof createAdminClient>,
  accountIds: string[],
  periodYear: number,
  periodMonth: number
) {
  if (accountIds.length === 0) return [];
  const { data } = await adminClient
    .from("gl_balances")
    .select(
      "account_id, entity_id, ending_balance, debit_total, credit_total, net_change, beginning_balance"
    )
    .in("account_id", accountIds)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth);
  return data ?? [];
}

async function fetchAdjustments(
  adminClient: ReturnType<typeof createAdminClient>,
  entityIds: string[],
  periodYear: number,
  periodMonth: number
) {
  // Adjustments by account_id: maps account_id -> net adjustment amount
  const adjustments = new Map<string, number>();

  if (entityIds.length === 0) return adjustments;

  // 1. Payroll accruals (posted only)
  const { data: payrollAccruals } = await adminClient
    .from("payroll_accruals")
    .select("account_id, offset_account_id, amount, status")
    .in("entity_id", entityIds)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .eq("status", "posted");

  for (const accrual of payrollAccruals ?? []) {
    if (accrual.account_id) {
      adjustments.set(
        accrual.account_id,
        (adjustments.get(accrual.account_id) ?? 0) + accrual.amount
      );
    }
    if (accrual.offset_account_id) {
      adjustments.set(
        accrual.offset_account_id,
        (adjustments.get(accrual.offset_account_id) ?? 0) - accrual.amount
      );
    }
  }

  // 2. Revenue schedule accruals/deferrals
  const { data: revenueSchedules } = await adminClient
    .from("revenue_schedules")
    .select(
      "accrued_account_id, deferred_account_id, revenue_account_id, total_accrued_revenue, total_deferred_revenue, total_earned_revenue"
    )
    .in("entity_id", entityIds)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth);

  for (const rev of revenueSchedules ?? []) {
    if (rev.accrued_account_id && rev.total_accrued_revenue) {
      adjustments.set(
        rev.accrued_account_id,
        (adjustments.get(rev.accrued_account_id) ?? 0) +
          rev.total_accrued_revenue
      );
    }
    if (rev.deferred_account_id && rev.total_deferred_revenue) {
      adjustments.set(
        rev.deferred_account_id,
        (adjustments.get(rev.deferred_account_id) ?? 0) +
          rev.total_deferred_revenue
      );
    }
    if (rev.revenue_account_id && rev.total_earned_revenue) {
      adjustments.set(
        rev.revenue_account_id,
        (adjustments.get(rev.revenue_account_id) ?? 0) +
          rev.total_earned_revenue
      );
    }
  }

  // 3. Fixed asset depreciation
  const { data: assets } = await adminClient
    .from("fixed_assets")
    .select("id, accum_depr_account_id, depr_expense_account_id")
    .in("entity_id", entityIds)
    .eq("status", "active");

  if (assets && assets.length > 0) {
    const assetIds = assets.map((a) => a.id);
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    const { data: depreciations } = await adminClient
      .from("fixed_asset_depreciation")
      .select("fixed_asset_id, book_depreciation")
      .in("fixed_asset_id", assetIds)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    for (const dep of depreciations ?? []) {
      const asset = assetMap.get(dep.fixed_asset_id);
      if (!asset || !dep.book_depreciation) continue;

      if (asset.depr_expense_account_id) {
        adjustments.set(
          asset.depr_expense_account_id,
          (adjustments.get(asset.depr_expense_account_id) ?? 0) +
            dep.book_depreciation
        );
      }
      if (asset.accum_depr_account_id) {
        adjustments.set(
          asset.accum_depr_account_id,
          (adjustments.get(asset.accum_depr_account_id) ?? 0) -
            dep.book_depreciation
        );
      }
    }
  }

  return adjustments;
}

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
  const comparePeriodYear = searchParams.get("comparePeriodYear");
  const comparePeriodMonth = searchParams.get("comparePeriodMonth");

  if (!organizationId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "organizationId, periodYear, and periodMonth are required" },
      { status: 400 }
    );
  }

  // Verify access
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const pYear = parseInt(periodYear);
  const pMonth = parseInt(periodMonth);

  // Get master accounts
  const { data: masterAccounts, error: maError } = await adminClient
    .from("master_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("classification")
    .order("display_order")
    .order("account_number");

  if (maError) {
    return NextResponse.json({ error: maError.message }, { status: 500 });
  }

  const masterAccountIds = (masterAccounts ?? []).map((ma) => ma.id);

  if (masterAccountIds.length === 0) {
    return NextResponse.json({
      consolidated: [],
      totals: {
        totalAssets: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        totalRevenue: 0,
        totalExpenses: 0,
      },
      compareTotals: null,
      unmappedAccounts: [],
      eliminations: [],
    });
  }

  // Get mappings
  const { data: mappings, error: mapError } = await adminClient
    .from("master_account_mappings")
    .select("id, master_account_id, entity_id, account_id")
    .in("master_account_id", masterAccountIds);

  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }

  const accountIds = (mappings ?? []).map((m) => m.account_id);

  // Get entities
  const { data: entities } = await adminClient
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  const entityIds = (entities ?? []).map((e) => e.id);
  const entityMap = new Map((entities ?? []).map((e) => [e.id, e]));

  // Fetch current period balances + adjustments in parallel
  const [glBalances, adjustments] = await Promise.all([
    fetchPeriodBalances(adminClient, accountIds, pYear, pMonth),
    fetchAdjustments(adminClient, entityIds, pYear, pMonth),
  ]);

  // Fetch comparison period if requested
  let compareBalances: typeof glBalances = [];
  let compareAdjustments = new Map<string, number>();
  const hasComparison = comparePeriodYear && comparePeriodMonth;

  if (hasComparison) {
    const cpYear = parseInt(comparePeriodYear);
    const cpMonth = parseInt(comparePeriodMonth);
    [compareBalances, compareAdjustments] = await Promise.all([
      fetchPeriodBalances(adminClient, accountIds, cpYear, cpMonth),
      fetchAdjustments(adminClient, entityIds, cpYear, cpMonth),
    ]);
  }

  // Fetch eliminations for the current period
  const { data: eliminations } = await adminClient
    .from("consolidation_eliminations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("period_year", pYear)
    .eq("period_month", pMonth)
    .eq("status", "posted");

  // Fetch comparison eliminations if needed
  let compareEliminations: typeof eliminations = [];
  if (hasComparison) {
    const { data: cElim } = await adminClient
      .from("consolidation_eliminations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("period_year", parseInt(comparePeriodYear!))
      .eq("period_month", parseInt(comparePeriodMonth!))
      .eq("status", "posted");
    compareEliminations = cElim;
  }

  // Build elimination adjustments by master account
  function buildElimAdjustments(
    elims: typeof eliminations
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of elims ?? []) {
      map.set(
        e.debit_master_account_id,
        (map.get(e.debit_master_account_id) ?? 0) + Number(e.amount)
      );
      map.set(
        e.credit_master_account_id,
        (map.get(e.credit_master_account_id) ?? 0) - Number(e.amount)
      );
    }
    return map;
  }

  const elimAdjustments = buildElimAdjustments(eliminations);
  const compareElimAdjustments = buildElimAdjustments(compareEliminations);

  // Group mappings by master account
  const mappingsByMaster = new Map<
    string,
    Array<{ entity_id: string; account_id: string }>
  >();
  for (const m of mappings ?? []) {
    const arr = mappingsByMaster.get(m.master_account_id) ?? [];
    arr.push({ entity_id: m.entity_id, account_id: m.account_id });
    mappingsByMaster.set(m.master_account_id, arr);
  }

  // Build balance lookup keyed by "account_id:entity_id"
  function buildBalanceMap(
    balances: typeof glBalances
  ): Map<string, (typeof glBalances)[0]> {
    const map = new Map<string, (typeof glBalances)[0]>();
    for (const b of balances) {
      map.set(`${b.account_id}:${b.entity_id}`, b);
    }
    return map;
  }

  const balanceMap = buildBalanceMap(glBalances);
  const compareBalanceMap = buildBalanceMap(compareBalances);

  // Build consolidated accounts
  const consolidated = (masterAccounts ?? []).map((ma) => {
    const acctMappings = mappingsByMaster.get(ma.id) ?? [];
    const current = emptyBucket();
    let adjustmentTotal = 0;
    const compare = emptyBucket();
    let compareAdjTotal = 0;

    const entityBreakdown = acctMappings.map((mapping) => {
      const bal = balanceMap.get(
        `${mapping.account_id}:${mapping.entity_id}`
      );
      const entity = entityMap.get(mapping.entity_id);

      const eb = bal?.ending_balance ?? 0;
      const db = bal?.debit_total ?? 0;
      const cb = bal?.credit_total ?? 0;
      const nc = bal?.net_change ?? 0;
      const bb = bal?.beginning_balance ?? 0;
      const adj = adjustments.get(mapping.account_id) ?? 0;

      current.ending_balance += eb;
      current.debit_total += db;
      current.credit_total += cb;
      current.net_change += nc;
      current.beginning_balance += bb;
      adjustmentTotal += adj;

      // Compare period
      let compareEnding = 0;
      if (hasComparison) {
        const cBal = compareBalanceMap.get(
          `${mapping.account_id}:${mapping.entity_id}`
        );
        const ceb = cBal?.ending_balance ?? 0;
        const cadj = compareAdjustments.get(mapping.account_id) ?? 0;
        compareEnding = ceb + cadj;
        compare.ending_balance += cBal?.ending_balance ?? 0;
        compare.debit_total += cBal?.debit_total ?? 0;
        compare.credit_total += cBal?.credit_total ?? 0;
        compare.net_change += cBal?.net_change ?? 0;
        compare.beginning_balance += cBal?.beginning_balance ?? 0;
      }

      return {
        entityId: mapping.entity_id,
        entityName: entity?.name ?? "Unknown",
        entityCode: entity?.code ?? "???",
        accountId: mapping.account_id,
        endingBalance: eb,
        adjustments: adj,
        adjustedBalance: eb + adj,
        debitTotal: db,
        creditTotal: cb,
        netChange: nc,
        beginningBalance: bb,
        compareEndingBalance: compareEnding,
      };
    });

    const elimAdj = elimAdjustments.get(ma.id) ?? 0;
    const cElimAdj = compareElimAdjustments.get(ma.id) ?? 0;
    const compareAdjustedTotal =
      compare.ending_balance +
      (hasComparison
        ? acctMappings.reduce(
            (s, m) => s + (compareAdjustments.get(m.account_id) ?? 0),
            0
          )
        : 0) +
      cElimAdj;

    return {
      masterAccountId: ma.id,
      accountNumber: ma.account_number,
      name: ma.name,
      description: ma.description,
      classification: ma.classification,
      accountType: ma.account_type,
      normalBalance: ma.normal_balance,
      mappedEntities: entityBreakdown.length,
      entityBreakdown,
      endingBalance: current.ending_balance,
      adjustments: adjustmentTotal,
      eliminationAdjustments: elimAdj,
      adjustedBalance: current.ending_balance + adjustmentTotal + elimAdj,
      debitTotal: current.debit_total,
      creditTotal: current.credit_total,
      netChange: current.net_change,
      beginningBalance: current.beginning_balance,
      compareEndingBalance: hasComparison ? compare.ending_balance : null,
      compareAdjustedBalance: hasComparison ? compareAdjustedTotal : null,
      changeFromCompare: hasComparison
        ? current.ending_balance +
          adjustmentTotal +
          elimAdj -
          compareAdjustedTotal
        : null,
    };
  });

  // Compute classification totals
  const totals = {
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalRevenue: 0,
    totalExpenses: 0,
  };
  const compareTotals = hasComparison
    ? {
        totalAssets: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        totalRevenue: 0,
        totalExpenses: 0,
      }
    : null;

  for (const item of consolidated) {
    const key = `total${item.classification === "Expense" ? "Expenses" : item.classification + "s"}` as keyof typeof totals;
    if (key === "totalExpenses") {
      totals.totalExpenses += item.adjustedBalance;
      if (compareTotals && item.compareAdjustedBalance !== null) {
        compareTotals.totalExpenses += item.compareAdjustedBalance;
      }
    } else {
      totals[key] = (totals[key] ?? 0) + item.adjustedBalance;
      if (compareTotals && item.compareAdjustedBalance !== null) {
        compareTotals[key] =
          (compareTotals[key] ?? 0) + item.compareAdjustedBalance;
      }
    }
  }

  // Find unmapped accounts
  const allMappedAccountIds = new Set(accountIds);
  let unmappedAccounts: Array<{
    id: string;
    entityId: string;
    entityName: string;
    entityCode: string;
    name: string;
    accountNumber: string | null;
    classification: string;
    currentBalance: number;
  }> = [];

  if (entityIds.length > 0) {
    const { data: allAccounts } = await adminClient
      .from("accounts")
      .select(
        "id, entity_id, name, account_number, classification, current_balance"
      )
      .in("entity_id", entityIds)
      .eq("is_active", true);

    unmappedAccounts = (allAccounts ?? [])
      .filter((a) => !allMappedAccountIds.has(a.id))
      .map((a) => {
        const entity = entityMap.get(a.entity_id);
        return {
          id: a.id,
          entityId: a.entity_id,
          entityName: entity?.name ?? "Unknown",
          entityCode: entity?.code ?? "???",
          name: a.name,
          accountNumber: a.account_number,
          classification: a.classification,
          currentBalance: a.current_balance,
        };
      });
  }

  return NextResponse.json({
    consolidated,
    totals,
    compareTotals,
    unmappedAccounts,
    eliminations: eliminations ?? [],
  });
}
