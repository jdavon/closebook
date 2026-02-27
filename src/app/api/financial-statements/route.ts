import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange, type PeriodBucket } from "@/lib/utils/dates";
import { fetchAllMappings, fetchAllPaginated } from "@/lib/utils/paginated-fetch";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface RawBudgetAmount {
  master_account_id?: string;
  account_id?: string;
  period_month: number;
  period_year: number;
  amount: number;
}

/**
 * Fetches budget amounts with fallback for column name.
 * The budget_amounts table may have either `master_account_id` (renamed)
 * or `account_id` (original migration). Try master_account_id first; if
 * the query errors, fall back to account_id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchBudgetAmounts(admin: any, versionIds: string[]): Promise<{
  rows: RawBudgetAmount[];
  column: "master_account_id" | "account_id";
  error?: string;
}> {
  // Try master_account_id first (current schema after column rename)
  // Paginate to avoid PostgREST row-limit truncation (versions × accounts × 12 months)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: probe, error: err1 } = await (admin as any)
    .from("budget_amounts")
    .select("master_account_id", { count: "exact", head: true })
    .in("budget_version_id", versionIds);

  if (!err1) {
    const rows1 = await fetchAllPaginated<RawBudgetAmount>((offset, limit) =>
      (admin as any)
        .from("budget_amounts")
        .select("master_account_id, period_year, period_month, amount")
        .in("budget_version_id", versionIds)
        .range(offset, offset + limit - 1)
    );
    return { rows: rows1, column: "master_account_id" };
  }

  // Fallback: try account_id (original migration column name)
  const rows2 = await fetchAllPaginated<RawBudgetAmount>((offset, limit) =>
    (admin as any)
      .from("budget_amounts")
      .select("account_id, period_year, period_month, amount")
      .in("budget_version_id", versionIds)
      .range(offset, offset + limit - 1)
  );

  if (rows2.length > 0) {
    return { rows: rows2, column: "account_id" };
  }

  return {
    rows: [],
    column: "master_account_id",
    error: `master_account_id: ${err1?.message}; account_id fallback returned 0 rows`,
  };
}

function aggregateBudgetByBucket(
  budgetAmounts: RawBudgetAmount[],
  buckets: PeriodBucket[],
  column: "master_account_id" | "account_id",
  /** Maps entity account_id -> master account_id (only needed when column is account_id) */
  entityToMaster?: Map<string, string>
): Map<string, Record<string, number>> {
  // Index budget amounts by account key -> "year-month" -> amount
  const budgetIndex = new Map<string, Map<string, number>>();
  for (const ba of budgetAmounts) {
    const accountKey = column === "master_account_id"
      ? ba.master_account_id!
      : ba.account_id!;
    if (!accountKey) continue;

    let byPeriod = budgetIndex.get(accountKey);
    if (!byPeriod) {
      byPeriod = new Map();
      budgetIndex.set(accountKey, byPeriod);
    }
    const key = `${ba.period_year}-${ba.period_month}`;
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + Number(ba.amount));
  }

  // Aggregate by master account and bucket
  const result = new Map<string, Record<string, number>>();

  for (const [accountKey, periodAmounts] of budgetIndex) {
    // If column is account_id, map entity account -> master account
    const masterAccountId = column === "account_id" && entityToMaster
      ? entityToMaster.get(accountKey)
      : accountKey;
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
  entity_id: string;
  master_account_id: string;
  offset_master_account_id: string | null;
  period_year: number;
  period_month: number;
  amount: number;
  description: string;
}

/**
 * Inject pro forma adjustments into consolidatedBalances (double-entry).
 * Each adjustment adds +amount to the primary master account and
 * -amount to the offset master account (when specified) for the
 * matching period. If no existing balance row exists for an
 * account/period, a new one is created.
 */
function injectProFormaAdjustments(
  consolidatedBalances: RawGLBalance[],
  adjustments: Array<{ master_account_id: string; period_year: number; period_month: number; amount: number; offset_master_account_id?: string | null }>,
  entityId: string
): void {
  const balIndex = new Map<string, RawGLBalance>();
  for (const b of consolidatedBalances) {
    balIndex.set(`${b.account_id}-${b.period_year}-${b.period_month}`, b);
  }

  function injectAmount(accountId: string, year: number, month: number, amount: number) {
    const key = `${accountId}-${year}-${month}`;
    const existing = balIndex.get(key);
    if (existing) {
      existing.net_change += amount;
      existing.ending_balance += amount;
    } else {
      const newBal: RawGLBalance = {
        account_id: accountId,
        entity_id: entityId,
        period_year: year,
        period_month: month,
        beginning_balance: 0,
        ending_balance: amount,
        net_change: amount,
      };
      consolidatedBalances.push(newBal);
      balIndex.set(key, newBal);
    }
  }

  for (const adj of adjustments) {
    const amount = Number(adj.amount);
    // Primary side
    injectAmount(adj.master_account_id, Number(adj.period_year), Number(adj.period_month), amount);
    // Offset side (double-entry counterpart)
    if (adj.offset_master_account_id) {
      injectAmount(adj.offset_master_account_id, Number(adj.period_year), Number(adj.period_month), -amount);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: expand allocation adjustments into pro-forma-style entries
// ---------------------------------------------------------------------------

interface RawAllocationAdjustment {
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  destination_master_account_id: string | null;
  amount: number;
  description: string;
  schedule_type: string;
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
}

/** Push a +/- pair of entries for source and destination.
 *  For reclass (same entity, different accounts): -amt on source account, +amt on dest account.
 *  For inter-entity: -amt on source entity, +amt on destination entity (same account). */
function pushAllocPair(
  entries: Array<{ entity_id: string; master_account_id: string; period_year: number; period_month: number; amount: number }>,
  alloc: RawAllocationAdjustment,
  year: number,
  month: number,
  amt: number
) {
  if (alloc.destination_master_account_id) {
    // Intra-entity reclass: move between accounts within same entity
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: -amt,
    });
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.destination_master_account_id,
      period_year: year,
      period_month: month,
      amount: amt,
    });
  } else {
    // Inter-entity: move between entities on same account
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: -amt,
    });
    entries.push({
      entity_id: alloc.destination_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: amt,
    });
  }
}

/**
 * Expand allocation adjustments into paired +/- entries per entity per period.
 * - single_month: one pair (or many pairs if is_repeating).
 * - monthly_spread: one pair per month in the range (amount divided equally).
 */
function expandAllocationAdjustments(
  allocations: RawAllocationAdjustment[]
): Array<{ entity_id: string; master_account_id: string; period_year: number; period_month: number; amount: number }> {
  const entries: Array<{ entity_id: string; master_account_id: string; period_year: number; period_month: number; amount: number }> = [];

  for (const alloc of allocations) {
    const totalAmount = Number(alloc.amount);

    if (alloc.schedule_type === "single_month") {
      if (alloc.period_year == null || alloc.period_month == null) continue;

      if (alloc.is_repeating && alloc.repeat_end_year != null && alloc.repeat_end_month != null) {
        // Repeating: full amount each month from period through repeat_end
        const totalMonths =
          (alloc.repeat_end_year - alloc.period_year) * 12 +
          (alloc.repeat_end_month - alloc.period_month) + 1;
        if (totalMonths < 1) continue;

        let y = alloc.period_year;
        let m = alloc.period_month;
        for (let i = 0; i < totalMonths; i++) {
          pushAllocPair(entries, alloc, y, m, totalAmount);
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        // Single month, not repeating
        pushAllocPair(entries, alloc, alloc.period_year, alloc.period_month, totalAmount);
      }
    } else if (alloc.schedule_type === "monthly_spread") {
      if (
        alloc.start_year == null || alloc.start_month == null ||
        alloc.end_year == null || alloc.end_month == null
      ) continue;

      const totalMonths =
        (alloc.end_year - alloc.start_year) * 12 +
        (alloc.end_month - alloc.start_month) + 1;
      if (totalMonths < 1) continue;

      const monthlyAmount = totalAmount / totalMonths;

      let y = alloc.start_year;
      let m = alloc.start_month;
      for (let i = 0; i < totalMonths; i++) {
        pushAllocPair(entries, alloc, y, m, monthlyAmount);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return entries;
}

/**
 * Inject allocation adjustments into consolidatedBalances.
 * Works identically to injectProFormaAdjustments but with the expanded
 * allocation entries (which already include entity_id per entry).
 */
function injectAllocationAdjustments(
  consolidatedBalances: RawGLBalance[],
  entries: Array<{ master_account_id: string; period_year: number; period_month: number; amount: number }>,
  entityId: string
): void {
  // Re-use the same injection logic as pro forma
  injectProFormaAdjustments(consolidatedBalances, entries, entityId);
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
  buckets: PeriodBucket[],
  fiscalYearStartMonth: number = 1
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
    const isPL =
      account.classification === "Revenue" ||
      account.classification === "Expense";
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
          const pm = m.month === 1 ? 12 : m.month - 1;
          const py = m.month === 1 ? m.year - 1 : m.year;
          const priorBal = accountBalances?.get(`${py}-${pm}`);

          // Derive standalone monthly net change from ending balance
          // differences. The QBO trial balance stores cumulative YTD in
          // ending_balance/net_change for P&L accounts. Subtracting the
          // prior month's ending balance gives the true monthly activity.
          if (isPL && m.month === fiscalYearStartMonth) {
            // First month of fiscal year: P&L resets, YTD IS standalone
            netChange += bal.ending_balance;
          } else if (priorBal) {
            netChange += bal.ending_balance - priorBal.ending_balance;
          } else {
            // No prior month data — use ending_balance as best available
            netChange += bal.ending_balance;
          }

          endingBal = bal.ending_balance; // last one wins
          if (!foundFirst) {
            // Derive beginning balance from the PRIOR month's ending balance.
            // The DB's beginning_balance may be 0 if the sync didn't populate it.
            // collectAllMonths() already fetches prior-month data for this purpose.
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
  const stmtType = statementId as "income_statement" | "balance_sheet" | "cash_flow";

  for (const config of sectionConfigs) {
    // Expense-classified sections: positive variance is unfavorable (over-budget)
    const isExpenseSection = config.classification === "Expense";

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
        // Credit-normal accounts stored as negatives in GL, flip sign for display:
        // Revenue (net_change on P&L), Liability & Equity (ending_balance on BS)
        amounts[bucket.key] = useNetChange
          ? (config.classification === "Revenue" ? -raw : raw)
          : (config.classification === "Liability" || config.classification === "Equity" ? -raw : raw);
        totals[bucket.key] += amounts[bucket.key];

        // Prior year amounts
        if (hasPY && priorYearAmounts) {
          const pyRaw = useNetChange
            ? (pyBucketed?.netChange[bucket.key] ?? 0)
            : (pyBucketed?.endingBalance[bucket.key] ?? 0);
          priorYearAmounts[bucket.key] = useNetChange
            ? (config.classification === "Revenue" ? -pyRaw : pyRaw)
            : (config.classification === "Liability" || config.classification === "Equity" ? -pyRaw : pyRaw);
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
        varianceInvertColor: isExpenseSection,
        drillDownMeta: {
          type: "account",
          masterAccountIds: [account.id],
          statementType: stmtType,
        },
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
      varianceInvertColor: isExpenseSection,
      drillDownMeta: {
        type: "section_total",
        sectionIds: [config.id],
        statementType: stmtType,
      },
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
          drillDownMeta: {
            type: "computed",
            formula: comp.formula,
            statementType: stmtType,
          },
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
        const budgetMarginAmounts: Record<string, number> | undefined = hasBudget
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
          if (hasBudget && budgetMarginAmounts && compBudgetAmounts) {
            const budgetRevenue = sectionBudgetTotals[revenueKey]?.[bucket.key] ?? 0;
            budgetMarginAmounts[bucket.key] =
              budgetRevenue !== 0 ? compBudgetAmounts[bucket.key] / budgetRevenue : 0;
          }
        }

        const marginLabel =
          comp.id === "gross_margin"
            ? "Gross Margin %"
            : comp.id === "operating_margin"
              ? "Operating Margin %"
              : "Net Income Margin %";

        finalSections.push({
          id: `${comp.id}_pct`,
          title: "",
          lines: [],
          subtotalLine: {
            id: `${comp.id}_pct`,
            label: marginLabel,
            amounts: marginAmounts,
            budgetAmounts: budgetMarginAmounts,
            priorYearAmounts: pyMarginAmounts,
            indent: 1,
            isTotal: false,
            isGrandTotal: false,
            isHeader: false,
            isSeparator: false,
            showDollarSign: false,
            drillDownMeta: { type: "percentage" },
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
// Helper: inject Net Income into balance sheet equity section.
//
// QBO equity accounts (e.g. Retained Earnings) do NOT include the current
// fiscal year's net income until the books are closed.  To make the balance
// sheet balance (Assets = Liabilities + Equity) we compute cumulative YTD
// net income from P&L ending_balances and add it as a synthetic line in the
// equity section.
// ---------------------------------------------------------------------------

function injectNetIncomeIntoBalanceSheet(
  balanceSheet: StatementData,
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  pyAggregated?: Map<string, BucketedAmounts>
): void {
  const plAccounts = accounts.filter(
    (a) => a.classification === "Revenue" || a.classification === "Expense"
  );
  if (plAccounts.length === 0) return;

  // Revenue ending_balance is negative (credit-normal); Expense is positive
  // (debit-normal).  Net Income = -(sum of all P&L ending_balances).
  const niAmounts: Record<string, number> = {};
  const pyNiAmounts: Record<string, number> | undefined = pyAggregated
    ? {}
    : undefined;

  for (const bucket of buckets) {
    let plEnding = 0;
    let pyPlEnding = 0;

    for (const acct of plAccounts) {
      plEnding += aggregated.get(acct.id)?.endingBalance[bucket.key] ?? 0;
      if (pyAggregated) {
        pyPlEnding +=
          pyAggregated.get(acct.id)?.endingBalance[bucket.key] ?? 0;
      }
    }

    niAmounts[bucket.key] = -plEnding;
    if (pyNiAmounts) {
      pyNiAmounts[bucket.key] = -pyPlEnding;
    }
  }

  // Find equity section
  const equitySection = balanceSheet.sections.find((s) => s.id === "equity");
  if (!equitySection?.subtotalLine) return;

  // Add synthetic Net Income line
  equitySection.lines.push({
    id: "equity-net-income",
    label: "Net Income",
    amounts: niAmounts,
    priorYearAmounts: pyNiAmounts,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: equitySection.lines.length === 0,
  });

  // Update equity subtotal
  for (const bucket of buckets) {
    equitySection.subtotalLine.amounts[bucket.key] =
      (equitySection.subtotalLine.amounts[bucket.key] ?? 0) +
      niAmounts[bucket.key];

    if (pyNiAmounts && equitySection.subtotalLine.priorYearAmounts) {
      equitySection.subtotalLine.priorYearAmounts[bucket.key] =
        (equitySection.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
        pyNiAmounts[bucket.key];
    }
  }

  // Update computed lines that include equity
  for (const section of balanceSheet.sections) {
    if (
      (section.id === "total_equity" ||
        section.id === "total_liabilities_and_equity") &&
      section.subtotalLine
    ) {
      for (const bucket of buckets) {
        section.subtotalLine.amounts[bucket.key] =
          (section.subtotalLine.amounts[bucket.key] ?? 0) +
          niAmounts[bucket.key];

        if (pyNiAmounts && section.subtotalLine.priorYearAmounts) {
          section.subtotalLine.priorYearAmounts[bucket.key] =
            (section.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
            pyNiAmounts[bucket.key];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cash flow supplemental section types and helpers
// ---------------------------------------------------------------------------

/** A single adjustment entry for the cash flow supplemental section */
interface CashFlowSupplementalEntry {
  description: string;
  primaryAccountId: string;
  offsetAccountId: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
}

/**
 * Compute the net cash impact of a double-entry adjustment.
 * If either account is a Bank (cash) type, there is a real cash impact.
 * Otherwise the adjustment is non-cash and the net impact is $0.
 */
function computeNetCashImpact(
  amount: number,
  primaryAccountType: string,
  offsetAccountType: string
): number {
  const primaryIsBank = CASH_ACCOUNT_TYPES.includes(primaryAccountType);
  const offsetIsBank = CASH_ACCOUNT_TYPES.includes(offsetAccountType);

  if (primaryIsBank && offsetIsBank) return 0;
  if (primaryIsBank) return amount;      // Debit to cash = cash increases
  if (offsetIsBank) return -amount;      // Credit to cash = cash decreases
  return 0;                              // Neither is cash — non-cash adjustment
}

/**
 * Build supplemental entries for intra-entity reclass allocations.
 * Inter-entity transfers net to zero at consolidated level and are omitted.
 */
function buildAllocationSupplementalEntries(
  allocRows: RawAllocationAdjustment[],
  buckets: PeriodBucket[]
): CashFlowSupplementalEntry[] {
  const entries: CashFlowSupplementalEntry[] = [];

  for (const alloc of allocRows) {
    // Only include intra-entity reclass (same entity, different accounts)
    if (!alloc.destination_master_account_id) continue;
    if (alloc.source_entity_id !== alloc.destination_entity_id) continue;

    const totalAmount = Number(alloc.amount);

    // Determine which months this allocation covers
    if (alloc.schedule_type === "single_month") {
      if (alloc.period_year == null || alloc.period_month == null) continue;

      if (alloc.is_repeating && alloc.repeat_end_year != null && alloc.repeat_end_month != null) {
        const totalMonths =
          (alloc.repeat_end_year - alloc.period_year) * 12 +
          (alloc.repeat_end_month - alloc.period_month) + 1;
        if (totalMonths < 1) continue;
        let y = alloc.period_year;
        let m = alloc.period_month;
        for (let i = 0; i < totalMonths; i++) {
          entries.push({
            description: alloc.description,
            primaryAccountId: alloc.master_account_id,
            offsetAccountId: alloc.destination_master_account_id,
            periodYear: y,
            periodMonth: m,
            amount: totalAmount,
          });
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        entries.push({
          description: alloc.description,
          primaryAccountId: alloc.master_account_id,
          offsetAccountId: alloc.destination_master_account_id,
          periodYear: alloc.period_year,
          periodMonth: alloc.period_month,
          amount: totalAmount,
        });
      }
    } else if (alloc.schedule_type === "monthly_spread") {
      if (
        alloc.start_year == null || alloc.start_month == null ||
        alloc.end_year == null || alloc.end_month == null
      ) continue;

      const totalMonths =
        (alloc.end_year - alloc.start_year) * 12 +
        (alloc.end_month - alloc.start_month) + 1;
      if (totalMonths < 1) continue;

      const monthlyAmount = totalAmount / totalMonths;
      let y = alloc.start_year;
      let m = alloc.start_month;
      for (let i = 0; i < totalMonths; i++) {
        entries.push({
          description: alloc.description,
          primaryAccountId: alloc.master_account_id,
          offsetAccountId: alloc.destination_master_account_id,
          periodYear: y,
          periodMonth: m,
          amount: monthlyAmount,
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return entries;
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
  pyNetIncomeByBucket?: Record<string, number>,
  supplementalEntries?: CashFlowSupplementalEntry[]
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
    drillDownMeta: { type: "none" },
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
    drillDownMeta: { type: "none" },
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
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
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
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
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
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
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
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
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

  // --- PRO FORMA / ALLOCATION SUPPLEMENTAL SECTION ---
  if (supplementalEntries && supplementalEntries.length > 0) {
    const accountTypeMap = new Map(accounts.map((a) => [a.id, a.accountType]));
    const supplementalLines: LineItem[] = [];

    // Group entries by description to aggregate amounts into buckets
    const grouped = new Map<string, { entry: CashFlowSupplementalEntry; amounts: Record<string, number> }>();

    for (const entry of supplementalEntries) {
      const primaryType = accountTypeMap.get(entry.primaryAccountId);
      const offsetType = accountTypeMap.get(entry.offsetAccountId);
      if (!primaryType || !offsetType) continue;

      const cashImpact = computeNetCashImpact(entry.amount, primaryType, offsetType);

      // Find which bucket this entry falls into
      for (const bucket of buckets) {
        const inBucket = bucket.months.some(
          (m) => m.year === entry.periodYear && m.month === entry.periodMonth
        );
        if (!inBucket) continue;

        const groupKey = `${entry.description}|${entry.primaryAccountId}|${entry.offsetAccountId}`;
        let group = grouped.get(groupKey);
        if (!group) {
          group = { entry, amounts: {} };
          for (const b of buckets) group.amounts[b.key] = 0;
          grouped.set(groupKey, group);
        }
        group.amounts[bucket.key] += cashImpact;
      }
    }

    for (const [, group] of grouped) {
      // Skip entries with zero impact in all buckets
      const hasAnyAmount = Object.values(group.amounts).some((v) => v !== 0);
      if (!hasAnyAmount) continue;

      supplementalLines.push({
        id: `cf-pf-${group.entry.primaryAccountId}-${group.entry.offsetAccountId}`,
        label: group.entry.description,
        amounts: group.amounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: { type: "none" },
      });
    }

    if (supplementalLines.length > 0) {
      const pfTotal: Record<string, number> = {};
      for (const bucket of buckets) {
        pfTotal[bucket.key] = supplementalLines.reduce(
          (sum, line) => sum + (line.amounts[bucket.key] ?? 0),
          0
        );
      }

      sections.push({
        id: "cf-pro-forma",
        title: "PRO FORMA ADJUSTMENTS",
        lines: supplementalLines,
        subtotalLine: {
          id: "cf-pro-forma-total",
          label: "Net pro forma cash impact",
          amounts: pfTotal,
          indent: 0,
          isTotal: true,
          isGrandTotal: false,
          isHeader: false,
          isSeparator: false,
          showDollarSign: true,
        },
      });
    }
  }

  return {
    id: "cash_flow",
    title: "Statement of Cash Flows",
    sections,
  };
}

// ---------------------------------------------------------------------------
// Shared consolidation helper: builds three-statement financials for a set of
// entity IDs within an organization.  Used by both "organization" and
// "reporting_entity" scopes.
// ---------------------------------------------------------------------------

interface ConsolidatedStatementsParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  organizationId: string;
  entityIds: string[];
  buckets: PeriodBucket[];
  allMonths: Array<{ year: number; month: number }>;
  includeYoY: boolean;
  includeBudget: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  granularity: Granularity;
  scope: Scope;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  fiscalYearStartMonth: number;
}

async function buildConsolidatedStatements(params: ConsolidatedStatementsParams) {
  const {
    admin,
    organizationId,
    entityIds,
    buckets,
    allMonths,
    includeYoY,
    includeBudget,
    includeProForma,
    includeAllocations,
    granularity,
    scope,
    startYear,
    startMonth,
    endYear,
    endMonth,
    fiscalYearStartMonth,
  } = params;

  // Get master accounts (paginated to avoid PostgREST row-limit truncation)
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    admin
      .from("master_accounts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number")
      .range(offset, offset + limit - 1)
  );

  if (masterAccounts.length === 0) {
    return {
      periods: [] as Period[],
      incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
      balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
      cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
    };
  }

  // Get mappings (paginated to avoid PostgREST max_rows truncation)
  const masterAccountIds = masterAccounts.map((ma: { id: string }) => ma.id);
  const mappings = await fetchAllMappings(admin, masterAccountIds);

  // Build a Set of mapped account IDs for in-memory filtering
  const mappedAccountIdSet = new Set(
    (mappings ?? []).map((m: { account_id: string }) => m.account_id)
  );

  // Get GL balances by entity_id
  let glBalances: RawGLBalance[] = [];

  if (mappedAccountIdSet.size > 0 && entityIds.length > 0) {
    const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
    const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

    const allBalances = await fetchAllGLBalances(admin, {
      filterColumn: "entity_id",
      filterValues: entityIds,
      years: uniqueYears,
      months: uniqueMonthNums,
    });

    const monthSet = new Set(
      allMonths.map(
        (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
      )
    );
    glBalances = allBalances.filter(
      (b) =>
        mappedAccountIdSet.has(b.account_id) &&
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
  const consolidatedAccounts: AccountInfo[] = masterAccounts.map(
    (ma: { id: string; name: string; account_number: string | null; classification: string; account_type: string }) => ({
      id: ma.id,
      name: ma.name,
      accountNumber: ma.account_number,
      classification: ma.classification,
      accountType: ma.account_type,
    })
  );

  const consolidatedBalances: RawGLBalance[] = [];

  for (const ma of masterAccounts) {
    const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
    const entityBalances = glBalances.filter((b) =>
      entityAccountIds.includes(b.account_id)
    );

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
        account_id: ma.id,
        entity_id: "consolidated",
        period_year: y,
        period_month: m,
        beginning_balance: vals.beginning,
        ending_balance: vals.ending,
        net_change: vals.netChange,
      });
    }
  }

  // Pro Forma Adjustments (paginated to avoid row-limit truncation)
  let proFormaRows: RawProFormaAdjustment[] = [];
  if (includeProForma) {
    proFormaRows = await fetchAllPaginated<RawProFormaAdjustment>((offset, limit) =>
      (admin as any)
        .from("pro_forma_adjustments")
        .select("entity_id, master_account_id, offset_master_account_id, period_year, period_month, amount, description")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .in("entity_id", entityIds)
        .range(offset, offset + limit - 1)
    );

    if (proFormaRows.length > 0) {
      injectProFormaAdjustments(
        consolidatedBalances,
        proFormaRows,
        "consolidated"
      );
    }
  }

  // Allocation Adjustments (org/RE scope — net zero at consolidated level, paginated)
  let allocReclassEntries: CashFlowSupplementalEntry[] = [];
  if (includeAllocations) {
    const allocRows = await fetchAllPaginated<RawAllocationAdjustment>((offset, limit) =>
      (admin as any)
        .from("allocation_adjustments")
        .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1)
    );

    if (allocRows.length > 0) {
      const expanded = expandAllocationAdjustments(allocRows);
      // Filter to entries belonging to entities in scope.
      // For org scope this keeps both sides (net zero at consolidated).
      // For reporting_entity scope this shows the net effect of cross-RE allocations.
      const entityIdSet = new Set(entityIds);
      const filtered = expanded.filter((e) => entityIdSet.has(e.entity_id));
      injectAllocationAdjustments(consolidatedBalances, filtered, "consolidated");

      // Build supplemental entries for intra-entity reclass allocations
      // (inter-entity transfers net to zero at consolidated and are omitted)
      allocReclassEntries = buildAllocationSupplementalEntries(allocRows, buckets);
    }
  }

  // Aggregate into buckets
  const aggregated = aggregateByBucket(
    consolidatedAccounts,
    consolidatedBalances,
    buckets,
    fiscalYearStartMonth
  );

  // Prior year aggregation for YoY
  let pyAggregated: Map<string, BucketedAmounts> | undefined;
  if (includeYoY) {
    const pyBuckets = createPriorYearBuckets(buckets);
    pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets, fiscalYearStartMonth);
  }

  // Depreciation
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

    const ids = (assetIds ?? []).map((a: { id: string }) => a.id);
    if (ids.length > 0) {
      const uniqueYears = [
        ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
      ];
      const allDepYears = includeYoY
        ? [...new Set([...uniqueYears, ...uniqueYears.map((y) => y - 1)])]
        : uniqueYears;

      const { data: depRows } = await admin
        .from("fixed_asset_depreciation")
        .select("period_year, period_month, book_depreciation")
        .in("fixed_asset_id", ids)
        .in("period_year", allDepYears);

      for (const bucket of buckets) {
        const mSet = new Set(
          bucket.months.map((m) => `${m.year}-${m.month}`)
        );
        for (const row of depRows ?? []) {
          if (mSet.has(`${row.period_year}-${row.period_month}`)) {
            depreciationByBucket[bucket.key] += Number(row.book_depreciation);
          }
        }
      }

      if (includeYoY) {
        const pyBuckets = createPriorYearBuckets(buckets);
        for (const bucket of pyBuckets) {
          const mSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows) {
            if (mSet.has(`${row.period_year}-${row.period_month}`)) {
              pyDepreciationByBucket[bucket.key] += Number(row.book_depreciation);
            }
          }
        }
      }
    }
  }

  // Budget data
  let consolidatedBudgetByAccount: Map<string, Record<string, number>> | undefined;

  if (includeBudget && entityIds.length > 0) {
    const budgetYears = [
      ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const budgetResult = await fetchBudgetAmounts(admin, versionIds);

      if (budgetResult.rows.length > 0) {
        // Build entityToMaster mapping (needed if column is account_id)
        const entityToMaster = new Map<string, string>();
        for (const m of mappings ?? []) {
          entityToMaster.set(m.account_id, m.master_account_id);
        }

        consolidatedBudgetByAccount = aggregateBudgetByBucket(
          budgetResult.rows,
          buckets,
          budgetResult.column,
          entityToMaster
        );
      }
    }
  }

  // Build statements
  const incomeStatement = buildStatement(
    "income_statement",
    "Income Statement",
    INCOME_STATEMENT_SECTIONS,
    INCOME_STATEMENT_COMPUTED,
    consolidatedAccounts,
    aggregated,
    buckets,
    true,
    consolidatedBudgetByAccount,
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

  const balanceSheet = buildStatement(
    "balance_sheet",
    "Balance Sheet",
    BALANCE_SHEET_SECTIONS,
    BALANCE_SHEET_COMPUTED,
    consolidatedAccounts,
    aggregated,
    buckets,
    false,
    undefined,
    pyAggregated
  );

  // Inject Net Income into BS equity so Assets = L + E
  injectNetIncomeIntoBalanceSheet(
    balanceSheet,
    consolidatedAccounts,
    aggregated,
    buckets,
    pyAggregated
  );

  // Build supplemental entries for cash flow pro forma section
  const cfSupplementalEntries: CashFlowSupplementalEntry[] = [
    ...proFormaRows
      .filter((pf) => pf.offset_master_account_id)
      .map((pf) => ({
        description: pf.description,
        primaryAccountId: pf.master_account_id,
        offsetAccountId: pf.offset_master_account_id!,
        periodYear: Number(pf.period_year),
        periodMonth: Number(pf.period_month),
        amount: Number(pf.amount),
      })),
    ...allocReclassEntries,
  ];

  const cashFlowStatement = buildCashFlowStatement(
    consolidatedAccounts,
    aggregated,
    buckets,
    depreciationByBucket,
    netIncomeByBucket,
    includeYoY ? pyAggregated : undefined,
    includeYoY ? pyDepreciationByBucket : undefined,
    includeYoY ? pyNetIncomeByBucket : undefined,
    cfSupplementalEntries.length > 0 ? cfSupplementalEntries : undefined
  );

  const periods: Period[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    year: b.year,
    startMonth: b.startMonth,
    endMonth: b.endMonth,
    endYear: b.endYear,
    ...(b.key === "TOTAL" ? { isTotal: true } : {}),
  }));

  return {
    periods,
    incomeStatement,
    balanceSheet,
    cashFlowStatement,
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
  const reportingEntityId = searchParams.get("reportingEntityId");
  const startYear = parseInt(searchParams.get("startYear") ?? "2025");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "1");
  const endYear = parseInt(searchParams.get("endYear") ?? "2025");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "12");
  const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;
  const includeBudget = searchParams.get("includeBudget") === "true";
  const includeYoY = searchParams.get("includeYoY") === "true";
  const includeProForma = searchParams.get("includeProForma") === "true";
  const includeAllocations = searchParams.get("includeAllocations") === "true";
  const includeTotal = searchParams.get("includeTotal") === "true";

  if (scope === "entity" && !entityId) {
    return NextResponse.json(
      { error: "entityId is required for entity scope" },
      { status: 400 }
    );
  }

  if (scope === "reporting_entity" && !reportingEntityId) {
    return NextResponse.json(
      { error: "reportingEntityId is required for reporting_entity scope" },
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

  // Append a synthetic "Total" bucket that spans all months when requested
  if (includeTotal && buckets.length > 1) {
    const allBucketMonths = buckets.flatMap((b) => b.months);
    buckets.push({
      key: "TOTAL",
      label: "Total",
      year: endYear,
      startMonth: buckets[0].startMonth,
      endMonth: buckets[buckets.length - 1].endMonth,
      endYear,
      months: allBucketMonths,
    });
  }

  // Collect all months we need to query
  const allMonths = collectAllMonths(buckets, includeYoY);

  // --- ENTITY SCOPE ---
  if (scope === "entity") {
    // Verify access
    const { data: entity } = await admin
      .from("entities")
      .select("id, name, code, organization_id, fiscal_year_end_month")
      .eq("id", entityId!)
      .single();

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const fyEndMonth = entity.fiscal_year_end_month ?? 12;
    const fiscalYearStartMonth = (fyEndMonth % 12) + 1;

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", entity.organization_id)
      .single();

    // Get master accounts for the organization (paginated to avoid row-limit truncation)
    const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("*")
        .eq("organization_id", entity.organization_id)
        .eq("is_active", true)
        .order("display_order")
        .order("account_number")
        .range(offset, offset + limit - 1)
    );

    if (masterAccounts.length === 0) {
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
    const mappings = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_account_mappings")
        .select("master_account_id, entity_id, account_id")
        .in("master_account_id", masterAccountIds)
        .eq("entity_id", entityId!)
        .range(offset, offset + limit - 1)
    );

    // Get GL balances for mapped accounts (paginated to avoid row limit truncation)
    const mappedAccountIds = mappings.map((m) => m.account_id);
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
    let entityProFormaRows: RawProFormaAdjustment[] = [];
    if (includeProForma) {
      // Paginated to avoid PostgREST row-limit truncation
      entityProFormaRows = await fetchAllPaginated<RawProFormaAdjustment>((offset, limit) =>
        (admin as any)
          .from("pro_forma_adjustments")
          .select("master_account_id, offset_master_account_id, period_year, period_month, amount, description")
          .eq("entity_id", entityId!)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );

      if (entityProFormaRows.length > 0) {
        injectProFormaAdjustments(
          consolidatedBalances,
          entityProFormaRows,
          entityId!
        );
      }
    }

    // --- Allocation Adjustments (entity scope) ---
    let entityAllocReclassEntries: CashFlowSupplementalEntry[] = [];
    if (includeAllocations) {
      // Fetch allocations where this entity is source or destination (paginated)
      const allocRows = await fetchAllPaginated<RawAllocationAdjustment>((offset, limit) =>
        (admin as any)
          .from("allocation_adjustments")
          .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
          .or(`source_entity_id.eq.${entityId!},destination_entity_id.eq.${entityId!}`)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );

      if (allocRows.length > 0) {
        const expanded = expandAllocationAdjustments(allocRows);
        // Only inject entries that belong to this entity
        const entityEntries = expanded.filter((e) => e.entity_id === entityId!);
        if (entityEntries.length > 0) {
          injectAllocationAdjustments(consolidatedBalances, entityEntries, entityId!);
        }
        // Build supplemental entries for intra-entity reclass allocations
        entityAllocReclassEntries = buildAllocationSupplementalEntries(allocRows, buckets);
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets,
      fiscalYearStartMonth
    );

    // Prior year aggregation for YoY
    let pyAggregated: Map<string, BucketedAmounts> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets, fiscalYearStartMonth);
    }

    // Get depreciation data for cash flow
    const depreciationByBucket: Record<string, number> = {};
    const pyDepreciationByBucket: Record<string, number> = {};
    {
      // Paginated to avoid PostgREST row-limit truncation
      const assetIds = await fetchAllPaginated<any>((offset, limit) =>
        admin
          .from("fixed_assets")
          .select("id")
          .eq("entity_id", entityId!)
          .range(offset, offset + limit - 1)
      );

      const ids = assetIds.map((a) => a.id);
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

        // Paginated: assets × years × 12 months can exceed 1000 rows
        const depRows = await fetchAllPaginated<any>((offset, limit) =>
          admin
            .from("fixed_asset_depreciation")
            .select("period_year, period_month, book_depreciation")
            .in("fixed_asset_id", ids)
            .in("period_year", allDepYears)
            .range(offset, offset + limit - 1)
        );

        // Aggregate into buckets
        for (const bucket of buckets) {
          const monthSet = new Set(
            bucket.months.map((m) => `${m.year}-${m.month}`)
          );
          for (const row of depRows) {
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
            for (const row of depRows) {
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
        const budgetResult = await fetchBudgetAmounts(admin, versionIds);

        if (budgetResult.rows.length > 0) {
          // Build entityToMaster mapping (needed if column is account_id)
          const entityToMaster = new Map<string, string>();
          for (const m of mappings ?? []) {
            entityToMaster.set(m.account_id, m.master_account_id);
          }

          budgetByAccount = aggregateBudgetByBucket(
            budgetResult.rows,
            buckets,
            budgetResult.column,
            entityToMaster
          );
        }
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

    // Inject Net Income into BS equity so Assets = L + E
    injectNetIncomeIntoBalanceSheet(
      balanceSheet,
      consolidatedAccounts,
      aggregated,
      buckets,
      pyAggregated
    );

    // Build supplemental entries for cash flow pro forma section
    const entityCfSupplementalEntries: CashFlowSupplementalEntry[] = [
      ...entityProFormaRows
        .filter((pf) => pf.offset_master_account_id)
        .map((pf) => ({
          description: pf.description,
          primaryAccountId: pf.master_account_id,
          offsetAccountId: pf.offset_master_account_id!,
          periodYear: Number(pf.period_year),
          periodMonth: Number(pf.period_month),
          amount: Number(pf.amount),
        })),
      ...entityAllocReclassEntries,
    ];

    // Build Cash Flow Statement
    const cashFlowStatement = buildCashFlowStatement(
      consolidatedAccounts,
      aggregated,
      buckets,
      depreciationByBucket,
      netIncomeByBucket,
      includeYoY ? pyAggregated : undefined,
      includeYoY ? pyDepreciationByBucket : undefined,
      includeYoY ? pyNetIncomeByBucket : undefined,
      entityCfSupplementalEntries.length > 0 ? entityCfSupplementalEntries : undefined
    );

    // Build periods array
    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
      ...(b.key === "TOTAL" ? { isTotal: true } : {}),
    }));

    const response = {
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

    // Get all active entities for this org
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id, fiscal_year_end_month")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const orgEntityIds = (orgEntities ?? []).map((e: { id: string }) => e.id);
    const orgFyEnd = (orgEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const orgFiscalYearStartMonth = (orgFyEnd % 12) + 1;

    const result = await buildConsolidatedStatements({
      admin,
      organizationId,
      entityIds: orgEntityIds,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      includeProForma,
      includeAllocations,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: orgFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // --- REPORTING ENTITY SCOPE ---
  if (scope === "reporting_entity") {
    // Fetch the reporting entity and its organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reportingEntity } = await (admin as any)
      .from("reporting_entities")
      .select("id, name, code, organization_id")
      .eq("id", reportingEntityId!)
      .single();

    if (!reportingEntity) {
      return NextResponse.json(
        { error: "Reporting entity not found" },
        { status: 404 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", reportingEntity.organization_id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", reportingEntity.organization_id)
      .single();

    // Fetch member entity IDs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (admin as any)
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", reportingEntityId!);

    const memberEntityIds = (memberRows ?? []).map(
      (r: { entity_id: string }) => r.entity_id
    );

    if (memberEntityIds.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          reportingEntityName: reportingEntity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get fiscal year end month from member entities
    const { data: reMemberEntities } = await admin
      .from("entities")
      .select("fiscal_year_end_month")
      .in("id", memberEntityIds)
      .limit(1);
    const reFyEnd = (reMemberEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const reFiscalYearStartMonth = (reFyEnd % 12) + 1;

    const result = await buildConsolidatedStatements({
      admin,
      organizationId: reportingEntity.organization_id,
      entityIds: memberEntityIds,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      includeProForma,
      includeAllocations,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: reFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        reportingEntityName: reportingEntity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
