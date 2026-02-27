"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import { getPriorPeriod, getPeriodLabel } from "@/lib/utils/dates";
import {
  ProjectionSummaryTable,
  type SummaryRow,
} from "./projection-summary-table";

// IS section IDs from statement-sections.ts that map to the condensed summary
const SECTION_MAP: Record<
  string,
  { label: string; isComputed: boolean; isExpense: boolean }
> = {
  revenue: { label: "Revenue", isComputed: false, isExpense: false },
  direct_operating_costs: {
    label: "Direct Operating Costs",
    isComputed: false,
    isExpense: true,
  },
  gross_margin: { label: "Gross Margin", isComputed: true, isExpense: false },
  other_operating_costs: {
    label: "Other Operating Costs",
    isComputed: false,
    isExpense: true,
  },
  operating_margin: {
    label: "Operating Margin",
    isComputed: true,
    isExpense: false,
  },
  other_expense: { label: "Other Expense", isComputed: false, isExpense: true },
  other_income: {
    label: "Other Income",
    isComputed: false,
    isExpense: false,
  },
  net_income: { label: "Net Income", isComputed: true, isExpense: false },
};

const SECTION_ORDER = [
  "revenue",
  "direct_operating_costs",
  "gross_margin",
  "other_operating_costs",
  "operating_margin",
  "other_expense",
  "other_income",
  "net_income",
];

interface LastMonthPerformanceProps {
  entityId: string;
  currentYear: number;
  currentMonth: number;
}

export function LastMonthPerformance({
  entityId,
  currentYear,
  currentMonth,
}: LastMonthPerformanceProps) {
  const prior = getPriorPeriod(currentYear, currentMonth);
  const periodLabel = getPeriodLabel(prior.year, prior.month);

  const { data, loading, error } = useFinancialStatements({
    scope: "entity",
    entityId,
    startYear: prior.year,
    startMonth: prior.month,
    endYear: prior.year,
    endMonth: prior.month,
    granularity: "monthly",
    includeBudget: true,
    includeYoY: false,
    includeProForma: false,
    includeAllocations: false,
    includeTotal: false,
  });

  const rows = useMemo<SummaryRow[]>(() => {
    if (!data?.incomeStatement) return [];

    const periodKey = data.periods[0]?.key;
    if (!periodKey) return [];

    const result: SummaryRow[] = [];

    for (const sectionId of SECTION_ORDER) {
      const meta = SECTION_MAP[sectionId];
      if (!meta) continue;

      // Find the section or computed pseudo-section
      const section = data.incomeStatement.sections.find(
        (s) => s.id === sectionId
      );
      if (!section?.subtotalLine) continue;

      const actual = section.subtotalLine.amounts[periodKey] ?? 0;
      const budget = section.subtotalLine.budgetAmounts?.[periodKey] ?? null;

      result.push({
        id: sectionId,
        label: meta.label,
        actual,
        budget,
        isComputed: meta.isComputed,
        isExpense: meta.isExpense,
      });
    }

    return result;
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardDescription>Last Month</CardDescription>
        <CardTitle className="text-lg">{periodLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive">
            Failed to load: {error}
          </p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No financial data available for {periodLabel}.
          </p>
        )}
        {!loading && !error && rows.length > 0 && (
          <ProjectionSummaryTable rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}
