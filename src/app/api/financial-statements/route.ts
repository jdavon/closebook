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
// Helper: coerce Supabase numeric(19,4) fields from strings to numbers.
// PostgREST returns numeric/decimal columns as strings, not JS numbers.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGLBalance(row: any): RawGLBalance {
  return {
    account_id: row.account_id,
    entity_id: row.entity_id,
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    beginning_balance: Number(row.beginning_balance),
    ending_balance: Number(row.ending_balance),
    net_change: Number(row.net_change),
  };
}

// ---------------------------------------------------------------------------
// Helper: paginated GL balance fetcher.
// Supabase PostgREST caps responses via PGRST_DB_MAX_ROWS (often 1000).
// Page size must not exceed this limit so pagination detects when more
// rows remain.
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

interface GLQueryFilters {
  filterColumn: "entity_id" | "account_id";
  filterValues: string[];
  years: number[];
  months: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllGLBalances(admin: any, filters: GLQueryFilters): Promise<RawGLBalance[]> {
  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const query = admin
      .from("gl_balances")
      .select(
        "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
      )
      .in(filters.filterColumn, filters.filterValues)
      .in("period_year", filters.years)
      .in("period_month", filters.months)
      .range(offset, offset + GL_PAGE_SIZE - 1);

    const { data, error } = await query;

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(parseGLBalance);
    allRows.push(...rows);

    // If we got fewer rows than page size, we've fetched everything
    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
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
        // Prior month of prior year (needed for cash flow beginning balances)
        const pyPriorMonth = m.month === 1 ? 12 : m.month - 1;
        const pyPriorYear = m.month === 1 ? m.year - 2 : m.year - 1;
        const pyPriorKey = `${pyPriorYear}-${pyPriorMonth}`;
        if (!set.has(pyPriorKey)) {
          set.add(pyPriorKey);
          result.push({ year: pyPriorYear, month: pyPriorMonth });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: create prior year buckets (same keys, months shifted back 1 year)
// ---------------------------------------------------------------------------

function createPriorYearBuckets(buckets: PeriodBucket[]): PeriodBucket[] {
  return buckets.map((b) => ({
    ...b,
    months: b.months.map((m) => ({ year: m.year - 1, month: m.month })),
  }));
}

// ---------------------------------------------------------------------------
// Helper: aggregate budget amounts into period buckets
// ---------------------------------------------------------------------------

interface RawBudgetAmount {
  account_id: string;
  period_month: number;
  period_year: number;
  amount: number;
}

function aggregateBudgetByBucket(
  budgetAmounts: RawBudgetAmount[],
  buckets: PeriodBucket[],
  /** Maps entity account_id -> master account_id */
  entityToMaster: Map<string, string>
): Map<string, Record<string, number>> {
  // Index budget amounts: entity_account_id -> "year-month" -> amount
  const budgetIndex = new Map<string, Map<string, number>>();
  for (const ba of budgetAmounts) {
    let byPeriod = budgetIndex.get(ba.account_id);
    if (!byPeriod) {
      byPeriod = new Map();
      budgetIndex.set(ba.account_id, byPeriod);
    }
    const key = `${ba.period_year}-${ba.period_month}`;
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + Number(ba.amount));
  }

  // Aggregate by master account and bucket
  const result = new Map<string, Record<string, number>>();

  for (const [entityAccountId, periodAmounts] of budgetIndex) {
    const masterAccountId = entityToMaster.get(entityAccountId);
    if (!masterAccountId) continue;

    let masterBuckets = result.get(masterAccountId);
    if (!masterBuckets) {
      masterBuckets = {};
      result.set(masterAccountId, masterBuckets);
    }

    for (const bucket of buckets) {
      for (const m of bucket.months) {
        const periodKey = `${m.year}-${m.month}`;
        const val = periodAmounts.get(periodKey) ?? 0;
        masterBuckets[bucket.key] = (masterBuckets[bucket.key] ?? 0) + val;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: inject pro forma adjustments into consolidated balances
// ---------------------------------------------------------------------------

interface RawProFormaAdjustment {
  master_account_id: string;
  period_year: number;
  period_month: number;
  amount: number;
}

/**
 * Inject pro forma adjustments into consolidatedBalances.
 * Each adjustment adds to net_change (and ending_balance) for the
 * matching master account + period. If no existing balance row exists
 * for that account/period, a new one is created.
 */
function injectProFormaAdjustments(
  consolidatedBalances: RawGLBalance[],
  adjustments: RawProFormaAdjustment[],
  entityId: string
): void {
  const balIndex = new Map<string, RawGLBalance>();
  for (const b of consolidatedBalances) {
    balIndex.set(`${b.account_id}-${b.period_year}-${b.period_month}`, b);
  }

  for (const adj of adjustments) {
    const key = `${adj.master_account_id}-${adj.period_year}-${adj.period_month}`;
    const existing = balIndex.get(key);
    if (existing) {
      existing.net_change += Number(adj.amount);
      existing.ending_balance += Number(adj.amount);
    } else {
      const newBal: RawGLBalance = {
        account_id: adj.master_account_id,
        entity_id: entityId,
        period_year: Number(adj.period_year),
        period_month: Number(adj.period_month),
        beginning_balance: 0,
        ending_balance: Number(adj.amount),
        net_change: Number(adj.amount),
      };
      consolidatedBalances.push(newBal);
      balIndex.set(key, newBal);
    }
  }
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
            // Derive beginning balance from the PRIOR month's ending balance.
            // The DB's beginning_balance may be 0 if the sync didn't populate it.
            // collectAllMonths() already fetches prior-month data for this purpose.
            const priorMonth = m.month === 1 ? 12 : m.month - 1;
            const priorYear = m.month === 1 ? m.year - 1 : m.year;
            const priorBal = accountBalances?.get(`${priorYear}-${priorMonth}`);
            beginningBal = priorBal
              ? priorBal.ending_balance
              : bal.beginning_balance; // fallback to DB value
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
  useNetChange: boolean, // true for P&L, false for BS
  budgetByAccount?: Map<string, Record<string, number>>, // account ID -> bucket key -> budget amount
  pyAggregated?: Map<string, BucketedAmounts> // prior year aggregated data for YoY
): StatementData {
  const sections: StatementSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};
  const sectionBudgetTotals: Record<string, Record<string, number>> = {};
  const sectionPyTotals: Record<string, Record<string, number>> = {};
  const hasBudget = budgetByAccount && budgetByAccount.size > 0;
  const hasPY = !!pyAggregated;

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
    const budgetTotals: Record<string, number> = {};
    const pyTotals: Record<string, number> = {};

    // Initialize totals
    for (const bucket of buckets) {
      totals[bucket.key] = 0;
      budgetTotals[bucket.key] = 0;
      pyTotals[bucket.key] = 0;
    }

    let lineIndex = 0;
    for (const account of sectionAccounts) {
      const bucketed = aggregated.get(account.id);
      const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
      const amounts: Record<string, number> = {};
      const budgetAmounts: Record<string, number> | undefined = hasBudget
        ? {}
        : undefined;
      const priorYearAmounts: Record<string, number> | undefined = hasPY
        ? {}
        : undefined;

      for (const bucket of buckets) {
        const raw = useNetChange
          ? (bucketed?.netChange[bucket.key] ?? 0)
          : (bucketed?.endingBalance[bucket.key] ?? 0);
        // Revenue stored as negative net_change in GL, flip sign for display
        amounts[bucket.key] = useNetChange
          ? (config.classification === "Revenue" ? -raw : raw)
          : raw;
        totals[bucket.key] += amounts[bucket.key];

        // Prior year amounts
        if (hasPY && priorYearAmounts) {
          const pyRaw = useNetChange
            ? (pyBucketed?.netChange[bucket.key] ?? 0)
            : (pyBucketed?.endingBalance[bucket.key] ?? 0);
          priorYearAmounts[bucket.key] = useNetChange
            ? (config.classification === "Revenue" ? -pyRaw : pyRaw)
            : pyRaw;
          pyTotals[bucket.key] += priorYearAmounts[bucket.key];
        }

        // Budget amounts (already stored as positive in budget_amounts table)
        if (hasBudget && budgetAmounts) {
          const acctBudget = budgetByAccount!.get(account.id);
          const budgetVal = acctBudget?.[bucket.key] ?? 0;
          budgetAmounts[bucket.key] = budgetVal;
          budgetTotals[bucket.key] += budgetVal;
        }
      }

      lines.push({
        id: `${config.id}-${account.id}`,
        label: account.name,
        accountNumber: account.accountNumber ?? undefined,
        amounts,
        budgetAmounts,
        priorYearAmounts,
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
    sectionBudgetTotals[config.id] = budgetTotals;
    sectionPyTotals[config.id] = pyTotals;

    // Subtotal line
    const subtotalLine: LineItem = {
      id: `${config.id}-total`,
      label: config.title ? `Total ${config.title}` : "",
      amounts: totals,
      budgetAmounts: hasBudget ? { ...budgetTotals } : undefined,
      priorYearAmounts: hasPY ? { ...pyTotals } : undefined,
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
      const compBudgetAmounts: Record<string, number> | undefined = hasBudget
        ? {}
        : undefined;
      const compPyAmounts: Record<string, number> | undefined = hasPY
        ? {}
        : undefined;

      for (const bucket of buckets) {
        let val = 0;
        let budgetVal = 0;
        let pyVal = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          if (hasBudget) {
            budgetVal +=
              (sectionBudgetTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          }
          if (hasPY) {
            pyVal +=
              (sectionPyTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          }
        }
        amounts[bucket.key] = val;
        if (compBudgetAmounts) {
          compBudgetAmounts[bucket.key] = budgetVal;
        }
        if (compPyAmounts) {
          compPyAmounts[bucket.key] = pyVal;
        }
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
          budgetAmounts: compBudgetAmounts,
          priorYearAmounts: compPyAmounts,
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
        comp.id === "gross_margin" ||
        comp.id === "operating_margin" ||
        comp.id === "net_income"
      ) {
        const revenueKey = "revenue";
        const marginAmounts: Record<string, number> = {};
        const pyMarginAmounts: Record<string, number> | undefined = hasPY
          ? {}
          : undefined;
        for (const bucket of buckets) {
          const revenue = sectionTotals[revenueKey]?.[bucket.key] ?? 0;
          marginAmounts[bucket.key] =
            revenue !== 0 ? amounts[bucket.key] / revenue : 0;
          if (hasPY && pyMarginAmounts && compPyAmounts) {
            const pyRevenue = sectionPyTotals[revenueKey]?.[bucket.key] ?? 0;
            pyMarginAmounts[bucket.key] =
              pyRevenue !== 0 ? compPyAmounts[bucket.key] / pyRevenue : 0;
          }
        }

        const marginLabel =
          comp.id === "gross_margin"
            ? "Gross Margin %"
            : comp.id === "operating_margin"
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
            priorYearAmounts: pyMarginAmounts,
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
  netIncomeByBucket: Record<string, number>,
  pyAggregated?: Map<string, BucketedAmounts>,
  pyDepreciationByBucket?: Record<string, number>,
  pyNetIncomeByBucket?: Record<string, number>
): StatementData {
  const sections: StatementSection[] = [];
  const hasPY = !!pyAggregated;

  // --- OPERATING ACTIVITIES ---
  const operatingLines: LineItem[] = [];

  // Net income
  operatingLines.push({
    id: "cf-net-income",
    label: "Net income",
    amounts: { ...netIncomeByBucket },
    priorYearAmounts: hasPY ? { ...pyNetIncomeByBucket! } : undefined,
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
    priorYearAmounts: hasPY ? { ...pyDepreciationByBucket! } : undefined,
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

  const operatingTotal: Record<string, number> = {};
  const pyOperatingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    operatingTotal[bucket.key] =
      (netIncomeByBucket[bucket.key] ?? 0) +
      (depreciationByBucket[bucket.key] ?? 0);
    pyOperatingTotal[bucket.key] = hasPY
      ? (pyNetIncomeByBucket![bucket.key] ?? 0) +
        (pyDepreciationByBucket![bucket.key] ?? 0)
      : 0;
  }

  // Working capital asset changes (increase in asset = cash outflow, negative)
  for (const account of wcAssets) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = -change;
      operatingTotal[bucket.key] += -change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = -pyChange;
        pyOperatingTotal[bucket.key] += -pyChange;
      }
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
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
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = change;
      operatingTotal[bucket.key] += change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = pyChange;
        pyOperatingTotal[bucket.key] += pyChange;
      }
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
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
      priorYearAmounts: hasPY ? { ...pyOperatingTotal } : undefined,
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
  const investingTotal: Record<string, number> = {};
  const pyInvestingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    investingTotal[bucket.key] = 0;
    pyInvestingTotal[bucket.key] = 0;
  }

  for (const account of investingAccounts) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = -change;
      investingTotal[bucket.key] += -change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = -pyChange;
        pyInvestingTotal[bucket.key] += -pyChange;
      }
    }
    investingLines.push({
      id: `cf-inv-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
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
      priorYearAmounts: hasPY ? { ...pyInvestingTotal } : undefined,
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
  const financingTotal: Record<string, number> = {};
  const pyFinancingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    financingTotal[bucket.key] = 0;
    pyFinancingTotal[bucket.key] = 0;
  }

  for (const account of [...financingLiabilities, ...financingEquity]) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = change;
      financingTotal[bucket.key] += change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = pyChange;
        pyFinancingTotal[bucket.key] += pyChange;
      }
    }
    financingLines.push({
      id: `cf-fin-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
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
      priorYearAmounts: hasPY ? { ...pyFinancingTotal } : undefined,
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
  const pyNetCashChange: Record<string, number> = {};
  const pyCashBeginning: Record<string, number> = {};
  const pyCashEnding: Record<string, number> = {};

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

    if (hasPY) {
      pyNetCashChange[bucket.key] =
        pyOperatingTotal[bucket.key] +
        pyInvestingTotal[bucket.key] +
        pyFinancingTotal[bucket.key];

      let pyBeginBal = 0;
      let pyEndBal = 0;
      for (const ca of cashAccounts) {
        const pyBucketed = pyAggregated!.get(ca.id);
        pyBeginBal += pyBucketed?.beginningBalance[bucket.key] ?? 0;
        pyEndBal += pyBucketed?.endingBalance[bucket.key] ?? 0;
      }
      pyCashBeginning[bucket.key] = pyBeginBal;
      pyCashEnding[bucket.key] = pyEndBal;
    }
  }

  sections.push({
    id: "cf-summary",
    title: "",
    lines: [
      {
        id: "cf-net-change",
        label: "NET INCREASE (DECREASE) IN CASH",
        amounts: netCashChange,
        priorYearAmounts: hasPY ? pyNetCashChange : undefined,
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
        priorYearAmounts: hasPY ? pyCashBeginning : undefined,
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
      priorYearAmounts: hasPY ? pyCashEnding : undefined,
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
  const includeProForma = searchParams.get("includeProForma") === "true";

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

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", entity.organization_id)
      .single();

    // Get master accounts for the organization (same structure as consolidated)
    const { data: masterAccounts } = await admin
      .from("master_accounts")
      .select("*")
      .eq("organization_id", entity.organization_id)
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
          entityName: entity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get mappings for THIS entity only
    const masterAccountIds = masterAccounts.map((ma) => ma.id);
    const { data: mappings } = await admin
      .from("master_account_mappings")
      .select("master_account_id, entity_id, account_id")
      .in("master_account_id", masterAccountIds)
      .eq("entity_id", entityId!)
      .limit(10000);

    // Get GL balances for mapped accounts (paginated to avoid row limit truncation)
    const mappedAccountIds = (mappings ?? []).map((m) => m.account_id);
    let glBalances: RawGLBalance[] = [];

    if (mappedAccountIds.length > 0) {
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
      const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

      const allBalances = await fetchAllGLBalances(admin, {
        filterColumn: "account_id",
        filterValues: mappedAccountIds,
        years: uniqueYears,
        months: uniqueMonthNums,
      });

      const monthSet = new Set(
        allMonths.map(
          (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
        )
      );
      // Filter to exact (year,month) pairs needed
      glBalances = allBalances.filter((b) =>
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

    // Consolidate: For each master account, sum the GL balances of mapped entity accounts
    const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
      id: ma.id,
      name: ma.name,
      accountNumber: ma.account_number,
      classification: ma.classification,
      accountType: ma.account_type,
    }));

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
          entity_id: entityId!,
          period_year: y,
          period_month: m,
          beginning_balance: vals.beginning,
          ending_balance: vals.ending,
          net_change: vals.netChange,
        });
      }
    }

    // --- Pro Forma Adjustments (entity scope) ---
    if (includeProForma) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pro_forma_adjustments not in generated types
      const { data: proFormaRows } = await (admin as any)
        .from("pro_forma_adjustments")
        .select("master_account_id, period_year, period_month, amount")
        .eq("entity_id", entityId!)
        .eq("is_excluded", false);

      if (proFormaRows && proFormaRows.length > 0) {
        injectProFormaAdjustments(
          consolidatedBalances,
          proFormaRows as RawProFormaAdjustment[],
          entityId!
        );
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets
    );

    // Prior year aggregation for YoY
    let pyAggregated: Map<string, BucketedAmounts> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets);
    }

    // Get depreciation data for cash flow
    const depreciationByBucket: Record<string, number> = {};
    const pyDepreciationByBucket: Record<string, number> = {};
    {
      const { data: assetIds } = await admin
        .from("fixed_assets")
        .select("id")
        .eq("entity_id", entityId!);

      const ids = (assetIds ?? []).map((a) => a.id);
      for (const bucket of buckets) {
        depreciationByBucket[bucket.key] = 0;
        pyDepreciationByBucket[bucket.key] = 0;
      }

      if (ids.length > 0) {
        const uniqueYears = [
          ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
        ];
        // Include prior years for YoY depreciation
        const allDepYears = includeYoY
          ? [...new Set([...uniqueYears, ...uniqueYears.map((y) => y - 1)])]
          : uniqueYears;

        const { data: depRows } = await admin
          .from("fixed_asset_depreciation")
          .select("period_year, period_month, book_depreciation")
          .in("fixed_asset_id", ids)
          .in("period_year", allDepYears);

        // Aggregate into buckets
        for (const bucket of buckets) {
          const monthSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows ?? []) {
            if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
              depreciationByBucket[bucket.key] += Number(row.book_depreciation);
            }
          }
        }

        // Prior year depreciation
        if (includeYoY) {
          const pyBuckets = createPriorYearBuckets(buckets);
          for (const bucket of pyBuckets) {
            const monthSet = new Set(
              bucket.months.map((m) => `${m.year}-${m.month}`)
            );
            for (const row of depRows ?? []) {
              if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
                pyDepreciationByBucket[bucket.key] += Number(row.book_depreciation);
              }
            }
          }
        }
      }
    }

    // --------------- Budget data (entity scope) ---------------
    let budgetByAccount: Map<string, Record<string, number>> | undefined;

    if (includeBudget) {
      // Determine which fiscal years we need budgets for
      const budgetYears = [
        ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
      ];

      // Find active budget versions for this entity in those years
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
      const { data: activeVersions } = await (admin as any)
        .from("budget_versions")
        .select("id, fiscal_year")
        .eq("entity_id", entityId!)
        .eq("is_active", true)
        .in("fiscal_year", budgetYears);

      const versionIds = (activeVersions ?? []).map(
        (v: { id: string }) => v.id
      );

      if (versionIds.length > 0) {
        // Fetch budget amounts for those versions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
        const { data: budgetRows } = await (admin as any)
          .from("budget_amounts")
          .select("account_id, period_year, period_month, amount")
          .in("budget_version_id", versionIds);

        // Build reverse mapping: entity account_id -> master_account_id
        const entityToMaster = new Map<string, string>();
        for (const m of mappings ?? []) {
          entityToMaster.set(m.account_id, m.master_account_id);
        }

        budgetByAccount = aggregateBudgetByBucket(
          (budgetRows ?? []) as RawBudgetAmount[],
          buckets,
          entityToMaster
        );
      }
    }

    // Build Income Statement
    const incomeStatement = buildStatement(
      "income_statement",
      "Income Statement",
      INCOME_STATEMENT_SECTIONS,
      INCOME_STATEMENT_COMPUTED,
      consolidatedAccounts,
      aggregated,
      buckets,
      true, // use net_change
      budgetByAccount,
      pyAggregated
    );

    // Extract net income by bucket for cash flow
    const netIncomeByBucket: Record<string, number> = {};
    const pyNetIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    if (netIncomeSection?.subtotalLine) {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.amounts[bucket.key] ?? 0;
        pyNetIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.priorYearAmounts?.[bucket.key] ?? 0;
      }
    } else {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] = 0;
        pyNetIncomeByBucket[bucket.key] = 0;
      }
    }

    // Build Balance Sheet (no budget data — budgets are P&L only)
    const balanceSheet = buildStatement(
      "balance_sheet",
      "Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      consolidatedAccounts,
      aggregated,
      buckets,
      false, // use ending_balance
      undefined, // no budget for BS
      pyAggregated
    );

    // Build Cash Flow Statement
    const cashFlowStatement = buildCashFlowStatement(
      consolidatedAccounts,
      aggregated,
      buckets,
      depreciationByBucket,
      netIncomeByBucket,
      includeYoY ? pyAggregated : undefined,
      includeYoY ? pyDepreciationByBucket : undefined,
      includeYoY ? pyNetIncomeByBucket : undefined
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
      .in("master_account_id", masterAccountIds)
      .limit(10000);

    // Get all active entities for this org (small set, used for GL query)
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const orgEntityIds = (orgEntities ?? []).map((e) => e.id);

    // Build a Set of mapped account IDs for in-memory filtering
    const mappedAccountIdSet = new Set(
      (mappings ?? []).map((m) => m.account_id)
    );

    // Get GL balances by entity_id (small set of ~6 IDs) instead of
    // account_id (1000+ IDs that exceed HTTP URL length limits).
    // Paginated to avoid PostgREST PGRST_DB_MAX_ROWS truncation.
    let glBalances: RawGLBalance[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _debug: any = {
      allMonths,
      orgEntityIds,
      mappedAccountCount: mappedAccountIdSet.size,
      masterAccountCount: masterAccounts.length,
      mappingCount: (mappings ?? []).length,
    };

    if (mappedAccountIdSet.size > 0 && orgEntityIds.length > 0) {
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
      const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];
      _debug.queryFilters = { uniqueYears, uniqueMonthNums };

      // Paginated fetch to avoid PostgREST PGRST_DB_MAX_ROWS truncation
      const allBalances = await fetchAllGLBalances(admin, {
        filterColumn: "entity_id",
        filterValues: orgEntityIds,
        years: uniqueYears,
        months: uniqueMonthNums,
      });

      _debug.rawRowCount = allBalances.length;

      const monthSet = new Set(
        allMonths.map(
          (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
        )
      );
      // Filter to mapped accounts and exact months
      glBalances = allBalances.filter(
        (b) =>
          mappedAccountIdSet.has(b.account_id) &&
          monthSet.has(
            `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
          )
      );

      _debug.filteredRowCount = glBalances.length;

      // Debug: count GL rows per entity for Jan 2026
      const entityRowCounts: Record<string, number> = {};
      const entityNetChangeSums: Record<string, number> = {};
      for (const b of glBalances) {
        if (b.period_year === 2026 && b.period_month === 1) {
          entityRowCounts[b.entity_id] = (entityRowCounts[b.entity_id] ?? 0) + 1;
          entityNetChangeSums[b.entity_id] = (entityNetChangeSums[b.entity_id] ?? 0) + b.net_change;
        }
      }
      _debug.jan2026PerEntity = { rowCounts: entityRowCounts, netChangeSums: entityNetChangeSums };
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

    // Debug: track revenue master accounts consolidation
    const _revenueDebug: Record<string, { mappedAccountIds: string[]; balanceCount: number; netChange: number }> = {};

    for (const ma of masterAccounts) {
      const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
      const entityBalances = glBalances.filter((b) =>
        entityAccountIds.includes(b.account_id)
      );

      // Debug: capture revenue account details
      if (ma.classification === "Revenue") {
        const jan2026Balances = entityBalances.filter(
          (b) => b.period_year === 2026 && b.period_month === 1
        );
        _revenueDebug[ma.name] = {
          mappedAccountIds: entityAccountIds,
          balanceCount: jan2026Balances.length,
          netChange: jan2026Balances.reduce((s, b) => s + b.net_change, 0),
        };
      }

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

    _debug.revenueConsolidation = _revenueDebug;

    // --- Pro Forma Adjustments (organization scope) ---
    if (includeProForma) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pro_forma_adjustments not in generated types
      const { data: proFormaRows } = await (admin as any)
        .from("pro_forma_adjustments")
        .select("master_account_id, period_year, period_month, amount")
        .eq("organization_id", organizationId!)
        .eq("is_excluded", false);

      if (proFormaRows && proFormaRows.length > 0) {
        injectProFormaAdjustments(
          consolidatedBalances,
          proFormaRows as RawProFormaAdjustment[],
          "consolidated"
        );
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets
    );

    // Prior year aggregation for YoY
    let pyAggregated: Map<string, BucketedAmounts> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets);
    }

    // Reuse entity IDs fetched earlier for GL balance query
    const entityIds = orgEntityIds;
    const depreciationByBucket: Record<string, number> = {};
    const pyDepreciationByBucket: Record<string, number> = {};
    for (const bucket of buckets) {
      depreciationByBucket[bucket.key] = 0;
      pyDepreciationByBucket[bucket.key] = 0;
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
        // Include prior years for YoY depreciation
        const allDepYears = includeYoY
          ? [...new Set([...uniqueYears, ...uniqueYears.map((y) => y - 1)])]
          : uniqueYears;

        const { data: depRows } = await admin
          .from("fixed_asset_depreciation")
          .select("period_year, period_month, book_depreciation")
          .in("fixed_asset_id", ids)
          .in("period_year", allDepYears);

        for (const bucket of buckets) {
          const monthSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows ?? []) {
            if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
              depreciationByBucket[bucket.key] += Number(row.book_depreciation);
            }
          }
        }

        // Prior year depreciation
        if (includeYoY) {
          const pyBuckets = createPriorYearBuckets(buckets);
          for (const bucket of pyBuckets) {
            const monthSet = new Set(
              bucket.months.map((m) => `${m.year}-${m.month}`)
            );
            for (const row of depRows ?? []) {
              if (monthSet.has(`${row.period_year}-${row.period_month}`)) {
                pyDepreciationByBucket[bucket.key] += Number(row.book_depreciation);
              }
            }
          }
        }
      }
    }

    // --------------- Budget data (organization scope) ---------------
    let orgBudgetByAccount: Map<string, Record<string, number>> | undefined;

    if (includeBudget && entityIds.length > 0) {
      const budgetYears = [
        ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
      ];

      // Find active budget versions across ALL entities in the org
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
      const { data: activeVersions } = await (admin as any)
        .from("budget_versions")
        .select("id, fiscal_year, entity_id")
        .in("entity_id", entityIds)
        .eq("is_active", true)
        .in("fiscal_year", budgetYears);

      const versionIds = (activeVersions ?? []).map(
        (v: { id: string }) => v.id
      );

      if (versionIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
        const { data: budgetRows } = await (admin as any)
          .from("budget_amounts")
          .select("account_id, period_year, period_month, amount")
          .in("budget_version_id", versionIds);

        // Build reverse mapping: entity account_id -> master_account_id
        const entityToMaster = new Map<string, string>();
        for (const m of mappings ?? []) {
          entityToMaster.set(m.account_id, m.master_account_id);
        }

        orgBudgetByAccount = aggregateBudgetByBucket(
          (budgetRows ?? []) as RawBudgetAmount[],
          buckets,
          entityToMaster
        );
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
      true,
      orgBudgetByAccount,
      pyAggregated
    );

    const netIncomeByBucket: Record<string, number> = {};
    const pyNetIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    for (const bucket of buckets) {
      netIncomeByBucket[bucket.key] =
        netIncomeSection?.subtotalLine?.amounts[bucket.key] ?? 0;
      pyNetIncomeByBucket[bucket.key] =
        netIncomeSection?.subtotalLine?.priorYearAmounts?.[bucket.key] ?? 0;
    }

    // Balance Sheet (no budget — P&L only)
    const balanceSheet = buildStatement(
      "balance_sheet",
      "Consolidated Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      consolidatedAccounts,
      aggregated,
      buckets,
      false,
      undefined, // no budget for BS
      pyAggregated
    );

    const cashFlowStatement = buildCashFlowStatement(
      consolidatedAccounts,
      aggregated,
      buckets,
      depreciationByBucket,
      netIncomeByBucket,
      includeYoY ? pyAggregated : undefined,
      includeYoY ? pyDepreciationByBucket : undefined,
      includeYoY ? pyNetIncomeByBucket : undefined
    );

    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
    }));

    const response = {
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
      _debug,
    };

    return NextResponse.json(response);
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
