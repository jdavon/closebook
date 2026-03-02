"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeftRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { formatStatementAmount } from "@/components/financial-statements/format-utils";
import { useICEliminations } from "@/components/financial-statements/use-ic-eliminations";
import type { ICEliminationPair, ICEntityColumn } from "@/components/financial-statements/types";

export default function ICEliminationsPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [endYear, setEndYear] = useState(currentPeriod.year);
  const [endMonth, setEndMonth] = useState(currentPeriod.month);

  // Load organization
  const loadOrg = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
    }
  }, [supabase]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const { data, loading, error } = useICEliminations(
    {
      organizationId: organizationId ?? undefined,
      endYear,
      endMonth,
    },
    !!organizationId
  );

  // Build month options
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Build year options (current year ± 2)
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentPeriod.year - 2 + i);

  // Summary stats
  const totalPairs = data?.pairs.length ?? 0;
  const balancedPairs = data?.pairs.filter((p) => Math.abs(p.variance) < 0.01).length ?? 0;
  const mismatchPairs = totalPairs - balancedPairs;
  const totalVariance = data?.pairs.reduce((s, p) => s + p.variance, 0) ?? 0;
  const unmatchedCount =
    (data?.unmatchedDueTo.length ?? 0) + (data?.unmatchedDueFrom.length ?? 0);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" />
          Intercompany Eliminations
        </h1>
        <p className="text-muted-foreground text-sm">
          Balance sheet Due To / Due From reconciliation and elimination grid
        </p>
      </div>

      {/* Period selector */}
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Period</Label>
          <Select
            value={String(endMonth)}
            onValueChange={(v) => setEndMonth(parseInt(v))}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthNames.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Year</Label>
          <Select
            value={String(endYear)}
            onValueChange={(v) => setEndYear(parseInt(v))}
          >
            <SelectTrigger className="h-8 w-[90px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="flex items-center gap-2 ml-4 text-xs text-muted-foreground">
            <span>As of {data.metadata.periodLabel}</span>
          </div>
        )}
      </div>

      {/* Summary badges */}
      {data && totalPairs > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {totalPairs} pair{totalPairs !== 1 ? "s" : ""}
          </Badge>
          {balancedPairs > 0 && (
            <Badge
              variant="outline"
              className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {balancedPairs} balanced
            </Badge>
          )}
          {mismatchPairs > 0 && (
            <Badge
              variant="outline"
              className="text-xs border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              {mismatchPairs} mismatch{mismatchPairs !== 1 ? "es" : ""}
            </Badge>
          )}
          {Math.abs(totalVariance) >= 0.01 && (
            <Badge
              variant="outline"
              className="text-xs border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
            >
              Net variance: {formatStatementAmount(totalVariance, true)}
            </Badge>
          )}
          {unmatchedCount > 0 && (
            <Badge
              variant="outline"
              className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              {unmatchedCount} unmatched
            </Badge>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading intercompany data...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && data && totalPairs === 0 && unmatchedCount === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowLeftRight className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No intercompany accounts found. Master accounts with names
              starting with &quot;Due from&quot; or &quot;Due to&quot; will
              appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Elimination grid */}
      {!loading && !error && data && (totalPairs > 0 || unmatchedCount > 0) && (
        <EliminationGrid
          pairs={data.pairs}
          entities={data.entities}
          unmatchedDueTo={data.unmatchedDueTo}
          unmatchedDueFrom={data.unmatchedDueFrom}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elimination Grid component
// ---------------------------------------------------------------------------

function EliminationGrid({
  pairs,
  entities,
  unmatchedDueTo,
  unmatchedDueFrom,
}: {
  pairs: ICEliminationPair[];
  entities: ICEntityColumn[];
  unmatchedDueTo: Array<{
    id: string;
    accountNumber: string;
    name: string;
    totalByEntity: Record<string, number>;
    total: number;
  }>;
  unmatchedDueFrom: Array<{
    id: string;
    accountNumber: string;
    name: string;
    totalByEntity: Record<string, number>;
    total: number;
  }>;
}) {
  // Only show entity columns that have at least one non-zero balance
  const activeEntityIds = new Set<string>();
  for (const pair of pairs) {
    for (const [eid, val] of Object.entries(pair.dueFromByEntity)) {
      if (Math.abs(val) >= 0.01) activeEntityIds.add(eid);
    }
    for (const [eid, val] of Object.entries(pair.dueToByEntity)) {
      if (Math.abs(val) >= 0.01) activeEntityIds.add(eid);
    }
  }
  for (const u of [...unmatchedDueTo, ...unmatchedDueFrom]) {
    for (const [eid, val] of Object.entries(u.totalByEntity)) {
      if (Math.abs(val) >= 0.01) activeEntityIds.add(eid);
    }
  }

  const visibleEntities = entities.filter((e) => activeEntityIds.has(e.id));
  const entityCount = visibleEntities.length;
  const minWidth = 280 + entityCount * 120 + 120; // label + entities + total

  // Grand totals
  const grandDueFrom = pairs.reduce((s, p) => s + p.dueFromTotal, 0);
  const grandDueTo = pairs.reduce((s, p) => s + p.dueToTotal, 0);
  const grandVariance = pairs.reduce((s, p) => s + p.variance, 0);

  return (
    <TooltipProvider>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-xs"
              style={{ minWidth: `${minWidth}px` }}
            >
              <colgroup>
                <col style={{ width: "280px", minWidth: "280px" }} />
                {visibleEntities.map((e) => (
                  <col
                    key={e.id}
                    style={{ width: "120px", minWidth: "120px" }}
                  />
                ))}
                <col style={{ width: "120px", minWidth: "120px" }} />
              </colgroup>

              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Account
                  </th>
                  {visibleEntities.map((e) => (
                    <th
                      key={e.id}
                      className="text-right px-3 py-2 font-medium text-muted-foreground"
                    >
                      <Tooltip>
                        <TooltipTrigger>{e.code}</TooltipTrigger>
                        <TooltipContent>{e.name}</TooltipContent>
                      </Tooltip>
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground border-l-2 border-border">
                    Total
                  </th>
                </tr>
              </thead>

              {pairs.map((pair, pairIdx) => (
                <PairSection
                  key={pair.dueFromAccount.id}
                  pair={pair}
                  visibleEntities={visibleEntities}
                  isLast={
                    pairIdx === pairs.length - 1 &&
                    unmatchedDueTo.length === 0 &&
                    unmatchedDueFrom.length === 0
                  }
                />
              ))}

              {/* Unmatched Due From (no matching Due To) */}
              {unmatchedDueFrom.length > 0 && (
                <tbody>
                  <tr className="bg-amber-50/50 dark:bg-amber-950/20">
                    <td
                      colSpan={visibleEntities.length + 2}
                      className="px-3 py-2 font-semibold text-amber-700 dark:text-amber-400 border-t-2 border-amber-200 dark:border-amber-800"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                      Unmatched Due From (no matching Due To)
                    </td>
                  </tr>
                  {unmatchedDueFrom.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-1.5 pl-6">
                        {u.name}{" "}
                        <span className="text-muted-foreground">
                          ({u.accountNumber})
                        </span>
                      </td>
                      {visibleEntities.map((e) => (
                        <td key={e.id} className="text-right px-3 py-1.5">
                          {formatStatementAmount(u.totalByEntity[e.id] ?? 0)}
                        </td>
                      ))}
                      <td className="text-right px-3 py-1.5 font-medium border-l-2 border-border">
                        {formatStatementAmount(u.total, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}

              {/* Unmatched Due To (no matching Due From) */}
              {unmatchedDueTo.length > 0 && (
                <tbody>
                  <tr className="bg-amber-50/50 dark:bg-amber-950/20">
                    <td
                      colSpan={visibleEntities.length + 2}
                      className="px-3 py-2 font-semibold text-amber-700 dark:text-amber-400 border-t-2 border-amber-200 dark:border-amber-800"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                      Unmatched Due To (no matching Due From)
                    </td>
                  </tr>
                  {unmatchedDueTo.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-1.5 pl-6">
                        {u.name}{" "}
                        <span className="text-muted-foreground">
                          ({u.accountNumber})
                        </span>
                      </td>
                      {visibleEntities.map((e) => (
                        <td key={e.id} className="text-right px-3 py-1.5">
                          {formatStatementAmount(u.totalByEntity[e.id] ?? 0)}
                        </td>
                      ))}
                      <td className="text-right px-3 py-1.5 font-medium border-l-2 border-border">
                        {formatStatementAmount(u.total, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}

              {/* Grand total */}
              {pairs.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-3 py-2">GRAND TOTAL</td>
                    {visibleEntities.map((e) => {
                      const entityDueFrom = pairs.reduce(
                        (s, p) => s + (p.dueFromByEntity[e.id] ?? 0),
                        0
                      );
                      const entityDueTo = pairs.reduce(
                        (s, p) => s + (p.dueToByEntity[e.id] ?? 0),
                        0
                      );
                      const entityNet = entityDueFrom - entityDueTo;
                      return (
                        <td key={e.id} className="text-right px-3 py-2">
                          <span
                            className={
                              Math.abs(entityNet) >= 0.01
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }
                          >
                            {formatStatementAmount(entityNet)}
                          </span>
                        </td>
                      );
                    })}
                    <td
                      className={`text-right px-3 py-2 border-l-2 border-border ${
                        Math.abs(grandVariance) >= 0.01
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-600 dark:text-green-400"
                      }`}
                    >
                      {formatStatementAmount(grandVariance, true)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Pair Section (3 rows per counterparty: Due From, Due To, Variance)
// ---------------------------------------------------------------------------

function PairSection({
  pair,
  visibleEntities,
  isLast,
}: {
  pair: ICEliminationPair;
  visibleEntities: ICEntityColumn[];
  isLast: boolean;
}) {
  const isBalanced = Math.abs(pair.variance) < 0.01;
  const hasDueTo = pair.dueToAccount !== null;

  return (
    <tbody>
      {/* Counterparty header */}
      <tr className="bg-muted/40 border-t-2 border-border">
        <td
          colSpan={visibleEntities.length + 2}
          className="px-3 py-2 font-semibold"
        >
          <span className="flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
            {pair.counterpartyName}
            {isBalanced ? (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
              >
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                Balanced
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
              >
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                Variance: {formatStatementAmount(pair.variance, true)}
              </Badge>
            )}
            {!hasDueTo && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              >
                No matching Due To
              </Badge>
            )}
          </span>
        </td>
      </tr>

      {/* Due From row */}
      <tr className="border-b hover:bg-muted/20">
        <td className="px-3 py-1.5 pl-6">
          <span className="text-blue-700 dark:text-blue-400 font-medium">
            Due From
          </span>{" "}
          <span className="text-muted-foreground">
            ({pair.dueFromAccount.accountNumber})
          </span>
        </td>
        {visibleEntities.map((e) => (
          <td key={e.id} className="text-right px-3 py-1.5 tabular-nums">
            {formatStatementAmount(pair.dueFromByEntity[e.id] ?? 0)}
          </td>
        ))}
        <td className="text-right px-3 py-1.5 tabular-nums font-medium border-l-2 border-border">
          {formatStatementAmount(pair.dueFromTotal, true)}
        </td>
      </tr>

      {/* Due To row */}
      <tr className="border-b hover:bg-muted/20">
        <td className="px-3 py-1.5 pl-6">
          <span className="text-orange-700 dark:text-orange-400 font-medium">
            Due To
          </span>{" "}
          {hasDueTo ? (
            <span className="text-muted-foreground">
              ({pair.dueToAccount!.accountNumber})
            </span>
          ) : (
            <span className="text-amber-500 italic">— none —</span>
          )}
        </td>
        {visibleEntities.map((e) => (
          <td key={e.id} className="text-right px-3 py-1.5 tabular-nums">
            {hasDueTo
              ? formatStatementAmount(
                  -(pair.dueToByEntity[e.id] ?? 0)
                )
              : "\u2014"}
          </td>
        ))}
        <td className="text-right px-3 py-1.5 tabular-nums font-medium border-l-2 border-border">
          {hasDueTo
            ? formatStatementAmount(-pair.dueToTotal, true)
            : "\u2014"}
        </td>
      </tr>

      {/* Net Variance row */}
      <tr
        className={`${isLast ? "" : "border-b"} ${
          isBalanced
            ? "bg-green-50/30 dark:bg-green-950/10"
            : "bg-red-50/30 dark:bg-red-950/10"
        }`}
      >
        <td className="px-3 py-1.5 pl-6 font-semibold text-xs">
          Net Elimination
        </td>
        {visibleEntities.map((e) => {
          const entityVariance =
            (pair.dueFromByEntity[e.id] ?? 0) -
            (pair.dueToByEntity[e.id] ?? 0);
          return (
            <td
              key={e.id}
              className={`text-right px-3 py-1.5 tabular-nums font-medium ${
                Math.abs(entityVariance) >= 0.01
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {formatStatementAmount(entityVariance)}
            </td>
          );
        })}
        <td
          className={`text-right px-3 py-1.5 tabular-nums font-bold border-l-2 border-border ${
            isBalanced
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {formatStatementAmount(pair.variance, true)}
        </td>
      </tr>
    </tbody>
  );
}
