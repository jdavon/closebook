"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SparklinePoint {
  key: string;
  value: number;
}

interface KpiCardProps {
  label: string;
  value: string;
  subValue?: string;
  delta?: {
    value: number;
    label: string;
    invertColors?: boolean;
  };
  sparkline?: SparklinePoint[];
  tone?: "default" | "positive" | "negative" | "neutral";
}

export function KpiCard({
  label,
  value,
  subValue,
  delta,
  sparkline,
  tone = "default",
}: KpiCardProps) {
  const sparklineColor = (() => {
    if (tone === "positive") return "var(--color-emerald-500, #10b981)";
    if (tone === "negative") return "var(--color-rose-500, #f43f5e)";
    return "var(--color-sky-500, #0ea5e9)";
  })();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-1 space-y-0">
        <CardDescription className="text-xs font-medium uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
          {subValue && (
            <span className="text-xs text-muted-foreground">{subValue}</span>
          )}
        </div>
        {delta && <DeltaPill delta={delta} />}
        {sparkline && sparkline.length > 1 && (
          <div className="h-10 -mx-2 -mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline}>
                <defs>
                  <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={sparklineColor}
                  strokeWidth={1.5}
                  fill={`url(#spark-${label})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaPill({
  delta,
}: {
  delta: NonNullable<KpiCardProps["delta"]>;
}) {
  const favorable = delta.invertColors ? delta.value < 0 : delta.value > 0;
  const unfavorable = delta.invertColors ? delta.value > 0 : delta.value < 0;
  const neutral = delta.value === 0 || !isFinite(delta.value);

  const Icon = neutral ? Minus : favorable ? ArrowUpRight : ArrowDownRight;
  const toneClass = neutral
    ? "text-muted-foreground"
    : favorable
    ? "text-emerald-600 dark:text-emerald-400"
    : unfavorable
    ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";

  const absValue = Math.abs(delta.value);
  const display = isFinite(absValue)
    ? `${absValue.toFixed(1)}%`
    : "—";

  return (
    <div className={cn("flex items-center gap-1 text-xs", toneClass)}>
      <Icon className="size-3.5" />
      <span className="font-medium">{display}</span>
      <span className="text-muted-foreground">{delta.label}</span>
    </div>
  );
}
