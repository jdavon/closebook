"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Minus,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { RECON_GROUPS } from "@/lib/utils/asset-gl-groups";

type CellStatus =
  | "reconciled"
  | "variance"
  | "pending"
  | "no_accounts"
  | "no_data";

interface ReconciliationRow {
  gl_account_group: string;
  period_month: number;
  variance: number | null;
  is_reconciled: boolean;
}

interface Props {
  entityId: string;
  year: number;
  onYearChange: (year: number) => void;
  onJumpToMonth: (year: number, month: number) => void;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function ReconciliationYearView({
  entityId,
  year,
  onYearChange,
  onJumpToMonth,
}: Props) {
  const supabase = createClient();
  const now = new Date();

  const [loading, setLoading] = useState(true);
  const [recons, setRecons] = useState<ReconciliationRow[]>([]);
  const [hasMappings, setHasMappings] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);

    const [reconRes, linkRes] = await Promise.all([
      supabase
        .from("asset_reconciliations")
        .select("gl_account_group, period_month, variance, is_reconciled")
        .eq("entity_id", entityId)
        .eq("period_year", year),
      fetch(`/api/assets/recon-links?entityId=${entityId}`),
    ]);

    setRecons((reconRes.data ?? []) as ReconciliationRow[]);

    const mappingData: Array<{ recon_group: string }> = linkRes.ok
      ? await linkRes.json()
      : [];
    const mapped: Record<string, boolean> = {};
    for (const group of RECON_GROUPS) {
      mapped[group.key] = false;
    }
    for (const m of mappingData) {
      mapped[m.recon_group] = true;
    }
    setHasMappings(mapped);

    setLoading(false);
  }, [supabase, entityId, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const reconMap: Record<string, Record<number, ReconciliationRow>> = {};
  for (const group of RECON_GROUPS) reconMap[group.key] = {};
  for (const r of recons) {
    if (!reconMap[r.gl_account_group]) reconMap[r.gl_account_group] = {};
    reconMap[r.gl_account_group][r.period_month] = r;
  }

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function getStatus(groupKey: string, month: number): CellStatus {
    if (!hasMappings[groupKey]) return "no_accounts";
    const r = reconMap[groupKey]?.[month];
    if (!r) return "pending";
    if (r.is_reconciled) return "reconciled";
    if (Math.abs(Number(r.variance ?? 0)) > 1) return "variance";
    return "pending";
  }

  function getGroupSummary(groupKey: string): {
    reconciled: number;
    variance: number;
    pending: number;
  } {
    let reconciled = 0;
    let varianceCount = 0;
    let pending = 0;
    for (let m = 1; m <= 12; m++) {
      const s = getStatus(groupKey, m);
      if (s === "reconciled") reconciled++;
      else if (s === "variance") varianceCount++;
      else if (s === "pending") pending++;
    }
    return { reconciled, variance: varianceCount, pending };
  }

  return (
    <div className="space-y-4">
      {/* Year Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Year:</span>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onYearChange(year - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select
          value={String(year)}
          onValueChange={(v) => onYearChange(Number(v))}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onYearChange(year + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          Reconciled
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          Variance
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
          Pending
        </span>
        <span className="flex items-center gap-1.5">
          <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />
          No Accounts Linked
        </span>
        <span className="ml-auto italic">Click any cell to open that month</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading year reconciliation...
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-10 min-w-[240px]">
                  Reconciliation Group
                </TableHead>
                {MONTH_LABELS.map((m, i) => {
                  const isFuture =
                    year > now.getFullYear() ||
                    (year === now.getFullYear() && i + 1 > now.getMonth() + 1);
                  return (
                    <TableHead
                      key={m}
                      className={`text-center px-1 ${isFuture ? "text-muted-foreground/60" : ""}`}
                    >
                      {m}
                    </TableHead>
                  );
                })}
                <TableHead className="text-center min-w-[110px]">
                  Summary
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RECON_GROUPS.map((group) => {
                const summary = getGroupSummary(group.key);
                const noMappings = !hasMappings[group.key];
                return (
                  <TableRow key={group.key}>
                    <TableCell className="sticky left-0 bg-background z-10 font-medium">
                      {group.displayName}
                    </TableCell>
                    {MONTH_LABELS.map((_, i) => {
                      const month = i + 1;
                      const status = getStatus(group.key, month);
                      const isFuture =
                        year > now.getFullYear() ||
                        (year === now.getFullYear() &&
                          month > now.getMonth() + 1);
                      return (
                        <TableCell
                          key={month}
                          className="p-0 text-center"
                        >
                          <button
                            type="button"
                            onClick={() => onJumpToMonth(year, month)}
                            title={`${group.displayName} — ${MONTH_LABELS[i]} ${year}: ${statusLabel(status)}`}
                            className={`w-full h-10 flex items-center justify-center hover:bg-muted transition-colors ${
                              isFuture ? "opacity-50" : ""
                            }`}
                          >
                            <StatusIcon status={status} />
                          </button>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      {noMappings ? (
                        <Badge variant="outline" className="text-xs">
                          No Accounts
                        </Badge>
                      ) : (
                        <span className="text-xs tabular-nums">
                          <span className="text-green-600 font-medium">
                            {summary.reconciled}
                          </span>
                          {" / "}
                          <span>12</span>
                          {summary.variance > 0 && (
                            <span className="ml-1 text-red-600">
                              ({summary.variance}!)
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Totals tile */}
      {!loading && (
        <YearTotals recons={recons} />
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: CellStatus }) {
  if (status === "reconciled") {
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  }
  if (status === "variance") {
    return <AlertTriangle className="h-5 w-5 text-red-600" />;
  }
  if (status === "pending") {
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground/40" />;
}

function statusLabel(status: CellStatus): string {
  switch (status) {
    case "reconciled":
      return "Reconciled";
    case "variance":
      return "Variance";
    case "pending":
      return "Pending";
    case "no_accounts":
      return "No Accounts Linked";
    case "no_data":
      return "No Data";
  }
}

function YearTotals({ recons }: { recons: ReconciliationRow[] }) {
  const totalCells = RECON_GROUPS.length * 12;
  let reconciledCount = 0;
  let varianceCount = 0;
  let totalVariance = 0;

  for (const r of recons) {
    if (r.is_reconciled) reconciledCount++;
    const v = Math.abs(Number(r.variance ?? 0));
    if (!r.is_reconciled && v > 1) {
      varianceCount++;
      totalVariance += v;
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Reconciled
          </p>
          <p className="text-lg font-semibold tabular-nums">
            <span className="text-green-600">{reconciledCount}</span>
            <span className="text-muted-foreground"> / {totalCells}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Open Variances
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              varianceCount > 0 ? "text-red-600" : "text-green-600"
            }`}
          >
            {varianceCount}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Total Open Variance
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              totalVariance > 1 ? "text-red-600" : "text-green-600"
            }`}
          >
            {formatCurrency(totalVariance)}
          </p>
        </div>
      </div>
    </div>
  );
}
