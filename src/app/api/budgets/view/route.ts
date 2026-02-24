import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  OTHER_EXPENSE_NAME_PATTERNS,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
type AnyClient = any;

interface BudgetAccount {
  id: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  accountType: string;
}

interface BudgetLineItem {
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  months: Record<string, number>; // "1"-"12" -> amount
  total: number;
}

interface BudgetSection {
  id: string;
  title: string;
  lines: BudgetLineItem[];
  subtotal: Record<string, number>; // "1"-"12" + "total"
}

interface ComputedLine {
  id: string;
  label: string;
  amounts: Record<string, number>; // "1"-"12" + "total"
  isGrandTotal?: boolean;
}

// GET — return structured budget data for a version
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get("versionId");
  const entityId = searchParams.get("entityId");

  if (!versionId || !entityId) {
    return NextResponse.json(
      { error: "versionId and entityId are required" },
      { status: 400 }
    );
  }

  const admin: AnyClient = createAdminClient();

  // Verify version exists
  const { data: version } = await admin
    .from("budget_versions")
    .select("id, entity_id, fiscal_year, name, status")
    .eq("id", versionId)
    .eq("entity_id", entityId)
    .single();

  if (!version) {
    return NextResponse.json(
      { error: "Budget version not found" },
      { status: 404 }
    );
  }

  // Fetch budget amounts with account info
  const { data: amounts } = await admin
    .from("budget_amounts")
    .select("account_id, period_month, amount")
    .eq("budget_version_id", versionId);

  // Fetch entity accounts that have budget data
  const accountIds = [
    ...new Set((amounts ?? []).map((a: { account_id: string }) => a.account_id)),
  ];

  if (accountIds.length === 0) {
    return NextResponse.json({
      version: {
        id: version.id,
        name: version.name,
        fiscalYear: version.fiscal_year,
        status: version.status,
      },
      sections: [],
      computedLines: [],
    });
  }

  const { data: accounts } = await admin
    .from("accounts")
    .select("id, name, account_number, classification, account_type")
    .in("id", accountIds)
    .order("account_number");

  const accountMap = new Map<string, BudgetAccount>();
  for (const a of accounts ?? []) {
    let accountType = a.account_type;
    // Reclassify expense accounts to Other Expense by name pattern
    if (a.classification === "Expense" && a.account_type === "Expense") {
      const nameLower = a.name.toLowerCase();
      if (
        OTHER_EXPENSE_NAME_PATTERNS.some((pattern: string) =>
          nameLower.includes(pattern)
        )
      ) {
        accountType = "Other Expense";
      }
    }
    accountMap.set(a.id, {
      id: a.id,
      name: a.name,
      accountNumber: a.account_number,
      classification: a.classification,
      accountType,
    });
  }

  // Index amounts by account -> month
  const amountIndex = new Map<string, Record<string, number>>();
  for (const row of amounts ?? []) {
    let byMonth = amountIndex.get(row.account_id);
    if (!byMonth) {
      byMonth = {};
      amountIndex.set(row.account_id, byMonth);
    }
    byMonth[String(row.period_month)] =
      (byMonth[String(row.period_month)] ?? 0) + row.amount;
  }

  // Build sections matching income statement structure
  const sections: BudgetSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};

  for (const config of INCOME_STATEMENT_SECTIONS) {
    const sectionAccounts = [...accountMap.values()]
      .filter(
        (a) =>
          a.classification === config.classification &&
          config.accountTypes.includes(a.accountType)
      )
      .sort((a, b) =>
        (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
      );

    // Only include section if it has budget accounts
    const linesWithData = sectionAccounts.filter((a) =>
      amountIndex.has(a.id)
    );
    if (linesWithData.length === 0) continue;

    const subtotal: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) subtotal[String(m)] = 0;
    subtotal.total = 0;

    const lines: BudgetLineItem[] = linesWithData.map((a) => {
      const byMonth = amountIndex.get(a.id) ?? {};
      const months: Record<string, number> = {};
      let total = 0;

      for (let m = 1; m <= 12; m++) {
        const raw = byMonth[String(m)] ?? 0;
        // Revenue stored positive in budget, expenses stored positive too
        months[String(m)] = raw;
        total += raw;
        subtotal[String(m)] += raw;
      }
      subtotal.total += total;

      return {
        accountId: a.id,
        accountName: a.name,
        accountNumber: a.accountNumber,
        months,
        total,
      };
    });

    sectionTotals[config.id] = subtotal;
    sections.push({
      id: config.id,
      title: config.title,
      lines,
      subtotal,
    });
  }

  // Build computed lines (Gross Profit, Operating Income, Net Income)
  const computedLines: ComputedLine[] = [];

  for (const comp of INCOME_STATEMENT_COMPUTED) {
    const amounts: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      let val = 0;
      for (const { sectionId, sign } of comp.formula) {
        val += (sectionTotals[sectionId]?.[String(m)] ?? 0) * sign;
      }
      amounts[String(m)] = val;
    }
    let total = 0;
    for (const { sectionId, sign } of comp.formula) {
      total += (sectionTotals[sectionId]?.total ?? 0) * sign;
    }
    amounts.total = total;

    computedLines.push({
      id: comp.id,
      label: comp.label,
      amounts,
      isGrandTotal: comp.isGrandTotal,
    });
  }

  return NextResponse.json({
    version: {
      id: version.id,
      name: version.name,
      fiscalYear: version.fiscal_year,
      status: version.status,
    },
    sections,
    computedLines,
  });
}
