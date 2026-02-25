import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { fetchAllMappings } from "@/lib/utils/paginated-fetch";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";
import type {
  LineItem,
  StatementSection,
  StatementData,
  Granularity,
} from "@/components/financial-statements/types";

// ---------------------------------------------------------------------------
// Types
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

interface AccountInfo {
  id: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  accountType: string;
}

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
// Paginated GL balance fetcher.
// Supabase PostgREST caps responses via PGRST_DB_MAX_ROWS (often 1000).
// Page size must not exceed this limit so pagination detects when more
// rows remain.
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllGLBalances(
  admin: any,
  entityIds: string[],
  years: number[],
  months: number[]
): Promise<RawGLBalance[]> {
  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin
      .from("gl_balances")
      .select(
        "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
      )
      .in("entity_id", entityIds)
      .in("period_year", years)
      .in("period_month", months)
      .range(offset, offset + GL_PAGE_SIZE - 1);

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(parseGLBalance);
    allRows.push(...rows);

    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Build statement with entity columns
// ---------------------------------------------------------------------------

/**
 * For each master account, aggregated amounts keyed by entity ID and "consolidated".
 * netChange = sum of net_change across all months in the range (for P&L).
 * endingBalance = ending_balance of the last month in the range (for BS).
 */
interface EntityAmounts {
  netChange: Record<string, number>;
  endingBalance: Record<string, number>;
}

function buildEntityStatement(
  statementId: string,
  title: string,
  sectionConfigs: StatementSectionConfig[],
  computedConfigs: ComputedLineConfig[],
  accounts: AccountInfo[],
  entityAmounts: Map<string, EntityAmounts>,
  columnKeys: string[],
  useNetChange: boolean
): StatementData {
  const sections: StatementSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};

  for (const config of sectionConfigs) {
    const sectionAccounts = accounts.filter(
      (a) =>
        a.classification === config.classification &&
        config.accountTypes.includes(a.accountType)
    );

    sectionAccounts.sort((a, b) =>
      (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
    );

    const lines: LineItem[] = [];
    const totals: Record<string, number> = {};
    for (const key of columnKeys) totals[key] = 0;

    let lineIndex = 0;
    for (const account of sectionAccounts) {
      const ea = entityAmounts.get(account.id);
      const amounts: Record<string, number> = {};

      for (const key of columnKeys) {
        const raw = useNetChange
          ? (ea?.netChange[key] ?? 0)
          : (ea?.endingBalance[key] ?? 0);
        amounts[key] = useNetChange
          ? config.classification === "Revenue"
            ? -raw
            : raw
          : raw;
        totals[key] += amounts[key];
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

    const subtotalLine: LineItem = {
      id: `${config.id}-total`,
      label: config.title ? `Total ${config.title}` : "",
      amounts: totals,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    };

    sections.push({ id: config.id, title: config.title, lines, subtotalLine });
  }

  // Computed lines (Gross Margin, Net Income, etc.)
  const finalSections: StatementSection[] = [];

  for (const section of sections) {
    finalSections.push(section);

    const computedAfter = computedConfigs.filter(
      (c) => c.afterSection === section.id
    );

    for (const comp of computedAfter) {
      const amounts: Record<string, number> = {};

      for (const key of columnKeys) {
        let val = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[key] ?? 0) * sign;
        }
        amounts[key] = val;
      }

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

      // Margin % lines
      if (
        comp.id === "gross_margin" ||
        comp.id === "operating_margin" ||
        comp.id === "net_income"
      ) {
        const marginAmounts: Record<string, number> = {};
        for (const key of columnKeys) {
          const revenue = sectionTotals["revenue"]?.[key] ?? 0;
          marginAmounts[key] = revenue !== 0 ? amounts[key] / revenue : 0;
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

  return { id: statementId, title, sections: finalSections };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const organizationId = searchParams.get("organizationId");
  const reportingEntityId = searchParams.get("reportingEntityId");
  const startYear = parseInt(searchParams.get("startYear") ?? "0");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "0");
  const endYear = parseInt(searchParams.get("endYear") ?? "0");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "0");
  const granularity =
    (searchParams.get("granularity") as Granularity) ?? "monthly";
  const includeProForma = searchParams.get("includeProForma") === "true";

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  if (!startYear || !startMonth || !endYear || !endMonth) {
    return NextResponse.json(
      { error: "startYear, startMonth, endYear, endMonth are required" },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get org info
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  // Get entities — when a reporting entity is specified, filter to its members
  let reportingEntityName: string | undefined;

  let entities: Array<{ id: string; name: string; code: string }> = [];

  if (reportingEntityId) {
    // Fetch reporting entity info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: re } = await (admin as any)
      .from("reporting_entities")
      .select("name")
      .eq("id", reportingEntityId)
      .single();

    reportingEntityName = re?.name;

    // Fetch member entity IDs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (admin as any)
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", reportingEntityId);

    const memberIds = (memberRows ?? []).map(
      (r: { entity_id: string }) => r.entity_id
    );

    if (memberIds.length > 0) {
      const { data: memberEntities } = await admin
        .from("entities")
        .select("id, name, code")
        .in("id", memberIds)
        .eq("is_active", true)
        .order("name");

      entities = memberEntities ?? [];
    }
  } else {
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name");

    entities = orgEntities ?? [];
  }

  if (entities.length === 0) {
    return NextResponse.json({
      columns: [],
      incomeStatement: {
        id: "income_statement",
        title: "Income Statement",
        sections: [],
      },
      balanceSheet: {
        id: "balance_sheet",
        title: "Balance Sheet",
        sections: [],
      },
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

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
      columns: [],
      incomeStatement: {
        id: "income_statement",
        title: "Income Statement",
        sections: [],
      },
      balanceSheet: {
        id: "balance_sheet",
        title: "Balance Sheet",
        sections: [],
      },
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // Get mappings (paginated to avoid PostgREST max_rows truncation)
  const masterAccountIds = masterAccounts.map((ma) => ma.id);
  const mappings = await fetchAllMappings(admin, masterAccountIds);

  // Build mapping: (master_account_id, entity_id) -> list of entity account_ids
  const masterEntityToAccounts = new Map<string, string[]>();
  const mappedAccountIdSet = new Set<string>();
  for (const m of mappings ?? []) {
    const key = `${m.master_account_id}::${m.entity_id}`;
    const existing = masterEntityToAccounts.get(key) ?? [];
    existing.push(m.account_id);
    masterEntityToAccounts.set(key, existing);
    mappedAccountIdSet.add(m.account_id);
  }

  // Compute months in range
  const buckets = getPeriodsInRange(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );
  // Flatten all months from all buckets
  const allMonthsSet = new Set<string>();
  const allMonths: Array<{ year: number; month: number }> = [];
  for (const bucket of buckets) {
    for (const m of bucket.months) {
      const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
      if (!allMonthsSet.has(key)) {
        allMonthsSet.add(key);
        allMonths.push(m);
      }
    }
  }

  // Get GL balances
  const entityIds = entities.map((e) => e.id);
  let glBalances: RawGLBalance[] = [];

  if (mappedAccountIdSet.size > 0 && entityIds.length > 0) {
    const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
    const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

    const allBalances = await fetchAllGLBalances(
      admin,
      entityIds,
      uniqueYears,
      uniqueMonthNums
    );

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
  }

  // Index GL balances: (entity_id, account_id) -> balances sorted by period
  const balanceIndex = new Map<string, RawGLBalance[]>();
  for (const b of glBalances) {
    const key = `${b.entity_id}::${b.account_id}`;
    const existing = balanceIndex.get(key) ?? [];
    existing.push(b);
    balanceIndex.set(key, existing);
  }

  // Build entity amounts per master account
  // entityAmounts: Map<masterAccountId, EntityAmounts>
  // EntityAmounts.netChange[entityId] = sum of net_change for all mapped accounts in period range
  // EntityAmounts.endingBalance[entityId] = sum of ending_balance for last month in range
  const entityAmounts = new Map<string, EntityAmounts>();

  // Sort allMonths to find last month in range
  const sortedMonths = [...allMonths].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );
  const lastMonth = sortedMonths[sortedMonths.length - 1];
  const lastMonthKey = lastMonth
    ? `${lastMonth.year}-${String(lastMonth.month).padStart(2, "0")}`
    : "";

  for (const ma of masterAccounts) {
    const ea: EntityAmounts = { netChange: {}, endingBalance: {} };

    for (const entity of entities) {
      const mapKey = `${ma.id}::${entity.id}`;
      const entityAccountIds = masterEntityToAccounts.get(mapKey) ?? [];
      let totalNetChange = 0;
      let totalEndingBalance = 0;

      for (const accountId of entityAccountIds) {
        const balKey = `${entity.id}::${accountId}`;
        const bals = balanceIndex.get(balKey) ?? [];

        for (const b of bals) {
          totalNetChange += b.net_change;
          const bKey = `${b.period_year}-${String(b.period_month).padStart(2, "0")}`;
          if (bKey === lastMonthKey) {
            totalEndingBalance += b.ending_balance;
          }
        }
      }

      ea.netChange[entity.id] = totalNetChange;
      ea.endingBalance[entity.id] = totalEndingBalance;
    }

    // Consolidated = sum across all entities
    let consolidatedNetChange = 0;
    let consolidatedEndingBalance = 0;
    for (const entity of entities) {
      consolidatedNetChange += ea.netChange[entity.id] ?? 0;
      consolidatedEndingBalance += ea.endingBalance[entity.id] ?? 0;
    }
    ea.netChange["consolidated"] = consolidatedNetChange;
    ea.endingBalance["consolidated"] = consolidatedEndingBalance;

    entityAmounts.set(ma.id, ea);
  }

  // Pro forma adjustments (add to consolidated column only)
  if (includeProForma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proFormaRows } = await (admin as any)
      .from("pro_forma_adjustments")
      .select(
        "master_account_id, entity_id, period_year, period_month, amount"
      )
      .eq("organization_id", organizationId)
      .eq("is_excluded", false);

    if (proFormaRows && proFormaRows.length > 0) {
      for (const adj of proFormaRows) {
        const adjMonthKey = `${adj.period_year}-${String(adj.period_month).padStart(2, "0")}`;
        // Only include adjustments within the selected range
        if (!allMonthsSet.has(adjMonthKey)) continue;

        const ea = entityAmounts.get(adj.master_account_id);
        if (!ea) continue;

        const amount = Number(adj.amount);

        // Add to the specific entity's column
        ea.netChange[adj.entity_id] =
          (ea.netChange[adj.entity_id] ?? 0) + amount;
        if (adjMonthKey === lastMonthKey) {
          ea.endingBalance[adj.entity_id] =
            (ea.endingBalance[adj.entity_id] ?? 0) + amount;
        }

        // Add to consolidated
        ea.netChange["consolidated"] =
          (ea.netChange["consolidated"] ?? 0) + amount;
        if (adjMonthKey === lastMonthKey) {
          ea.endingBalance["consolidated"] =
            (ea.endingBalance["consolidated"] ?? 0) + amount;
        }
      }
    }
  }

  // Build accounts list
  const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
    id: ma.id,
    name: ma.name,
    accountNumber: ma.account_number,
    classification: ma.classification,
    accountType: ma.account_type,
  }));

  // Column keys: entity IDs + consolidated
  const columnKeys = [...entities.map((e) => e.id), "consolidated"];

  // Build statements
  const incomeStatement = buildEntityStatement(
    "income_statement",
    "Income Statement — Entity Breakdown",
    INCOME_STATEMENT_SECTIONS,
    INCOME_STATEMENT_COMPUTED,
    consolidatedAccounts,
    entityAmounts,
    columnKeys,
    true
  );

  const balanceSheet = buildEntityStatement(
    "balance_sheet",
    "Balance Sheet — Entity Breakdown",
    BALANCE_SHEET_SECTIONS,
    BALANCE_SHEET_COMPUTED,
    consolidatedAccounts,
    entityAmounts,
    columnKeys,
    false
  );

  // Build columns metadata
  const columns = [
    ...entities.map((e) => ({
      key: e.id,
      label: e.code,
      fullName: e.name,
    })),
    {
      key: "consolidated",
      label: reportingEntityName ? reportingEntityName : "Consolidated",
      fullName: reportingEntityName ?? org?.name ?? "Consolidated",
    },
  ];

  return NextResponse.json({
    columns,
    incomeStatement,
    balanceSheet,
    metadata: {
      organizationName: org?.name,
      generatedAt: new Date().toISOString(),
      startPeriod: `${startYear}-${startMonth}`,
      endPeriod: `${endYear}-${endMonth}`,
    },
  });
}
