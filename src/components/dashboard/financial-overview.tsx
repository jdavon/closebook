"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import { getPriorPeriod } from "@/lib/utils/dates";
import { KpiCard, type SparklinePoint } from "./kpi-card";
import { MonthlyTrendChart, type TrendPoint } from "./monthly-trend-chart";
import { RevenueByReportingEntity } from "./revenue-by-re";
import type { FinancialStatementsResponse } from "@/components/financial-statements/types";

type FinancialOverviewProps =
  | {
      scope: "entity";
      entityId: string;
      organizationId?: never;
      currentYear: number;
      currentMonth: number;
      title?: string;
    }
  | {
      scope: "organization";
      organizationId: string;
      entityId?: never;
      currentYear: number;
      currentMonth: number;
      title?: string;
    };

function getTwelveMonthRange(year: number, month: number) {
  const end = getPriorPeriod(year, month);
  let startYear = end.year;
  let startMonth = end.month - 11;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  return {
    startYear,
    startMonth,
    endYear: end.year,
    endMonth: end.month,
  };
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}$${Math.abs(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${n < 0 ? "-" : ""}$${Math.abs(n / 1_000).toFixed(1)}K`;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(0)}`;
}

function formatUsdFull(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number): string {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function percentDelta(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : Infinity;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function seriesFromStatements(
  data: FinancialStatementsResponse | null,
  sectionId: string
): { periods: Array<{ key: string; label: string }>; values: number[] } {
  if (!data?.incomeStatement || !data.periods.length) {
    return { periods: [], values: [] };
  }
  const periods = data.periods.filter((p) => !p.isTotal);
  const section = data.incomeStatement.sections.find((s) => s.id === sectionId);
  const subtotal = section?.subtotalLine;
  const values = periods.map((p) =>
    subtotal ? subtotal.amounts[p.key] ?? 0 : 0
  );
  return {
    periods: periods.map((p) => ({ key: p.key, label: p.label })),
    values,
  };
}

export function FinancialOverview(props: FinancialOverviewProps) {
  const { scope, currentYear, currentMonth, title } = props;

  const range = useMemo(
    () => getTwelveMonthRange(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const baseConfig = useMemo(
    () => ({
      scope,
      entityId: scope === "entity" ? props.entityId : undefined,
      organizationId:
        scope === "organization" ? props.organizationId : undefined,
      startYear: range.startYear,
      startMonth: range.startMonth,
      endYear: range.endYear,
      endMonth: range.endMonth,
      granularity: "monthly" as const,
      includeBudget: false,
      includeYoY: false,
      includeAllocations: false,
      includeTotal: false,
    }),
    [
      scope,
      range,
      props.entityId,
      props.organizationId,
    ]
  );

  const {
    data: baseData,
    loading: baseLoading,
    error: baseError,
  } = useFinancialStatements({
    ...baseConfig,
    includeProForma: false,
  });

  const {
    data: pfData,
    loading: pfLoading,
    error: pfError,
  } = useFinancialStatements({
    ...baseConfig,
    includeProForma: true,
  });

  const error = baseError ?? pfError;
  const loading = baseLoading || pfLoading;

  const overview = useMemo(() => {
    if (!baseData || !pfData) return null;

    const base = {
      revenue: seriesFromStatements(baseData, "revenue"),
      ebitda: seriesFromStatements(baseData, "operating_margin"),
      gross: seriesFromStatements(baseData, "gross_margin"),
      netIncome: seriesFromStatements(baseData, "net_income"),
    };
    const pf = {
      revenue: seriesFromStatements(pfData, "revenue"),
      ebitda: seriesFromStatements(pfData, "operating_margin"),
      gross: seriesFromStatements(pfData, "gross_margin"),
      netIncome: seriesFromStatements(pfData, "net_income"),
    };

    const periods = pf.revenue.periods.length
      ? pf.revenue.periods
      : base.revenue.periods;
    if (!periods.length) return null;

    const baseRev = base.revenue.values;
    const baseEbitda = base.ebitda.values;
    const pfRev = pf.revenue.values;
    const pfEbitda = pf.ebitda.values;
    const pfGross = pf.gross.values;
    const pfNetIncome = pf.netIncome.values;

    const revAdj = pfRev.map((v, i) => v - (baseRev[i] ?? 0));
    const ebitdaAdj = pfEbitda.map((v, i) => v - (baseEbitda[i] ?? 0));

    const totalPfRevenue = pfRev.reduce((a, b) => a + b, 0);
    const totalPfEbitda = pfEbitda.reduce((a, b) => a + b, 0);
    const totalPfGross = pfGross.reduce((a, b) => a + b, 0);
    const totalPfNetIncome = pfNetIncome.reduce((a, b) => a + b, 0);

    const totalBaseRevenue = baseRev.reduce((a, b) => a + b, 0);
    const totalBaseEbitda = baseEbitda.reduce((a, b) => a + b, 0);

    const pfRevAdj = totalPfRevenue - totalBaseRevenue;
    const pfEbitdaAdj = totalPfEbitda - totalBaseEbitda;

    const ebitdaMargin = totalPfRevenue === 0 ? 0 : totalPfEbitda / totalPfRevenue;
    const grossMargin = totalPfRevenue === 0 ? 0 : totalPfGross / totalPfRevenue;

    const n = pfRev.length;
    const midpoint = Math.floor(n / 2);
    const firstHalfRev = pfRev.slice(0, midpoint).reduce((a, b) => a + b, 0);
    const secondHalfRev = pfRev.slice(midpoint).reduce((a, b) => a + b, 0);
    const revDelta = percentDelta(secondHalfRev, firstHalfRev);

    const firstHalfEbitda = pfEbitda.slice(0, midpoint).reduce((a, b) => a + b, 0);
    const secondHalfEbitda = pfEbitda.slice(midpoint).reduce((a, b) => a + b, 0);
    const ebitdaDelta = percentDelta(secondHalfEbitda, firstHalfEbitda);

    const marginFirst =
      firstHalfRev === 0 ? 0 : firstHalfEbitda / firstHalfRev;
    const marginSecond =
      secondHalfRev === 0 ? 0 : secondHalfEbitda / secondHalfRev;
    const marginDelta = (marginSecond - marginFirst) * 100;

    const revenueChart: TrendPoint[] = periods.map((p, i) => ({
      label: p.label,
      value: baseRev[i] ?? 0,
      adjustment: revAdj[i] ?? 0,
    }));

    const ebitdaChart: TrendPoint[] = periods.map((p, i) => ({
      label: p.label,
      value: baseEbitda[i] ?? 0,
      adjustment: ebitdaAdj[i] ?? 0,
    }));

    const revenueSpark: SparklinePoint[] = periods.map((p, i) => ({
      key: p.key,
      value: pfRev[i] ?? 0,
    }));
    const ebitdaSpark: SparklinePoint[] = periods.map((p, i) => ({
      key: p.key,
      value: pfEbitda[i] ?? 0,
    }));
    const marginSpark: SparklinePoint[] = periods.map((p, i) => ({
      key: p.key,
      value:
        (pfRev[i] ?? 0) === 0
          ? 0
          : (pfEbitda[i] ?? 0) / (pfRev[i] ?? 1),
    }));
    const netIncomeSpark: SparklinePoint[] = periods.map((p, i) => ({
      key: p.key,
      value: pfNetIncome[i] ?? 0,
    }));

    const hasPfAdjustments =
      Math.abs(pfRevAdj) > 0.5 || Math.abs(pfEbitdaAdj) > 0.5;

    const rangeLabel = `${periods[0]?.label} – ${periods[periods.length - 1]?.label}`;

    return {
      rangeLabel,
      hasPfAdjustments,
      totalPfRevenue,
      totalPfEbitda,
      pfRevAdj,
      pfEbitdaAdj,
      ebitdaMargin,
      grossMargin,
      totalPfNetIncome,
      revDelta,
      ebitdaDelta,
      marginDelta,
      revenueChart,
      ebitdaChart,
      revenueSpark,
      ebitdaSpark,
      marginSpark,
      netIncomeSpark,
    };
  }, [baseData, pfData]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            Couldn&apos;t load performance data: {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading || !overview) {
    return <OverviewSkeleton />;
  }

  const headline = title ?? "Trailing 12-Month Performance";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{headline}</h2>
          <p className="text-sm text-muted-foreground">{overview.rangeLabel}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Revenue (TTM)"
          value={formatUsd(overview.totalPfRevenue)}
          subValue="12 mo"
          delta={{
            value: overview.revDelta,
            label: "vs prior 6 mo",
          }}
          sparkline={overview.revenueSpark}
          tone={overview.revDelta >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="EBITDA (TTM)"
          value={formatUsd(overview.totalPfEbitda)}
          subValue="12 mo"
          delta={{
            value: overview.ebitdaDelta,
            label: "vs prior 6 mo",
          }}
          sparkline={overview.ebitdaSpark}
          tone={overview.ebitdaDelta >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="EBITDA Margin"
          value={formatPct(overview.ebitdaMargin)}
          subValue="TTM"
          delta={{
            value: overview.marginDelta,
            label: "pp change",
          }}
          sparkline={overview.marginSpark}
          tone={overview.marginDelta >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Net Income (TTM)"
          value={formatUsd(overview.totalPfNetIncome)}
          subValue={`GM ${formatPct(overview.grossMargin)}`}
          sparkline={overview.netIncomeSpark}
          tone={overview.totalPfNetIncome >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {scope === "organization" ? (
          <RevenueByReportingEntity
            organizationId={props.organizationId}
            currentYear={currentYear}
            currentMonth={currentMonth}
            includeProForma
          />
        ) : (
          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <CardDescription className="text-base font-semibold text-foreground">
                Monthly Revenue
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <div className="flex-1 min-h-[260px]">
                <MonthlyTrendChart
                  data={overview.revenueChart}
                  barColor="var(--color-sky-500, #0ea5e9)"
                  adjustmentColor="var(--color-sky-300, #7dd3fc)"
                  valueFormatter={formatUsdFull}
                  baseLabel="Actual"
                  adjustmentLabel="Adjustment"
                  showLegend={false}
                />
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardDescription className="text-base font-semibold text-foreground">
              Monthly EBITDA
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <div className="flex-1 min-h-[260px]">
              <MonthlyTrendChart
                data={overview.ebitdaChart}
                barColor="var(--color-emerald-500, #10b981)"
                adjustmentColor="var(--color-amber-500, #f59e0b)"
                valueFormatter={formatUsdFull}
                baseLabel="Actual"
                adjustmentLabel="Adjustment"
                showLegend={false}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-64" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
