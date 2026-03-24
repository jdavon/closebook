"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Loader2,
  DollarSign,
  Users,
  TrendingUp,
  RefreshCw,
  Building2,
} from "lucide-react";

// --- Constants ---

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const OPERATING_ENTITIES: Record<string, { code: string; name: string }> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": { code: "AVON", name: "Silverco Enterprises" },
  "b56dec66-edea-4d8d-8cb4-4043af3e41de": { code: "ARH", name: "Avon Rental Holdings" },
  "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081": { code: "VS", name: "Versatile Studios" },
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": { code: "HDR", name: "Hollywood Depot Rentals" },
  "f641caa2-c87e-4a71-a98b-d51cc559f3ff": { code: "HSS", name: "Hollywood Site Services" },
};

const ENTITY_ORDER = [
  "b664a9c1-3817-4df4-9261-f51b3403a5de",
  "b56dec66-edea-4d8d-8cb4-4043af3e41de",
  "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081",
  "7529580d-3b44-4a9b-91f4-bc2db25f5211",
  "f641caa2-c87e-4a71-a98b-d51cc559f3ff",
];

// --- Types ---

interface MonthlyCostRow {
  employee_id: string;
  paylocity_company_id: string;
  employee_name: string;
  year: number;
  month: number;
  gross_pay: number;
  er_taxes: number;
  er_benefits: number;
  total_cost: number;
  effective_entity_id: string;
  effective_department: string;
}

interface EntityMonthly {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  months: number[]; // 12 values, one per month
  ytd: number;
}

// --- Helpers ---

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// --- Page ---

export default function OrgMonthlyPayrollPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [rows, setRows] = useState<MonthlyCostRow[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costView, setCostView] = useState<"total" | "wages" | "taxes" | "benefits">("total");
  const [includeErCosts, setIncludeErCosts] = useState(true);

  const years = Array.from({ length: 3 }, (_, i) => currentYear - 2 + i);

  const fetchData = useCallback(async (year: number) => {
    try {
      // No entityId = all entities
      const res = await fetch(`/api/paylocity/monthly-costs?year=${year}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setLastSynced(data.lastSynced ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchData(selectedYear).finally(() => setLoading(false));
  }, [selectedYear, fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/paylocity/monthly-costs?year=${selectedYear}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Sync failed: ${res.status}`);
      }
      await fetchData(selectedYear);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  function getRowAmount(row: MonthlyCostRow): number {
    switch (costView) {
      case "wages": return row.gross_pay;
      case "taxes": return row.er_taxes;
      case "benefits": return row.er_benefits;
      case "total":
      default:
        return includeErCosts ? row.total_cost : row.gross_pay;
    }
  }

  // Group by entity
  const entityMonthly: EntityMonthly[] = useMemo(() => {
    const map: Record<string, { employees: Set<string>; months: number[] }> = {};

    for (const row of rows) {
      const eid = row.effective_entity_id;
      if (!map[eid]) {
        map[eid] = { employees: new Set(), months: Array(12).fill(0) };
      }
      map[eid].employees.add(`${row.employee_id}:${row.paylocity_company_id}`);
      const mi = row.month - 1;
      if (mi >= 0 && mi < 12) {
        map[eid].months[mi] += getRowAmount(row);
      }
    }

    return ENTITY_ORDER
      .filter((eid) => map[eid])
      .map((eid) => {
        const entry = map[eid];
        const entity = OPERATING_ENTITIES[eid];
        return {
          entityId: eid,
          entityCode: entity?.code ?? "???",
          entityName: entity?.name ?? "Unknown",
          headcount: entry.employees.size,
          months: entry.months.map((v) => Math.round(v)),
          ytd: Math.round(entry.months.reduce((s, v) => s + v, 0)),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, costView, includeErCosts]);

  // Org totals per month
  const orgMonthlyTotals = useMemo(() => {
    return MONTHS.map((_, mi) =>
      entityMonthly.reduce((sum, e) => sum + e.months[mi], 0)
    );
  }, [entityMonthly]);

  const orgYtd = orgMonthlyTotals.reduce((s, v) => s + v, 0);
  const totalHeadcount = entityMonthly.reduce((s, e) => s + e.headcount, 0);
  const avgMonthly = orgMonthlyTotals.filter((v) => v > 0).length > 0
    ? orgYtd / orgMonthlyTotals.filter((v) => v > 0).length
    : 0;

  const hasData = rows.length > 0;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/payroll">
              <Button variant="ghost" size="sm" className="gap-1 -ml-2">
                <ArrowLeft className="h-4 w-4" />
                Payroll Overview
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Monthly Cost by Entity</h1>
          <p className="text-muted-foreground">
            Organization-wide monthly payroll costs across all entities
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {syncing ? "Syncing..." : "Sync from Paylocity"}
          </Button>
        </div>
      </div>

      {lastSynced && (
        <p className="text-xs text-muted-foreground -mt-4">
          Last synced: {timeAgo(lastSynced)} ({new Date(lastSynced).toLocaleString()})
        </p>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!hasData && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <DollarSign className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="text-lg font-medium">No payroll data for {selectedYear}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Click &quot;Sync from Paylocity&quot; to pull actual paycheck data.
              </p>
            </div>
            <Button onClick={handleSync} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "Sync Now"}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Entities</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{entityMonthly.length}</div>
                <p className="text-xs text-muted-foreground">{totalHeadcount} total employees</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Monthly</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCompact(avgMonthly)}</div>
                <p className="text-xs text-muted-foreground">
                  {costView === "total"
                    ? includeErCosts ? "Wages + ER taxes + benefits" : "Wages only"
                    : costView}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">YTD Total</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCompact(orgYtd)}</div>
                <p className="text-xs text-muted-foreground">
                  {orgMonthlyTotals.filter((v) => v > 0).length} months of data
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Headcount</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalHeadcount}</div>
                <p className="text-xs text-muted-foreground">Across all entities</p>
              </CardContent>
            </Card>
          </div>

          {/* Entity Monthly Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Cost by Entity</CardTitle>
              <CardDescription>
                Per-entity payroll cost by month — {selectedYear}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Select value={costView} onValueChange={(v) => setCostView(v as typeof costView)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total">Total Cost</SelectItem>
                    <SelectItem value="wages">Wages Only</SelectItem>
                    <SelectItem value="taxes">ER Taxes Only</SelectItem>
                    <SelectItem value="benefits">ER Benefits Only</SelectItem>
                  </SelectContent>
                </Select>
                {costView === "total" && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="include-er-org"
                      checked={includeErCosts}
                      onCheckedChange={setIncludeErCosts}
                    />
                    <Label htmlFor="include-er-org" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                      Incl. ER taxes &amp; benefits
                    </Label>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[200px]">
                        Entity
                      </TableHead>
                      <TableHead className="text-right min-w-[50px]">HC</TableHead>
                      {MONTHS.map((m) => (
                        <TableHead key={m} className="text-right min-w-[90px]">{m}</TableHead>
                      ))}
                      <TableHead className="text-right min-w-[100px] font-semibold">YTD</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entityMonthly.map((entity) => (
                      <TableRow key={entity.entityId}>
                        <TableCell className="sticky left-0 bg-background z-10">
                          <Link
                            href={`/${entity.entityId}/employees/monthly`}
                            className="hover:underline"
                          >
                            <div>
                              <span className="font-medium">{entity.entityName}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {entity.entityCode}
                              </span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {entity.headcount}
                        </TableCell>
                        {entity.months.map((val, mi) => (
                          <TableCell key={MONTHS[mi]} className="text-right font-mono text-sm">
                            {val > 0 ? formatCurrency(val) : "---"}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(entity.ytd)}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Org Total Row */}
                    {entityMonthly.length > 0 && (
                      <TableRow className="font-semibold border-t-2 bg-muted/50">
                        <TableCell className="sticky left-0 bg-muted/50 z-10">
                          Total ({entityMonthly.length} entities)
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {totalHeadcount}
                        </TableCell>
                        {orgMonthlyTotals.map((total, i) => (
                          <TableCell key={MONTHS[i]} className="text-right font-mono">
                            {total > 0 ? formatCurrency(total) : "---"}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-mono font-bold">
                          {formatCurrency(orgYtd)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
