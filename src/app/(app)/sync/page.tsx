"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Minus,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Building2,
} from "lucide-react";
import {
  formatCurrency,
  getCurrentPeriod,
  getPeriodLabel,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import Link from "next/link";
import type { AccountClassification } from "@/lib/types/database";

interface EntityInfo {
  id: string;
  name: string;
  code: string;
}

interface QboConnection {
  entity_id: string;
  company_name: string | null;
  last_sync_at: string | null;
  sync_status: string;
}

interface SyncResult {
  entityId: string;
  entityName: string;
  entityCode: string;
  success: boolean;
  recordsSynced: number;
  error?: string;
}

interface EntityPeriodSummary {
  entityId: string;
  entityName: string;
  entityCode: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  hasData: boolean;
}

interface MonthColumn {
  year: number;
  month: number;
  label: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function SyncManagementPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [connections, setConnections] = useState<QboConnection[]>([]);
  const [syncYear, setSyncYear] = useState(String(currentPeriod.year));
  const [syncMonth, setSyncMonth] = useState(String(currentPeriod.month));
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Month-by-month financials state
  const [financialYear, setFinancialYear] = useState(String(currentPeriod.year));
  const [entitySummaries, setEntitySummaries] = useState<
    Record<string, EntityPeriodSummary[]>
  >({});
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  const loadEntities = useCallback(async () => {
    setLoading(true);

    // Get user's organization
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) return;

    // Get all entities
    const { data: entityData } = await supabase
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name");

    const ents = (entityData ?? []) as EntityInfo[];
    setEntities(ents);

    // Get QBO connections
    if (ents.length > 0) {
      const { data: connData } = await supabase
        .from("qbo_connections")
        .select("entity_id, company_name, last_sync_at, sync_status")
        .in(
          "entity_id",
          ents.map((e) => e.id)
        );

      setConnections((connData as QboConnection[]) ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // Load month-by-month financials
  const loadFinancials = useCallback(async () => {
    if (entities.length === 0) return;

    setLoadingFinancials(true);
    const year = parseInt(financialYear);
    const summariesByMonth: Record<string, EntityPeriodSummary[]> = {};

    // Load all 12 months for all entities
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${month}`;
      const monthSummaries: EntityPeriodSummary[] = [];

      for (const entity of entities) {
        const { data: balances } = await supabase
          .from("gl_balances")
          .select(
            "ending_balance, accounts(classification)"
          )
          .eq("entity_id", entity.id)
          .eq("period_year", year)
          .eq("period_month", month);

        if (!balances || balances.length === 0) {
          monthSummaries.push({
            entityId: entity.id,
            entityName: entity.name,
            entityCode: entity.code,
            totalAssets: 0,
            totalLiabilities: 0,
            totalEquity: 0,
            totalRevenue: 0,
            totalExpenses: 0,
            netIncome: 0,
            hasData: false,
          });
          continue;
        }

        let totalAssets = 0;
        let totalLiabilities = 0;
        let totalEquity = 0;
        let totalRevenue = 0;
        let totalExpenses = 0;

        for (const row of balances) {
          const acct = row.accounts as unknown as {
            classification: AccountClassification;
          } | null;
          const balance = row.ending_balance ?? 0;

          switch (acct?.classification) {
            case "Asset":
              totalAssets += balance;
              break;
            case "Liability":
              totalLiabilities += balance;
              break;
            case "Equity":
              totalEquity += balance;
              break;
            case "Revenue":
              totalRevenue += balance;
              break;
            case "Expense":
              totalExpenses += balance;
              break;
          }
        }

        monthSummaries.push({
          entityId: entity.id,
          entityName: entity.name,
          entityCode: entity.code,
          totalAssets,
          totalLiabilities,
          totalEquity,
          totalRevenue: Math.abs(totalRevenue),
          totalExpenses: Math.abs(totalExpenses),
          netIncome: Math.abs(totalRevenue) - Math.abs(totalExpenses),
          hasData: true,
        });
      }

      summariesByMonth[monthKey] = monthSummaries;
    }

    setEntitySummaries(summariesByMonth);
    setLoadingFinancials(false);
  }, [supabase, entities, financialYear]);

  useEffect(() => {
    if (entities.length > 0) {
      loadFinancials();
    }
  }, [entities, loadFinancials]);

  async function handleSyncAll() {
    setSyncing(true);
    setSyncResults(null);

    try {
      const response = await fetch("/api/qbo/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodYear: parseInt(syncYear),
          periodMonth: parseInt(syncMonth),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSyncResults(data.results ?? []);
        toast.success(
          `Synced ${data.entitiesSynced}/${data.entitiesTotal} entities for ${getPeriodLabel(
            parseInt(syncYear),
            parseInt(syncMonth)
          )} — ${data.totalRecordsSynced} records`
        );
        // Refresh connection data and financials
        loadEntities();
        loadFinancials();
      } else {
        toast.error(data.error || "Batch sync failed");
      }
    } catch {
      toast.error("Batch sync failed — network error");
    }

    setSyncing(false);
  }

  const connByEntity = new Map(
    connections.map((c) => [c.entity_id, c])
  );
  const connectedCount = connections.length;

  // Generate columns for the financial year view
  const monthColumns: MonthColumn[] = Array.from({ length: 12 }, (_, i) => ({
    year: parseInt(financialYear),
    month: i + 1,
    label: getPeriodShortLabel(parseInt(financialYear), i + 1),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          QBO Sync Manager
        </h1>
        <p className="text-muted-foreground">
          Sync QuickBooks trial balances across all entities and view
          month-by-month financials
        </p>
      </div>

      {/* Batch Sync Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Batch Sync — All Entities</CardTitle>
          <CardDescription>
            Pull trial balance data from QuickBooks for all connected entities
            for the selected period. {connectedCount} of {entities.length}{" "}
            entities have active QBO connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select value={syncMonth} onValueChange={setSyncMonth}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={syncYear} onValueChange={setSyncYear}>
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
            <Button
              onClick={handleSyncAll}
              disabled={syncing || connectedCount === 0}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing
                ? "Syncing All..."
                : `Sync All Entities (${connectedCount})`}
            </Button>
          </div>

          {/* Entity Connection Status */}
          {!loading && (
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>QBO Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Synced</TableHead>
                    {syncResults && <TableHead>Sync Result</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => {
                    const conn = connByEntity.get(entity.id);
                    const result = syncResults?.find(
                      (r) => r.entityId === entity.id
                    );

                    return (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/${entity.id}/settings`}
                            className="hover:underline"
                          >
                            {entity.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{entity.code}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {conn?.company_name ?? "---"}
                        </TableCell>
                        <TableCell>
                          {conn ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <Minus className="h-3 w-3" />
                              Not Connected
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {conn?.last_sync_at
                            ? new Date(conn.last_sync_at).toLocaleString()
                            : "---"}
                        </TableCell>
                        {syncResults && (
                          <TableCell>
                            {result ? (
                              result.success ? (
                                <Badge variant="default" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {result.recordsSynced} records
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="gap-1">
                                  <XCircle className="h-3 w-3" />
                                  {result.error ?? "Failed"}
                                </Badge>
                              )
                            ) : (
                              <span className="text-muted-foreground">---</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Month-by-Month Financials */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Month-by-Month Financials</CardTitle>
              <CardDescription>
                Net income for each entity by month — synced from QuickBooks
                trial balances
              </CardDescription>
            </div>
            <Select value={financialYear} onValueChange={setFinancialYear}>
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
        </CardHeader>
        <CardContent>
          {loadingFinancials ? (
            <p className="text-sm text-muted-foreground">
              Loading financial data...
            </p>
          ) : entities.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No entities found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">
                      Entity
                    </TableHead>
                    {monthColumns.map((col) => (
                      <TableHead
                        key={`${col.year}-${col.month}`}
                        className="text-right min-w-[100px]"
                      >
                        {col.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right min-w-[120px] font-semibold">
                      YTD Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => {
                    let ytdTotal = 0;
                    return (
                      <TableRow key={entity.id}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium">
                          <Link
                            href={`/${entity.id}/reports/financial-statements`}
                            className="hover:underline flex items-center gap-2"
                          >
                            <Badge variant="outline" className="text-xs">
                              {entity.code}
                            </Badge>
                            {entity.name}
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          </Link>
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summaries = entitySummaries[key];
                          const summary = summaries?.find(
                            (s) => s.entityId === entity.id
                          );
                          const netIncome = summary?.netIncome ?? 0;
                          const hasData = summary?.hasData ?? false;

                          if (hasData) {
                            ytdTotal += netIncome;
                          }

                          return (
                            <TableCell
                              key={key}
                              className={`text-right tabular-nums ${
                                !hasData
                                  ? "text-muted-foreground"
                                  : netIncome >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {hasData ? formatCurrency(netIncome) : "---"}
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            ytdTotal >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatCurrency(ytdTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Organization totals row */}
                  {entities.length > 1 && (
                    <TableRow className="font-semibold border-t-2">
                      <TableCell className="sticky left-0 bg-background z-10">
                        Organization Total
                      </TableCell>
                      {(() => {
                        let orgYtd = 0;
                        return (
                          <>
                            {monthColumns.map((col) => {
                              const key = `${col.year}-${col.month}`;
                              const summaries = entitySummaries[key];
                              const monthTotal =
                                summaries
                                  ?.filter((s) => s.hasData)
                                  .reduce(
                                    (sum, s) => sum + s.netIncome,
                                    0
                                  ) ?? 0;
                              const hasAnyData =
                                summaries?.some((s) => s.hasData) ?? false;

                              if (hasAnyData) {
                                orgYtd += monthTotal;
                              }

                              return (
                                <TableCell
                                  key={key}
                                  className={`text-right tabular-nums ${
                                    !hasAnyData
                                      ? "text-muted-foreground"
                                      : monthTotal >= 0
                                      ? "text-green-600"
                                      : "text-red-600"
                                  }`}
                                >
                                  {hasAnyData
                                    ? formatCurrency(monthTotal)
                                    : "---"}
                                </TableCell>
                              );
                            })}
                            <TableCell
                              className={`text-right tabular-nums ${
                                orgYtd >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {formatCurrency(orgYtd)}
                            </TableCell>
                          </>
                        );
                      })()}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue & Expense Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue by Entity by Month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Revenue by Entity
            </CardTitle>
            <CardDescription>
              Monthly revenue for {financialYear}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFinancials ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Entity</TableHead>
                      {monthColumns.map((col) => (
                        <TableHead
                          key={`rev-${col.year}-${col.month}`}
                          className="text-right min-w-[90px]"
                        >
                          {MONTH_NAMES[col.month - 1].slice(0, 3)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">
                          {entity.code}
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summary = entitySummaries[key]?.find(
                            (s) => s.entityId === entity.id
                          );
                          return (
                            <TableCell
                              key={key}
                              className="text-right tabular-nums text-sm"
                            >
                              {summary?.hasData
                                ? formatCurrency(summary.totalRevenue)
                                : "---"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses by Entity by Month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Expenses by Entity
            </CardTitle>
            <CardDescription>
              Monthly expenses for {financialYear}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFinancials ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Entity</TableHead>
                      {monthColumns.map((col) => (
                        <TableHead
                          key={`exp-${col.year}-${col.month}`}
                          className="text-right min-w-[90px]"
                        >
                          {MONTH_NAMES[col.month - 1].slice(0, 3)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">
                          {entity.code}
                        </TableCell>
                        {monthColumns.map((col) => {
                          const key = `${col.year}-${col.month}`;
                          const summary = entitySummaries[key]?.find(
                            (s) => s.entityId === entity.id
                          );
                          return (
                            <TableCell
                              key={key}
                              className="text-right tabular-nums text-sm"
                            >
                              {summary?.hasData
                                ? formatCurrency(summary.totalExpenses)
                                : "---"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
