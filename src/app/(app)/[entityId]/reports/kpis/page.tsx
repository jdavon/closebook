"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercentage, formatNumber, getCurrentPeriod, getPeriodShortLabel } from "@/lib/utils/dates";
import { Plus, TrendingUp, TrendingDown, Target } from "lucide-react";

interface KpiValue {
  period_year: number;
  period_month: number;
  value: number;
  kpi_definitions: {
    id: string;
    name: string;
    description: string | null;
    format: string;
    target_value: number | null;
  };
}

interface KpiCard {
  id: string;
  name: string;
  description: string | null;
  format: string;
  currentValue: number | null;
  targetValue: number | null;
  priorValue: number | null;
  trend: number | null; // % change from prior
}

export default function KpiDashboardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [kpis, setKpis] = useState<KpiCard[]>([]);
  const [loading, setLoading] = useState(true);

  const currentPeriod = getCurrentPeriod();

  const loadKpis = useCallback(async () => {
    const { data } = await supabase
      .from("kpi_values")
      .select(
        "period_year, period_month, value, kpi_definitions(id, name, description, format, target_value)"
      )
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    if (!data || data.length === 0) {
      setKpis([]);
      setLoading(false);
      return;
    }

    // Group by KPI definition
    const kpiMap = new Map<string, KpiValue[]>();
    for (const item of data as unknown as KpiValue[]) {
      const defId = item.kpi_definitions.id;
      if (!kpiMap.has(defId)) kpiMap.set(defId, []);
      kpiMap.get(defId)!.push(item);
    }

    const cards: KpiCard[] = [];
    for (const [, values] of kpiMap) {
      const current = values[0];
      const prior = values.length > 1 ? values[1] : null;

      cards.push({
        id: current.kpi_definitions.id,
        name: current.kpi_definitions.name,
        description: current.kpi_definitions.description,
        format: current.kpi_definitions.format,
        currentValue: current.value,
        targetValue: current.kpi_definitions.target_value,
        priorValue: prior?.value ?? null,
        trend:
          prior && prior.value !== 0
            ? (current.value - prior.value) / Math.abs(prior.value)
            : null,
      });
    }

    setKpis(cards);
    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  function formatKpiValue(value: number, format: string): string {
    switch (format) {
      case "percentage":
        return formatPercentage(value);
      case "currency":
        return formatCurrency(value);
      default:
        return formatNumber(value);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            KPI Dashboard
          </h1>
          <p className="text-muted-foreground">
            {getPeriodShortLabel(currentPeriod.year, currentPeriod.month)}
          </p>
        </div>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Configure KPIs
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : kpis.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No KPIs Configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Define KPIs to track key metrics like gross margin, current
              ratio, and revenue trends.
            </p>
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Your First KPI
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {kpis.map((kpi) => (
            <Card key={kpi.id}>
              <CardHeader className="pb-2">
                <CardDescription>{kpi.name}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {kpi.currentValue !== null
                    ? formatKpiValue(kpi.currentValue, kpi.format)
                    : "---"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  {kpi.trend !== null && (
                    <div
                      className={`flex items-center gap-1 text-sm ${
                        kpi.trend >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {kpi.trend >= 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                      {formatPercentage(Math.abs(kpi.trend))} vs prior
                    </div>
                  )}
                  {kpi.targetValue !== null && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Target className="h-4 w-4" />
                      Target: {formatKpiValue(kpi.targetValue, kpi.format)}
                    </div>
                  )}
                </div>
                {kpi.description && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {kpi.description}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
