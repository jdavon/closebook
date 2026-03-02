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
  ArrowLeftRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { formatStatementAmount } from "@/components/financial-statements/format-utils";
import { useICEliminations } from "@/components/financial-statements/use-ic-eliminations";
import type {
  ICEntityDetail,
  ICEliminationPair,
} from "@/components/financial-statements/types";

export default function ICEliminationsPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [endYear, setEndYear] = useState(currentPeriod.year);
  const [endMonth, setEndMonth] = useState(currentPeriod.month);

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

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentPeriod.year - 2 + i);

  const hasData = data && data.entityDetails.length > 0;
  const totalVariances = data?.eliminationPairs.filter(
    (p) => Math.abs(p.netEffect) >= 0.01
  ).length ?? 0;
  const balancedPairs = data?.eliminationPairs.filter(
    (p) => Math.abs(p.netEffect) < 0.01
  ).length ?? 0;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" />
          Intercompany Eliminations
        </h1>
        <p className="text-muted-foreground text-sm">
          Per-entity Due To / Due From balances and elimination verification
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
          <span className="text-xs text-muted-foreground ml-4">
            As of {data.metadata.periodLabel}
          </span>
        )}
      </div>

      {/* Summary badges */}
      {hasData && data.eliminationPairs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {data.eliminationPairs.length} elimination pair
            {data.eliminationPairs.length !== 1 ? "s" : ""}
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
          {totalVariances > 0 && (
            <Badge
              variant="outline"
              className="text-xs border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              {totalVariances} variance{totalVariances !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {/* Loading */}
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

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && data && !hasData && (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowLeftRight className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No intercompany accounts found. Entity accounts named &quot;Due
              from ...&quot; or &quot;Due to ...&quot; mapped to intercompany
              master accounts will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Per-entity sections */}
      {!loading && !error && hasData && (
        <div className="space-y-3">
          {data.entityDetails.map((ed) => (
            <EntitySection key={ed.entityId} detail={ed} />
          ))}
        </div>
      )}

      {/* Elimination verification */}
      {!loading && !error && hasData && data.eliminationPairs.length > 0 && (
        <EliminationCheck pairs={data.eliminationPairs} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-entity section
// ---------------------------------------------------------------------------

function EntitySection({ detail }: { detail: ICEntityDetail }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasVariance = Math.abs(detail.totalNet) >= 0.01;

  return (
    <Card>
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="flex items-center gap-2 font-semibold text-sm">
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          {detail.entityName}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
            {detail.entityCode}
          </Badge>
        </span>
        <span className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Due From:{" "}
            <span className="text-foreground font-medium">
              {formatStatementAmount(detail.totalDueFrom, true)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Due To:{" "}
            <span className="text-foreground font-medium">
              {formatStatementAmount(detail.totalDueTo, true)}
            </span>
          </span>
          <span
            className={`font-semibold ${
              hasVariance
                ? "text-foreground"
                : "text-muted-foreground"
            }`}
          >
            Net: {formatStatementAmount(detail.totalNet, true)}
          </span>
        </span>
      </button>

      {!collapsed && (
        <CardContent className="pt-0 pb-3 px-0">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-t border-b bg-muted/30">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-[200px]">
                  Counterparty
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground w-[150px]">
                  Due From (Receivable)
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground w-[150px]">
                  Due To (Payable)
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground w-[150px]">
                  Net Position
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.counterparties.map((cp, i) => {
                const net = cp.netPosition;
                const isLast = i === detail.counterparties.length - 1;
                return (
                  <tr
                    key={cp.counterpartyName}
                    className={`${isLast ? "" : "border-b"} hover:bg-muted/20`}
                  >
                    <td className="px-4 py-1.5 font-medium">
                      {cp.counterpartyName}
                      {cp.counterpartyCode && (
                        <span className="text-muted-foreground font-normal ml-1.5">
                          ({cp.counterpartyCode})
                        </span>
                      )}
                    </td>
                    <td className="text-right px-4 py-1.5 tabular-nums">
                      {formatStatementAmount(cp.dueFromBalance)}
                    </td>
                    <td className="text-right px-4 py-1.5 tabular-nums">
                      {formatStatementAmount(-cp.dueToBalance)}
                    </td>
                    <td
                      className={`text-right px-4 py-1.5 tabular-nums font-medium ${
                        Math.abs(net) < 0.01
                          ? "text-muted-foreground"
                          : net > 0
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-orange-600 dark:text-orange-400"
                      }`}
                    >
                      {formatStatementAmount(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {detail.counterparties.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="text-right px-4 py-2 tabular-nums">
                    {formatStatementAmount(detail.totalDueFrom, true)}
                  </td>
                  <td className="text-right px-4 py-2 tabular-nums">
                    {formatStatementAmount(-detail.totalDueTo, true)}
                  </td>
                  <td
                    className={`text-right px-4 py-2 tabular-nums ${
                      Math.abs(detail.totalNet) < 0.01
                        ? "text-muted-foreground"
                        : ""
                    }`}
                  >
                    {formatStatementAmount(detail.totalNet, true)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Elimination cross-check
// ---------------------------------------------------------------------------

function EliminationCheck({ pairs }: { pairs: ICEliminationPair[] }) {
  const variances = pairs.filter((p) => Math.abs(p.netEffect) >= 0.01);
  const allBalanced = variances.length === 0;

  return (
    <Card>
      <div className="px-4 py-3 flex items-center gap-2 border-b">
        <span className="font-semibold text-sm">
          Elimination Verification
        </span>
        {allBalanced ? (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
          >
            <CheckCircle2 className="h-3 w-3 mr-0.5" />
            All balanced
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
          >
            <AlertTriangle className="h-3 w-3 mr-0.5" />
            {variances.length} variance{variances.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <CardContent className="pt-0 pb-3 px-0">
        <p className="px-4 py-2 text-xs text-muted-foreground">
          For each entity pair, the net of all intercompany accounts must
          cancel to zero: (A&apos;s Due From B − A&apos;s Due To B) +
          (B&apos;s Due From A − B&apos;s Due To A) = 0
        </p>

        <div className="space-y-3 px-4">
          {pairs.map((pair, i) => {
            const isBalanced = Math.abs(pair.netEffect) < 0.01;
            return (
              <PairCard key={i} pair={pair} isBalanced={isBalanced} />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-pair elimination card (net-zero check)
// ---------------------------------------------------------------------------

function PairCard({
  pair,
  isBalanced,
}: {
  pair: ICEliminationPair;
  isBalanced: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        !isBalanced
          ? "border-red-300 dark:border-red-700"
          : "border-border"
      }`}
    >
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="flex items-center gap-2 text-xs font-semibold">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {pair.entityACode}
          <span className="text-muted-foreground font-normal">↔</span>
          {pair.entityBCode}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold tabular-nums ${
              isBalanced
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            Net: {formatStatementAmount(pair.netEffect)}
          </span>
          {isBalanced ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          )}
        </span>
      </button>

      {!collapsed && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-t border-b bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                Entity
              </th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-[120px]">
                Due From
              </th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-[120px]">
                Due To
              </th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-[120px]">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Entity A's balances with B */}
            <tr className="border-b hover:bg-muted/20">
              <td className="px-3 py-1.5 font-medium">
                {pair.entityACode}
                <span className="text-muted-foreground font-normal ml-1">
                  → {pair.entityBCode}
                </span>
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatStatementAmount(pair.aDueFromB)}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatStatementAmount(-pair.aDueToB)}
              </td>
              <td
                className={`text-right px-3 py-1.5 tabular-nums font-medium ${
                  pair.aNetWithB > 0
                    ? "text-blue-600 dark:text-blue-400"
                    : pair.aNetWithB < 0
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-muted-foreground"
                }`}
              >
                {formatStatementAmount(pair.aNetWithB)}
              </td>
            </tr>
            {/* Entity B's balances with A */}
            <tr className="border-b hover:bg-muted/20">
              <td className="px-3 py-1.5 font-medium">
                {pair.entityBCode}
                <span className="text-muted-foreground font-normal ml-1">
                  → {pair.entityACode}
                </span>
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatStatementAmount(pair.bDueFromA)}
              </td>
              <td className="text-right px-3 py-1.5 tabular-nums">
                {formatStatementAmount(-pair.bDueToA)}
              </td>
              <td
                className={`text-right px-3 py-1.5 tabular-nums font-medium ${
                  pair.bNetWithA > 0
                    ? "text-blue-600 dark:text-blue-400"
                    : pair.bNetWithA < 0
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-muted-foreground"
                }`}
              >
                {formatStatementAmount(pair.bNetWithA)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              <td className="px-3 py-1.5 font-semibold" colSpan={3}>
                Net Effect (should be $0)
              </td>
              <td
                className={`text-right px-3 py-1.5 tabular-nums font-bold ${
                  Math.abs(pair.netEffect) < 0.01
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatStatementAmount(pair.netEffect)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
