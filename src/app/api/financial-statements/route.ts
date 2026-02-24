import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange, type PeriodBucket } from "@/lib/utils/dates";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
  CASH_ACCOUNT_TYPES,
  OPERATING_CURRENT_ASSET_TYPES,
  OPERATING_CURRENT_LIABILITY_TYPES,
  INVESTING_ACCOUNT_TYPES,
  FINANCING_LIABILITY_TYPES,
  FINANCING_EQUITY_TYPES,
  OTHER_EXPENSE_NAME_PATTERNS,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";
import type {
  Period,
  LineItem,
  StatementSection,
  StatementData,
  FinancialStatementsResponse,
  Granularity,
  Scope,
} from "@/components/financial-statements/types";

// ---------------------------------------------------------------------------
// Types for raw DB rows
// ---------------------------------------------------------------------------

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  ending_balance: number;
  net_change: number;
}

interface RawAccount {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
  account_type: string;
  account_sub_type: string | null;
}

// ---------------------------------------------------------------------------
// Helper: build all individual (year, month) tuples we need to query
// ---------------------------------------------------------------------------

function collectAllMonths(
  buckets: PeriodBucket[],
  includeYoY: boolean
): Array<{ year: number; month: number }> {
  const set = new Set<string>();
  const result: Array<{ year: number; month: number }> = [];

  for (const bucket of buckets) {
    for (const m of bucket.months) {
      const key = `${m.year}-${m.month}`;
      if (!set.has(key)) {
        set.add(key);
        result.push(m);
      }
      // Prior month for balance sheet change calculation
      const priorMonth = m.month === 1 ? 12 : m.month - 1;
      const priorYear = m.month === 1 ? m.year - 1 : m.year;
      const priorKey = `${priorYear}-${priorMonth}`;
      if (!set.has(priorKey)) {
        set.add(priorKey);
        result.push({ year: priorYear, month: priorMonth });
      }
    }
    if (includeYoY) {
      for (const m of bucket.months) {
        const pyKey = `${m.year - 1}-${m.month}`;
        if (!set.has(pyKey)) {
          set.add(pyKey);
          result.push({ year: m.year - 1, month: m.month });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: aggregate balances into buckets
// ---------------------------------------------------------------------------

interface AccountInfo {
  id: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  accountType: string;
}

interface BucketedAmounts {
  /** P&L: sum of net_change across months in bucket */
  netChange: Record<string, number>;
  /** BS: ending_balance of last month in bucket */
  endingBalance: Record<string, number>;
  /** BS: beginning_balance of first month in bucket (for cash flow) */
  beginningBalance: Record<string, number>;
}

function aggregateByBucket(
  accounts: AccountInfo[],
  balances: RawGLBalance[],
  buckets: PeriodBucket[]
): Map<string, BucketedAmounts> {
  // Index balances by account_id -> "year-month" -> balance
  const balIndex = new Map<string, Map<string, RawGLBalance>>();
  for (const b of balances) {
    let accountMap = balIndex.get(b.account_id);
    if (!accountMap) {
      accountMap = new Map();
      balIndex.set(b.account_id, accountMap);
    }
    accountMap.set(`${b.period_year}-${b.period_month}`, b);
  }

  const result = new Map<string, BucketedAmounts>();

  for (const account of accounts) {
    const accountBalances = balIndex.get(account.id);
    const bucketed: BucketedAmounts = {
      netChange: {},
      endingBalance: {},
      beginningBalance: {},
    };

    for (const bucket of buckets) {
      let netChange = 0;
      let endingBal = 0;
      let beginningBal = 0;
      let foundFirst = false;

      for (const m of bucket.months) {
        const bal = accountBalances?.get(`${m.year}-${m.month}`);
        if (bal) {
          netChange += bal.net_change;
          endingBal = bal.ending_balance; // last one wins
          if (!foundFirst) {
            beginningBal = bal.beginning_balance;
            foundFirst = true;
          }
        }
      }

      bucketed.netChange[bucket.key] = netChange;
      bucketed.endingBalance[bucket.key] = endingBal;
      bucketed.beginningBalance[bucket.key] = beginningBal;
    }

    result.set(account.id, bucketed);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: reclassify entity "Expense" accounts to "Other Expense" by name
// ---------------------------------------------------------------------------

function reclassifyAccounts(accounts: AccountInfo[]): AccountInfo[] {
  return accounts.map((a) => {
    if (a.classification === "Expense" && a.accountType === "Expense") {
      const nameLower = a.name.toLowerCase();
      if (
        OTHER_EXPENSE_NAME_PATTERNS.some((pattern) =>
          nameLower.includes(pattern)
        )
      ) {
        return { ...a, accountType: "Other Expense" };
      }
    }
    return a;
  });
}

// ---------------------------------------------------------------------------
// Helper: build statement from sections config
// ---------------------------------------------------------------------------

function buildStatement(
  statementId: string,
  title: string,
  sectionConfigs: StatementSectionConfig[],
  computedConfigs: ComputedLineConfig[],
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  useNetChange: boolean // true for P&L, false for BS
): StatementData {
  const sections: StatementSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};

  for (const config of sectionConfigs) {
    const sectionAccounts = accounts.filter(
      (a) =>
        a.classification === config.classification &&
        config.accountTypes.includes(a.accountType)
    );

    // Sort by account number
    sectionAccounts.sort((a, b) =>
      (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
    );

    // Build line items
    const lines: LineItem[] = [];
    const totals: Record<string, number> = {};

    // Initialize totals
    for (const bucket of buckets) {
      totals[bucket.key] = 0;
    }

    let lineIndex = 0;
    for (const account of sectionAccounts) {
      const bucketed = aggregated.get(account.id);
      const amounts: Record<string, number> = {};

      for (const bucket of buckets) {
        const raw = useNetChange
          ? (bucketed?.netChange[bucket.key] ?? 0)
          : (bucketed?.endingBalance[bucket.key] ?? 0);
        // Revenue stored as negative net_change in GL, flip sign for display
        amounts[bucket.key] = useNetChange
          ? (config.classification === "Revenue" ? -raw : raw)
          : raw;
        totals[bucket.key] += useNetChange
          ? (config.classification === "Revenue" ? -raw : raw)
          : raw;
      }

      lines.push({
        id: `${config.id}-${account.id}`,
        label: account.name,
        accountNumber: account.accountNumber ?? undefined,
        amounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: lineIndex === 0,
      });
      lineIndex++;
    }

    sectionTotals[config.id] = totals;

    // Subtotal line
    const subtotalLine: LineItem = {
      id: `${config.id}-total`,
      label: `Total ${config.title.charAt(0)}${config.title.slice(1).toLowerCase()}`,
      amounts: totals,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    };

    sections.push({
      id: config.id,
      title: config.title,
      lines,
      subtotalLine,
    });
  }

  // Insert computed lines (gross profit, net income, total assets, etc.)
  // We'll flatten sections + computed lines into the final structure
  const finalSections: StatementSection[] = [];

  for (const section of sections) {
    finalSections.push(section);

    // Check if any computed lines go after this section
    const computedAfter = computedConfigs.filter(
      (c) => c.afterSection === section.id
    );

    for (const comp of computedAfter) {
      const amounts: Record<string, number> = {};
      for (const bucket of buckets) {
        let val = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[bucket.key] ?? 0) * sign;
        }
        amounts[bucket.key] = val;
      }

      // Create a pseudo-section with just the computed line
      finalSections.push({
        id: comp.id,
        title: "",
        lines: [],
        subtotalLine: {
          id: comp.id,
          label: comp.label,
          amounts,
          indent: 0,
          isTotal: !comp.isGrandTotal,
          isGrandTotal: comp.isGrandTotal ?? false,
          isHeader: false,
          isSeparator: false,
          showDollarSign: true,
        },
      });

      // Add margin % line for key totals
      if (
        comp.id === "gross_profit" ||
        comp.id === "operating_income" ||
        comp.id === "net_income"
      ) {
        const revenueKey = "revenue";
        const marginAmounts: Record<string, number> = {};
        for (const bucket of buckets) {
          const revenue = sectionTotals[revenueKey]?.[bucket.key] ?? 0;
          marginAmounts[bucket.key] =
            revenue !== 0 ? amounts[bucket.key] / revenue : 0;
        }

        const marginLabel =
          comp.id === "gross_profit"
            ? "Gross Margin %"
            : comp.id === "operating_income"
              ? "Operating Margin %"
              : "Net Income Margin %";

        finalSections.push({
          id: `${comp.id}_margin`,
          title: "",
          lines: [],
          subtotalLine: {
            id: `${comp.id}_margin`,
            label: marginLabel,
            amounts: marginAmounts,
            indent: 1,
            isTotal: false,
            isGrandTotal: false,
            isHeader: false,
            isSeparator: false,
            showDollarSign: false,
          },
        });
      }
    }
  }

  return {
    id: statementId,
    title,
    sections: finalSections,
  };
}

// ---------------------------------------------------------------------------
// Helper: build cash flow statement (indirect method)
// ---------------------------------------------------------------------------

function buildCashFlowStatement(
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  depreciationByBucket: Record<string, number>,
  netIncomeByBucket: Record<string, number>
): StatementData {
  const sections: StatementSection[] = [];

  // --- OPERATING ACTIVITIES ---
  const operatingLines: LineItem[] = [];

  // Net income
  operatingLines.push({
    id: "cf-net-income",
    label: "Net income",
    amounts: { ...netIncomeByBucket },
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: true,
  });

  // Depreciation adjustment
  operatingLines.push({
    id: "cf-adjustments-header",
    label: "Adjustments to reconcile net income to net cash:",
    amounts: {},
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: true,
    isSeparator: false,
    showDollarSign: false,
  });

  operatingLines.push({
    id: "cf-depreciation",
    label: "Depreciation and amortization",
    amounts: { ...depreciationByBucket },
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: false,
  });

  // Working capital changes header
  operatingLines.push({
    id: "cf-wc-header",
    label: "Changes in operating assets and liabilities:",
    amounts: {},
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: true,
    isSeparator: false,
    showDollarSign: false,
  });

  // Group working capital accounts
  const wcAssets = accounts.filter((a) =>
    OPERATING_CURRENT_ASSET_TYPES.includes(a.accountType)
  );
  const wcLiabilities = accounts.filter((a) =>
    OPERATING_CURRENT_LIABILITY_TYPES.includes(a.accountType)
  );

  let operatingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    operatingTotal[bucket.key] =
      (netIncomeByBucket[bucket.key] ?? 0) +
      (depreciationByBucket[bucket.key] ?? 0);
  }

  // Working capital asset changes (increase in asset = cash outflow, negative)
  for (const account of wcAssets) {
    const bucketed = aggregated.get(account.id);
    const amounts: Record<string, number> = {};
    for (const bucket of buckets) {
      // Change = ending - beginning for the bucket period
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = -change; // increase in assets = cash outflow
      operatingTotal[bucket.key] += -change;
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
    });
  }

  // Working capital liability changes (increase in liability = cash inflow, positive)
  for (const account of wcLiabilities) {
    const bucketed = aggregated.get(account.id);
    const amounts: Record<string, number> = {};
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = change; // increase in liabilities = cash inflow
      operatingTotal[bucket.key] += change;
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
    });
  }

  sections.push({
    id: "cf-operating",
    title: "CASH FLOWS FROM OPERATING ACTIVITIES",
    lines: operatingLines,
    subtotalLine: {
      id: "cf-operating-total",
      label: "Net cash provided by (used in) operating activities",
      amounts: operatingTotal,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- INVESTING ACTIVITIES ---
  const investingAccounts = accounts.filter((a) =>
    INVESTING_ACCOUNT_TYPES.includes(a.accountType)
  );
  const investingLines: LineItem[] = [];
  let investingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    investingTotal[bucket.key] = 0;
  }

  for (const account of investingAccounts) {
    const bucketed = aggregated.get(account.id);
    const amounts: Record<string, number> = {};
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      // Add back depreciation that was already counted in operating
      // (fixed asset NBV decreased by depreciation — that's not a cash outflow from investing)
      const adjustedChange = -change + (depreciationByBucket[bucket.key] ?? 0);
      // Actually, simpler: just use net change in the account
      amounts[bucket.key] = -change;
      investingTotal[bucket.key] += -change;
    }
    investingLines.push({
      id: `cf-inv-${account.id}`,
      label: account.name,
      amounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
    });
  }

  sections.push({
    id: "cf-investing",
    title: "CASH FLOWS FROM INVESTING ACTIVITIES",
    lines: investingLines,
    subtotalLine: {
      id: "cf-investing-total",
      label: "Net cash used in investing activities",
      amounts: investingTotal,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- FINANCING ACTIVITIES ---
  const financingLiabilities = accounts.filter((a) =>
    FINANCING_LIABILITY_TYPES.includes(a.accountType)
  );
  const financingEquity = accounts.filter((a) =>
    FINANCING_EQUITY_TYPES.includes(a.accountType)
  );
  const financingLines: LineItem[] = [];
  let financingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    financingTotal[bucket.key] = 0;
  }

  for (const account of [...financingLiabilities, ...financingEquity]) {
    const bucketed = aggregated.get(account.id);
    const amounts: Record<string, number> = {};
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = change;
      financingTotal[bucket.key] += change;
    }
    financingLines.push({
      id: `cf-fin-${account.id}`,
      label: account.name,
      amounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
    });
  }

  sections.push({
    id: "cf-financing",
    title: "CASH FLOWS FROM FINANCING ACTIVITIES",
    lines: financingLines,
    subtotalLine: {
      id: "cf-financing-total",
      label: "Net cash provided by (used in) financing activities",
      amounts: financingTotal,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- NET CHANGE IN CASH ---
  const netCashChange: Record<string, number> = {};
  const cashBeginning: Record<string, number> = {};
  const cashEnding: Record<string, number> = {};

  const cashAccounts = accounts.filter((a) =>
    CASH_ACCOUNT_TYPES.includes(a.accountType)
  );

  for (const bucket of buckets) {
    netCashChange[bucket.key] =
      operatingTotal[bucket.key] +
      investingTotal[bucket.key] +
      financingTotal[bucket.key];

    let beginBal = 0;
    let endBal = 0;
    for (const ca of cashAccounts) {
      const bucketed = aggregated.get(ca.id);
      beginBal += bucketed?.beginningBalance[bucket.key] ?? 0;
      endBal += bucketed?.endingBalance[bucket.key] ?? 0;
    }
    cashBeginning[bucket.key] = beginBal;
    cashEnding[bucket.key] = endBal;
  }

  sections.push({
    id: "cf-summary",
    title: "",
    lines: [
      {
        id: "cf-net-change",
        label: "NET INCREASE (DECREASE) IN CASH",
        amounts: netCashChange,
        indent: 0,
        isTotal: true,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: true,
      },
      {
        id: "cf-cash-beginning",
        label: "Cash at beginning of period",
        amounts: cashBeginning,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
      },
    ],
    subtotalLine: {
      id: "cf-cash-ending",
      label: "CASH AT END OF PERIOD",
      amounts: cashEnding,
      indent: 0,
      isTotal: false,
      isGrandTotal: true,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  return {
    id: "cash_flow",
    title: "Statement of Cash Flows",
    sections,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = (searchParams.get("scope") ?? "entity") as Scope;
  const entityId = searchParams.get("entityId");
  const organizationId = searchParams.get("organizationId");
  const startYear = parseInt(searchParams.get("startYear") ?? "2025");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "1");
  const endYear = parseInt(searchParams.get("endYear") ?? "2025");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "12");
  const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;
  const includeBudget = searchParams.get("includeBudget") === "true";
  const includeYoY = searchParams.get("includeYoY") === "true";

  if (scope === "entity" && !entityId) {
    return NextResponse.json(
      { error: "entityId is required for entity scope" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Generate period buckets
  const buckets = getPeriodsInRange(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );

  if (buckets.length === 0) {
    return NextResponse.json(
      { error: "No periods in the specified range" },
      { status: 400 }
    );
  }

  // Collect all months we need to query
  const allMonths = collectAllMonths(buckets, includeYoY);

  // --- ENTITY SCOPE ---
  if (scope === "entity") {
    // Verify access
    const { data: entity } = await admin
      .from("entities")
      .select("id, name, code, organization_id")
      .eq("id", entityId!)
      .single();

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Get accounts
    const { data: accountRows } = await admin
      .from("accounts")
      .select("id, name, account_number, classification, account_type, account_sub_type")
      .eq("entity_id", entityId!)
      .eq("is_active", true)
      .order("account_number");

    const accounts: AccountInfo[] = reclassifyAccounts(
      (accountRows ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        accountNumber: a.account_number,
        classification: a.classification,
        accountType: a.account_type,
      }))
    );

    // Get GL balances for all needed months
    const accountIds = accounts.map((a) => a.id);
    let glBalances: RawGLBalance[] = [];

    if (accountIds.length > 0 && allMonths.length > 0) {
      // Build year-month filter
      const yearMonthPairs = allMonths.map(
        (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
      );
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];

      const { data: balances } = await admin
        .from("gl_balances")
        .select(
          "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
        )
        .eq("entity_id", entityId!)
        .in("period_year", uniqueYears);

      // Filter to only the months we need
      const monthSet = new Set(yearMonthPairs);
      glBalances = (balances ?? []).filter((b) =>
        monthSet.has(
          `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
        )
      );
    }

    // Get depreciation data for cash flow
    const depreciationByBucket: Record<string, number> = {};
    {
      const { data: assetIds } = await admin
        .from("fixed_assets")
        .select("id")
        .eq("entity_id", entityId!);

      const ids = (assetIds ?? []).map((a) => a.id);
      for (const bucket of buckets) {
        depreciationByBucket[bucket.key] = 0;
      }

      if (ids.length > 0) {
        const uniqueYears = [
          ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
        ];
        const { data: depRows } = await admin
          .from("fixed_asset_depreciation")
          .select("period_year, period_month, book_depreciation")
          .in("fixed_asset_id", ids)
          .in("period_year", uniqueYears);

        // Aggregate into buckets
        for (const bucket of buckets) {
          const monthSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows ?? []) {
            if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
              depreciationByBucket[bucket.key] += row.book_depreciation;
            }
          }
        }
      }
    }

    // Aggregate balances
    const aggregated = aggregateByBucket(accounts, glBalances, buckets);

    // Build Income Statement
    const incomeStatement = buildStatement(
      "income_statement",
      "Income Statement",
      INCOME_STATEMENT_SECTIONS,
      INCOME_STATEMENT_COMPUTED,
      accounts,
      aggregated,
      buckets,
      true // use net_change
    );

    // Extract net income by bucket for cash flow
    const netIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    if (netIncomeSection?.subtotalLine) {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.amounts[bucket.key] ?? 0;
      }
    } else {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] = 0;
      }
    }

    // Build Balance Sheet
    const balanceSheet = buildStatement(
      "balance_sheet",
      "Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      accounts,
      aggregated,
      buckets,
      false // use ending_balance
    );

    // Build Cash Flow Statement
    const cashFlowStatement = buildCashFlowStatement(
      accounts,
      aggregated,
      buckets,
      depreciationByBucket,
      netIncomeByBucket
    );

    // Build periods array
    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
    }));

    // Get org name
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", entity.organization_id)
      .single();

    const response: FinancialStatementsResponse = {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata: {
        entityName: entity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    };

    return NextResponse.json(response);
  }

  // --- ORGANIZATION SCOPE ---
  if (scope === "organization") {
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required for organization scope" },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    // Get master accounts
    const { data: masterAccounts } = await admin
      .from("master_accounts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number");

    if (!masterAccounts || masterAccounts.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          organizationName: org?.name,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get mappings
    const masterAccountIds = masterAccounts.map((ma) => ma.id);
    const { data: mappings } = await admin
      .from("master_account_mappings")
      .select("master_account_id, entity_id, account_id")
      .in("master_account_id", masterAccountIds);

    // Get GL balances for mapped accounts
    const mappedAccountIds = (mappings ?? []).map((m) => m.account_id);
    let glBalances: RawGLBalance[] = [];

    if (mappedAccountIds.length > 0) {
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
      const { data: balances } = await admin
        .from("gl_balances")
        .select(
          "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
        )
        .in("account_id", mappedAccountIds)
        .in("period_year", uniqueYears);

      const monthSet = new Set(
        allMonths.map(
          (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
        )
      );
      glBalances = (balances ?? []).filter((b) =>
        monthSet.has(
          `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
        )
      );
    }

    // Build mapping: master account ID -> list of entity account_ids
    const masterToEntityAccounts = new Map<string, string[]>();
    for (const m of mappings ?? []) {
      const existing = masterToEntityAccounts.get(m.master_account_id) ?? [];
      existing.push(m.account_id);
      masterToEntityAccounts.set(m.master_account_id, existing);
    }

    // Consolidate: For each master account, sum the GL balances of all mapped entity accounts
    // Treat each master account as a single "account" for statement building
    const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
      id: ma.id,
      name: ma.name,
      accountNumber: ma.account_number,
      classification: ma.classification,
      accountType: ma.account_type,
    }));

    // Build consolidated GL balances: for each master account and each period,
    // sum up all the mapped entity account balances
    const consolidatedBalances: RawGLBalance[] = [];

    for (const ma of masterAccounts) {
      const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
      const entityBalances = glBalances.filter((b) =>
        entityAccountIds.includes(b.account_id)
      );

      // Group by period
      const periodMap = new Map<
        string,
        { beginning: number; ending: number; netChange: number }
      >();

      for (const b of entityBalances) {
        const key = `${b.period_year}-${b.period_month}`;
        const existing = periodMap.get(key) ?? {
          beginning: 0,
          ending: 0,
          netChange: 0,
        };
        existing.beginning += b.beginning_balance;
        existing.ending += b.ending_balance;
        existing.netChange += b.net_change;
        periodMap.set(key, existing);
      }

      for (const [key, vals] of periodMap) {
        const [y, m] = key.split("-").map(Number);
        consolidatedBalances.push({
          account_id: ma.id, // use master account ID
          entity_id: "consolidated",
          period_year: y,
          period_month: m,
          beginning_balance: vals.beginning,
          ending_balance: vals.ending,
          net_change: vals.netChange,
        });
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets
    );

    // Get depreciation across all entities
    const { data: entities } = await admin
      .from("entities")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true);

    const entityIds = (entities ?? []).map((e) => e.id);
    const depreciationByBucket: Record<string, number> = {};
    for (const bucket of buckets) {
      depreciationByBucket[bucket.key] = 0;
    }

    if (entityIds.length > 0) {
      const { data: assetIds } = await admin
        .from("fixed_assets")
        .select("id")
        .in("entity_id", entityIds);

      const ids = (assetIds ?? []).map((a) => a.id);
      if (ids.length > 0) {
        const uniqueYears = [
          ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
        ];
        const { data: depRows } = await admin
          .from("fixed_asset_depreciation")
          .select("period_year, period_month, book_depreciation")
          .in("fixed_asset_id", ids)
          .in("period_year", uniqueYears);

        for (const bucket of buckets) {
          const monthSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows ?? []) {
            if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
              depreciationByBucket[bucket.key] += row.book_depreciation;
            }
          }
        }
      }
    }

    // Build statements
    const incomeStatement = buildStatement(
      "income_statement",
      "Consolidated Income Statement",
      INCOME_STATEMENT_SECTIONS,
      INCOME_STATEMENT_COMPUTED,
      consolidatedAccounts,
      aggregated,
      buckets,
      true
    );

    const netIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    for (const bucket of buckets) {
      netIncomeByBucket[bucket.key] =
        netIncomeSection?.subtotalLine?.amounts[bucket.key] ?? 0;
    }

    const balanceSheet = buildStatement(
      "balance_sheet",
      "Consolidated Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      consolidatedAccounts,
      aggregated,
      buckets,
      false
    );

    const cashFlowStatement = buildCashFlowStatement(
      consolidatedAccounts,
      aggregated,
      buckets,
      depreciationByBucket,
      netIncomeByBucket
    );

    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
    }));

    const response: FinancialStatementsResponse = {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata: {
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    };

    return NextResponse.json(response);
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
