"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  ArrowRight,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";
import Link from "next/link";

interface EntityInfo {
  id: string;
  name: string;
  code: string;
}

interface VarianceRecord {
  entityId: string;
  entityName: string;
  entityCode: string;
  periodYear: number;
  periodMonth: number;
  totalDebits: number;
  totalCredits: number;
  variance: number;
  accountCount: number;
  isBalanced: boolean;
}

interface VarianceResponse {
  year: number;
  entities: EntityInfo[];
  variances: VarianceRecord[];
  summary: {
    totalPeriods: number;
    balanced: number;
    unbalanced: number;
  };
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function TBVariancePage() {
  const currentPeriod = getCurrentPeriod();
  const [year, setYear] = useState(String(currentPeriod.year));
  const [data, setData] = useState<VarianceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tb-variance?year=${year}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch {
      // handle error silently
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build a lookup: entityId -> month -> variance record
  const varianceMap = new Map<string, Map<number, VarianceRecord>>();
  if (data) {
    for (const v of data.variances) {
      if (!varianceMap.has(v.entityId)) {
        varianceMap.set(v.entityId, new Map());
      }
      varianceMap.get(v.entityId)!.set(v.periodMonth, v);
    }
  }

  // Count unbalanced per entity
  const unbalancedByEntity = new Map<string, number>();
  if (data) {
    for (const v of data.variances) {
      if (!v.isBalanced) {
        unbalancedByEntity.set(
          v.entityId,
          (unbalancedByEntity.get(v.entityId) ?? 0) + 1
        );
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            TB Variance Check
          </h1>
          <p className="text-muted-foreground">
            Identify unbalanced trial balances across all entities
          </p>
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              currentPeriod.year - 2,
              currentPeriod.year - 1,
              currentPeriod.year,
              currentPeriod.year + 1,
            ].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Periods Synced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {data?.summary.totalPeriods ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.entities.length ?? 0} entities × 12 months
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Balanced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums text-green-600">
              {data?.summary.balanced ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Debits = Credits
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unbalanced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold tabular-nums ${
                (data?.summary.unbalanced ?? 0) > 0
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {data?.summary.unbalanced ?? 0}
            </div>
            {(data?.summary.unbalanced ?? 0) > 0 && (
              <p className="text-xs text-red-600 mt-1">
                Requires investigation
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Entity × Month Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Variance Detail by Entity & Month</CardTitle>
          <CardDescription>
            Each cell shows the debit–credit difference. Green = balanced, Red =
            unbalanced, Gray = no data synced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading variance data...</p>
          ) : !data || data.entities.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No entities found. Sync trial balances first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <TooltipProvider delayDuration={200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">
                        Entity
                      </TableHead>
                      {MONTH_NAMES_SHORT.map((m, i) => (
                        <TableHead
                          key={i}
                          className="text-center min-w-[90px]"
                        >
                          {m}
                        </TableHead>
                      ))}
                      <TableHead className="text-center min-w-[100px]">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.entities.map((entity) => {
                      const entityVariances = varianceMap.get(entity.id);
                      const unbalancedCount =
                        unbalancedByEntity.get(entity.id) ?? 0;

                      return (
                        <TableRow key={entity.id}>
                          <TableCell className="sticky left-0 bg-background z-10 font-medium">
                            <Link
                              href={`/${entity.id}/trial-balance`}
                              className="hover:underline flex items-center gap-2"
                            >
                              <Badge variant="outline" className="text-xs">
                                {entity.code}
                              </Badge>
                              <span className="truncate max-w-[120px]">
                                {entity.name}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            </Link>
                          </TableCell>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (month) => {
                              const record = entityVariances?.get(month);

                              if (!record) {
                                return (
                                  <TableCell
                                    key={month}
                                    className="text-center"
                                  >
                                    <Minus className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                  </TableCell>
                                );
                              }

                              return (
                                <TableCell
                                  key={month}
                                  className="text-center p-1"
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Link
                                        href={`/${entity.id}/trial-balance?year=${year}&month=${month}`}
                                        className={`inline-flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                                          record.isBalanced
                                            ? "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400"
                                            : "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400"
                                        }`}
                                      >
                                        {record.isBalanced ? (
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                        ) : (
                                          formatCurrency(record.variance)
                                        )}
                                      </Link>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                      <div className="space-y-1 text-xs">
                                        <p className="font-medium">
                                          {entity.name} — {MONTH_NAMES_SHORT[month - 1]} {year}
                                        </p>
                                        <p>
                                          Debits: {formatCurrency(record.totalDebits)}
                                        </p>
                                        <p>
                                          Credits: {formatCurrency(record.totalCredits)}
                                        </p>
                                        <p
                                          className={
                                            record.isBalanced
                                              ? "text-green-600"
                                              : "text-red-600 font-medium"
                                          }
                                        >
                                          Variance: {formatCurrency(record.variance)}
                                        </p>
                                        <p className="text-muted-foreground">
                                          {record.accountCount} accounts
                                        </p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                              );
                            }
                          )}
                          <TableCell className="text-center">
                            {unbalancedCount > 0 ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {unbalancedCount}
                              </Badge>
                            ) : entityVariances && entityVariances.size > 0 ? (
                              <Badge
                                variant="outline"
                                className="gap-1 text-green-600 border-green-200"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                OK
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                No data
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unbalanced Detail List */}
      {data && data.summary.unbalanced > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Unbalanced Periods
            </CardTitle>
            <CardDescription>
              These periods have a non-zero difference between total debits and
              total credits. This may indicate missing account mappings,
              unmatched accounts, or sync issues.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Total Debits</TableHead>
                  <TableHead className="text-right">Total Credits</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.variances
                  .filter((v) => !v.isBalanced)
                  .map((v) => (
                    <TableRow key={`${v.entityId}-${v.periodMonth}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {v.entityCode}
                          </Badge>
                          {v.entityName}
                        </div>
                      </TableCell>
                      <TableCell>
                        {MONTH_NAMES_SHORT[v.periodMonth - 1]} {v.periodYear}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(v.totalDebits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(v.totalCredits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-red-600">
                        {formatCurrency(v.variance)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.accountCount}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/${v.entityId}/trial-balance?year=${v.periodYear}&month=${v.periodMonth}`}
                          className="text-primary hover:underline text-sm flex items-center gap-1"
                        >
                          View
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
