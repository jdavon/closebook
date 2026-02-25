import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  if (!organizationId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "organizationId, periodYear, and periodMonth are required" },
      { status: 400 }
    );
  }

  // Verify user has access to this organization
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

  // Get all master accounts for the organization
  const { data: masterAccounts, error: maError } = await adminClient
    .from("master_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("classification")
    .order("display_order")
    .order("account_number")
    .limit(5000);

  if (maError) {
    return NextResponse.json({ error: maError.message }, { status: 500 });
  }

  // Get all mappings for this organization's master accounts
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
      unmappedAccounts: [],
    });
  }

  const { data: mappings, error: mapError } = await adminClient
    .from("master_account_mappings")
    .select(
      `
      id,
      master_account_id,
      entity_id,
      account_id
    `
    )
    .in("master_account_id", masterAccountIds)
    .limit(10000);

  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }

  // Get GL balances for the mapped accounts in the specified period
  const accountIds = (mappings ?? []).map((m) => m.account_id);

  let glBalances: Array<{
    account_id: string;
    entity_id: string;
    ending_balance: number;
    debit_total: number;
    credit_total: number;
    net_change: number;
    beginning_balance: number;
  }> = [];

  if (accountIds.length > 0) {
    const { data: balances, error: balError } = await adminClient
      .from("gl_balances")
      .select(
        "account_id, entity_id, ending_balance, debit_total, credit_total, net_change, beginning_balance"
      )
      .in("account_id", accountIds)
      .eq("period_year", parseInt(periodYear))
      .eq("period_month", parseInt(periodMonth))
      .limit(10000);

    if (balError) {
      return NextResponse.json({ error: balError.message }, { status: 500 });
    }

    // Coerce numeric fields from Supabase strings to JS numbers
    glBalances = (balances ?? []).map((b) => ({
      account_id: b.account_id,
      entity_id: b.entity_id,
      ending_balance: Number(b.ending_balance),
      debit_total: Number(b.debit_total),
      credit_total: Number(b.credit_total),
      net_change: Number(b.net_change),
      beginning_balance: Number(b.beginning_balance),
    }));
  }

  // Get entities for entity names
  const { data: entities } = await adminClient
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(5000);

  // Build consolidated data: for each master account, sum the balances
  // of all mapped entity accounts
  const balancesByAccountId = new Map<
    string,
    {
      ending_balance: number;
      debit_total: number;
      credit_total: number;
      net_change: number;
      beginning_balance: number;
    }
  >();

  for (const bal of glBalances) {
    const existing = balancesByAccountId.get(bal.account_id);
    if (existing) {
      existing.ending_balance += bal.ending_balance;
      existing.debit_total += bal.debit_total;
      existing.credit_total += bal.credit_total;
      existing.net_change += bal.net_change;
      existing.beginning_balance += bal.beginning_balance;
    } else {
      balancesByAccountId.set(bal.account_id, {
        ending_balance: bal.ending_balance,
        debit_total: bal.debit_total,
        credit_total: bal.credit_total,
        net_change: bal.net_change,
        beginning_balance: bal.beginning_balance,
      });
    }
  }

  // Group mappings by master account
  const mappingsByMaster = new Map<
    string,
    Array<{ entity_id: string; account_id: string }>
  >();
  for (const m of mappings ?? []) {
    const existing = mappingsByMaster.get(m.master_account_id) ?? [];
    existing.push({ entity_id: m.entity_id, account_id: m.account_id });
    mappingsByMaster.set(m.master_account_id, existing);
  }

  // Build entity balance breakdowns for each master account
  const glBalancesByKey = new Map<string, typeof glBalances[0]>();
  for (const bal of glBalances) {
    glBalancesByKey.set(`${bal.account_id}:${bal.entity_id}`, bal);
  }

  const entityMap = new Map(
    (entities ?? []).map((e) => [e.id, e])
  );

  const consolidated = (masterAccounts ?? []).map((ma) => {
    const accountMappings = mappingsByMaster.get(ma.id) ?? [];
    let totalEndingBalance = 0;
    let totalDebitTotal = 0;
    let totalCreditTotal = 0;
    let totalNetChange = 0;
    let totalBeginningBalance = 0;

    const entityBreakdown = accountMappings.map((mapping) => {
      const bal = glBalancesByKey.get(
        `${mapping.account_id}:${mapping.entity_id}`
      );
      const entity = entityMap.get(mapping.entity_id);

      const endingBalance = bal?.ending_balance ?? 0;
      const debitTotal = bal?.debit_total ?? 0;
      const creditTotal = bal?.credit_total ?? 0;
      const netChange = bal?.net_change ?? 0;
      const beginningBalance = bal?.beginning_balance ?? 0;

      totalEndingBalance += endingBalance;
      totalDebitTotal += debitTotal;
      totalCreditTotal += creditTotal;
      totalNetChange += netChange;
      totalBeginningBalance += beginningBalance;

      return {
        entityId: mapping.entity_id,
        entityName: entity?.name ?? "Unknown",
        entityCode: entity?.code ?? "???",
        accountId: mapping.account_id,
        endingBalance,
        debitTotal,
        creditTotal,
        netChange,
        beginningBalance,
      };
    });

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
      endingBalance: totalEndingBalance,
      debitTotal: totalDebitTotal,
      creditTotal: totalCreditTotal,
      netChange: totalNetChange,
      beginningBalance: totalBeginningBalance,
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

  for (const item of consolidated) {
    switch (item.classification) {
      case "Asset":
        totals.totalAssets += item.endingBalance;
        break;
      case "Liability":
        totals.totalLiabilities += item.endingBalance;
        break;
      case "Equity":
        totals.totalEquity += item.endingBalance;
        break;
      case "Revenue":
        totals.totalRevenue += item.endingBalance;
        break;
      case "Expense":
        totals.totalExpenses += item.endingBalance;
        break;
    }
  }

  // Find unmapped accounts across all entities
  const allMappedAccountIds = new Set(accountIds);
  const entityIds = (entities ?? []).map((e) => e.id);

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
      .select("id, entity_id, name, account_number, classification, current_balance")
      .in("entity_id", entityIds)
      .eq("is_active", true)
      .limit(10000);

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
    unmappedAccounts,
  });
}
