"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendPoint {
  label: string;
  value: number;
  adjustment?: number;
}

interface MonthlyTrendChartProps {
  data: TrendPoint[];
  barColor?: string;
  adjustmentColor?: string;
  valueFormatter?: (value: number) => string;
  height?: number | string;
  baseLabel?: string;
  adjustmentLabel?: string;
  showLegend?: boolean;
}

export function MonthlyTrendChart({
  data,
  barColor = "var(--color-sky-500, #0ea5e9)",
  adjustmentColor = "var(--color-amber-500, #f59e0b)",
  valueFormatter = (n) => n.toLocaleString(),
  height = "100%",
  baseLabel = "Actual",
  adjustmentLabel = "Adjustment",
  showLegend = false,
}: MonthlyTrendChartProps) {
  const hasAdjustment = data.some((d) => (d.adjustment ?? 0) !== 0);

  return (
    <div style={{ width: "100%", height, minHeight: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--border, #e5e7eb)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground, #6b7280)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground, #6b7280)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(n: number) => formatCompact(n)}
            width={64}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.1)" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--border, #e5e7eb)",
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : 0;
              const label =
                name === "value" ? baseLabel : adjustmentLabel;
              return [valueFormatter(numeric), label];
            }}
          />
          {showLegend && hasAdjustment && (
            <Legend
              verticalAlign="top"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) =>
                value === "value" ? baseLabel : adjustmentLabel
              }
            />
          )}
          <Bar
            dataKey="value"
            stackId="total"
            fill={barColor}
            radius={hasAdjustment ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            maxBarSize={32}
          />
          {hasAdjustment && (
            <Bar
              dataKey="adjustment"
              stackId="total"
              fill={adjustmentColor}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export function computeLinearTrend(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) {
    const avg = sumY / n;
    return values.map(() => avg);
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return values.map((_, i) => slope * i + intercept);
}
