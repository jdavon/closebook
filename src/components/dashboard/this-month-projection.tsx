"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import { getPeriodLabel } from "@/lib/utils/dates";
import { formatStatementAmount } from "@/components/financial-statements/format-utils";
import {
  INCOME_STATEMENT_COMPUTED,
} from "@/lib/config/statement-sections";
import {
  ProjectionSummaryTable,
  type SummaryRow,
} from "./projection-summary-table";

/** Revenue-type sections that accept user-entered projections */
const REVENUE_SECTIONS = [
  { id: "revenue", label: "Revenue" },
  { id: "other_income", label: "Other Income" },
];

/** Expense-type sections whose projections come from budget */
const EXPENSE_SECTIONS = [
  { id: "direct_operating_costs", label: "Direct Operating Costs" },
  { id: "other_operating_costs", label: "Other Operating Costs" },
  { id: "other_expense", label: "Other Expense" },
];

interface SavedProjection {
  section_id: string;
  projected_amount: number;
  notes: string | null;
}

interface ThisMonthProjectionProps {
  entityId: string;
  currentYear: number;
  currentMonth: number;
}

export function ThisMonthProjection({
  entityId,
  currentYear,
  currentMonth,
}: ThisMonthProjectionProps) {
  const periodLabel = getPeriodLabel(currentYear, currentMonth);

  // Revenue projection inputs (keyed by section ID)
  const [projectionInputs, setProjectionInputs] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);
  const [loadingProjections, setLoadingProjections] = useState(true);

  // Fetch budget data for current month via the financial statements API
  const { data: budgetData, loading: budgetLoading, error: budgetError } =
    useFinancialStatements({
      scope: "entity",
      entityId,
      startYear: currentYear,
      startMonth: currentMonth,
      endYear: currentYear,
      endMonth: currentMonth,
      granularity: "monthly",
      includeBudget: true,
      includeYoY: false,
      includeProForma: false,
      includeAllocations: false,
      includeTotal: false,
    });

  // Load saved revenue projections
  useEffect(() => {
    async function loadProjections() {
      try {
        const res = await fetch(
          `/api/revenue-projections?entityId=${entityId}&year=${currentYear}&month=${currentMonth}`
        );
        if (!res.ok) throw new Error("Failed to load projections");
        const { projections } = (await res.json()) as {
          projections: SavedProjection[];
        };

        const inputs: Record<string, string> = {};
        for (const p of projections) {
          inputs[p.section_id] = String(Number(p.projected_amount));
        }
        setProjectionInputs(inputs);
      } catch (err) {
        console.error("Load projections error:", err);
      } finally {
        setLoadingProjections(false);
      }
    }
    loadProjections();
  }, [entityId, currentYear, currentMonth]);

  // Extract budget amounts by section from the financial statements response
  const budgetBySection = useMemo(() => {
    if (!budgetData?.incomeStatement) return new Map<string, number>();

    const periodKey = budgetData.periods[0]?.key;
    if (!periodKey) return new Map<string, number>();

    const map = new Map<string, number>();
    for (const section of budgetData.incomeStatement.sections) {
      if (section.subtotalLine?.budgetAmounts) {
        map.set(section.id, section.subtotalLine.budgetAmounts[periodKey] ?? 0);
      }
    }
    return map;
  }, [budgetData]);

  // Save projections
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const projections = REVENUE_SECTIONS.map((s) => ({
        sectionId: s.id,
        amount: Number(projectionInputs[s.id] || 0),
      }));

      const res = await fetch("/api/revenue-projections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: currentYear,
          periodMonth: currentMonth,
          projections,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }

      toast.success("Projections saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save projections"
      );
    } finally {
      setSaving(false);
    }
  }, [entityId, currentYear, currentMonth, projectionInputs]);

  // Build the projected P&L rows
  const projectedRows = useMemo<SummaryRow[]>(() => {
    // Get section totals for computing margins
    const sectionAmounts: Record<string, number> = {};

    // Revenue sections: use user projections
    for (const s of REVENUE_SECTIONS) {
      sectionAmounts[s.id] = Number(projectionInputs[s.id] || 0);
    }

    // Expense sections: use budget amounts
    for (const s of EXPENSE_SECTIONS) {
      sectionAmounts[s.id] = budgetBySection.get(s.id) ?? 0;
    }

    const rows: SummaryRow[] = [];

    // Revenue sections
    for (const s of REVENUE_SECTIONS) {
      rows.push({
        id: s.id,
        label: s.label,
        actual: sectionAmounts[s.id],
        budget: budgetBySection.get(s.id) ?? null,
        isComputed: false,
        isExpense: false,
      });
    }

    // Direct Operating Costs
    rows.push({
      id: "direct_operating_costs",
      label: "Direct Operating Costs",
      actual: sectionAmounts["direct_operating_costs"],
      budget: budgetBySection.get("direct_operating_costs") ?? null,
      isComputed: false,
      isExpense: true,
    });

    // Gross Margin (computed)
    const grossMarginConfig = INCOME_STATEMENT_COMPUTED.find(
      (c) => c.id === "gross_margin"
    );
    if (grossMarginConfig) {
      let grossMargin = 0;
      for (const { sectionId, sign } of grossMarginConfig.formula) {
        grossMargin += (sectionAmounts[sectionId] ?? 0) * sign;
      }
      const grossMarginBudget = computeFormulaFromBudget(
        grossMarginConfig.formula,
        budgetBySection
      );
      rows.push({
        id: "gross_margin",
        label: "Gross Margin",
        actual: grossMargin,
        budget: grossMarginBudget,
        isComputed: true,
        isExpense: false,
      });
    }

    // Other Operating Costs
    rows.push({
      id: "other_operating_costs",
      label: "Other Operating Costs",
      actual: sectionAmounts["other_operating_costs"],
      budget: budgetBySection.get("other_operating_costs") ?? null,
      isComputed: false,
      isExpense: true,
    });

    // Operating Margin (computed)
    const opMarginConfig = INCOME_STATEMENT_COMPUTED.find(
      (c) => c.id === "operating_margin"
    );
    if (opMarginConfig) {
      let opMargin = 0;
      for (const { sectionId, sign } of opMarginConfig.formula) {
        opMargin += (sectionAmounts[sectionId] ?? 0) * sign;
      }
      const opMarginBudget = computeFormulaFromBudget(
        opMarginConfig.formula,
        budgetBySection
      );
      rows.push({
        id: "operating_margin",
        label: "Operating Margin",
        actual: opMargin,
        budget: opMarginBudget,
        isComputed: true,
        isExpense: false,
      });
    }

    // Other Expense
    rows.push({
      id: "other_expense",
      label: "Other Expense",
      actual: sectionAmounts["other_expense"],
      budget: budgetBySection.get("other_expense") ?? null,
      isComputed: false,
      isExpense: true,
    });

    // Other Income (already shown above in revenue sections, skip duplicate)

    // Net Income (computed)
    const netIncomeConfig = INCOME_STATEMENT_COMPUTED.find(
      (c) => c.id === "net_income"
    );
    if (netIncomeConfig) {
      let netIncome = 0;
      for (const { sectionId, sign } of netIncomeConfig.formula) {
        netIncome += (sectionAmounts[sectionId] ?? 0) * sign;
      }
      const netIncomeBudget = computeFormulaFromBudget(
        netIncomeConfig.formula,
        budgetBySection
      );
      rows.push({
        id: "net_income",
        label: "Net Income",
        actual: netIncome,
        budget: netIncomeBudget,
        isComputed: true,
        isExpense: false,
      });
    }

    return rows;
  }, [projectionInputs, budgetBySection]);

  const isLoading = budgetLoading || loadingProjections;

  return (
    <Card>
      <CardHeader>
        <CardDescription>This Month Projection</CardDescription>
        <CardTitle className="text-lg">{periodLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {budgetError && (
          <p className="text-sm text-destructive">
            Failed to load budget data: {budgetError}
          </p>
        )}
        {!isLoading && !budgetError && (
          <>
            {/* Revenue Projection Inputs */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Revenue Projections</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {REVENUE_SECTIONS.map((section) => {
                  const budgetVal = budgetBySection.get(section.id);
                  return (
                    <div key={section.id} className="space-y-1">
                      <Label htmlFor={`proj-${section.id}`} className="text-xs">
                        {section.label}
                        {budgetVal !== undefined && (
                          <span className="ml-2 text-muted-foreground">
                            Budget: {formatStatementAmount(budgetVal, true)}
                          </span>
                        )}
                      </Label>
                      <Input
                        id={`proj-${section.id}`}
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={projectionInputs[section.id] ?? ""}
                        onChange={(e) =>
                          setProjectionInputs((prev) => ({
                            ...prev,
                            [section.id]: e.target.value,
                          }))
                        }
                        className="tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Projection
              </Button>
            </div>

            {/* Projected P&L */}
            <div>
              <h3 className="text-sm font-medium mb-2">Projected P&L</h3>
              <ProjectionSummaryTable
                rows={projectedRows}
                actualLabel="Projected"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Compute a formula-based total from budget section amounts */
function computeFormulaFromBudget(
  formula: Array<{ sectionId: string; sign: 1 | -1 }>,
  budgetBySection: Map<string, number>
): number {
  let total = 0;
  for (const { sectionId, sign } of formula) {
    total += (budgetBySection.get(sectionId) ?? 0) * sign;
  }
  return total;
}
