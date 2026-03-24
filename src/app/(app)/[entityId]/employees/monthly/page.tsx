"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Search,
  Loader2,
  DollarSign,
  Users,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { PaycheckDetailSheet } from "./paycheck-detail-sheet";

// --- Constants ---

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const OPERATING_ENTITIES = [
  { id: "b664a9c1-3817-4df4-9261-f51b3403a5de", code: "AVON", name: "Silverco Enterprises" },
  { id: "b56dec66-edea-4d8d-8cb4-4043af3e41de", code: "ARH", name: "Avon Rental Holdings" },
  { id: "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081", code: "VS", name: "Versatile Studios" },
  { id: "7529580d-3b44-4a9b-91f4-bc2db25f5211", code: "HDR", name: "Hollywood Depot Rentals" },
  { id: "f641caa2-c87e-4a71-a98b-d51cc559f3ff", code: "HSS", name: "Hollywood Site Services" },
];

// --- Types ---

interface MonthlyCostRow {
  employee_id: string;
  paylocity_company_id: string;
  employee_name: string;
  job_title: string;
  pay_type: string;
  annual_comp: number;
  year: number;
  month: number;
  gross_pay: number;
  er_taxes: number;
  er_benefits: number;
  total_cost: number;
  hours_worked: number;
  regular_hours: number;
  overtime_hours: number;
  check_count: number;
  is_accrual: boolean;
  effective_entity_id: string;
  effective_department: string;
}

/** Pivoted: one object per employee, with monthly arrays */
interface EmployeeMonthly {
  employeeId: string;
  companyId: string;
  name: string;
  jobTitle: string;
  payType: string;
  department: string;
  annualComp: number;
  months: (MonthlyCostRow | null)[]; // index 0 = Jan, 11 = Dec
}

// --- Helpers ---

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

function getCellAmount(
  row: MonthlyCostRow | null,
  costView: "total" | "wages" | "taxes" | "benefits",
  includeErCosts: boolean
): number {
  if (!row) return 0;
  switch (costView) {
    case "wages": return row.gross_pay;
    case "taxes": return row.er_taxes;
    case "benefits": return row.er_benefits;
    case "total":
    default:
      return includeErCosts
        ? row.total_cost
        : row.gross_pay;
  }
}

// --- Page ---

export default function MonthlyEmployeeCostPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [rows, setRows] = useState<MonthlyCostRow[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [costView, setCostView] = useState<"total" | "wages" | "taxes" | "benefits">("total");
  const [includeErCosts, setIncludeErCosts] = useState(true);
  const [detailTarget, setDetailTarget] = useState<{
    employeeId: string;
    companyId: string;
    year: number;
    month: number;
    name: string;
  } | null>(null);

  const currentEntity = OPERATING_ENTITIES.find((e) => e.id === entityId);
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 2 + i);

  // Fetch monthly costs from Supabase
  const fetchData = useCallback(async (year: number) => {
    try {
      const res = await fetch(
        `/api/paylocity/monthly-costs?year=${year}&entityId=${entityId}`
      );
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setLastSynced(data.lastSynced ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [entityId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchData(selectedYear).finally(() => setLoading(false));
  }, [selectedYear, fetchData]);

  // Sync from Paylocity
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
      // Reload data
      await fetchData(selectedYear);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Pivot rows into per-employee structure
  const employeeMonthly: EmployeeMonthly[] = useMemo(() => {
    const map: Record<string, EmployeeMonthly> = {};

    for (const row of rows) {
      const key = `${row.employee_id}:${row.paylocity_company_id}`;
      if (!map[key]) {
        map[key] = {
          employeeId: row.employee_id,
          companyId: row.paylocity_company_id,
          name: row.employee_name,
          jobTitle: row.job_title ?? "",
          payType: row.pay_type ?? "Unknown",
          department: row.effective_department ?? "",
          annualComp: row.annual_comp ?? 0,
          months: Array(12).fill(null),
        };
      }
      // Update name/title from most recent row
      if (row.employee_name) map[key].name = row.employee_name;
      if (row.job_title) map[key].jobTitle = row.job_title;
      if (row.effective_department) map[key].department = row.effective_department;

      map[key].months[row.month - 1] = row;
    }

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Departments for filter
  const uniqueDepts = useMemo(
    () => [...new Set(employeeMonthly.map((e) => e.department))].filter(Boolean).sort(),
    [employeeMonthly]
  );

  // Filtered employees
  const filtered = useMemo(() => {
    return employeeMonthly.filter((emp) => {
      if (deptFilter !== "all" && emp.department !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.jobTitle.toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employeeMonthly, deptFilter, search]);

  // Monthly column totals
  const monthlyTotals = useMemo(() => {
    return MONTHS.map((_, mi) =>
      filtered.reduce((sum, emp) => sum + getCellAmount(emp.months[mi], costView, includeErCosts), 0)
    );
  }, [filtered, costView, includeErCosts]);

  const grandTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const avgMonthly = monthlyTotals.filter((v) => v > 0).length > 0
    ? grandTotal / monthlyTotals.filter((v) => v > 0).length
    : 0;

  // Check if data is empty (never synced)
  const hasData = rows.length > 0;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href={`/${entityId}/employees`}>
                <Button variant="ghost" size="sm" className="gap-1 -ml-2">
                  <ArrowLeft className="h-4 w-4" />
                  Roster
                </Button>
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Monthly Employee Cost</h1>
            <p className="text-muted-foreground">
              Actual paycheck and accrued costs for {currentEntity?.name ?? "this entity"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[120px]">
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {syncing ? "Syncing..." : "Sync from Paylocity"}
              </Button>
            </div>
          </div>
        </div>

        {/* Sync status */}
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

        {/* Empty state — prompt to sync */}
        {!hasData && !error && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <DollarSign className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-lg font-medium">No payroll data for {selectedYear}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click &quot;Sync from Paylocity&quot; to pull actual paycheck data and generate accruals.
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
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Headcount</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{filtered.length}</div>
                  <p className="text-xs text-muted-foreground">
                    {employeeMonthly.length} total allocated
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Monthly Cost</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCompact(avgMonthly)}</div>
                  <p className="text-xs text-muted-foreground">
                    {costView === "total"
                      ? includeErCosts ? "Wages + ER taxes + benefits" : "Wages only (ER costs excluded)"
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
                  <div className="text-2xl font-bold">{formatCompact(grandTotal)}</div>
                  <p className="text-xs text-muted-foreground">
                    {monthlyTotals.filter((v) => v > 0).length} months of data
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monthly Breakdown</CardTitle>
                <CardDescription>
                  Per-employee cost by month — {selectedYear}.
                  {" "}
                  <span className="inline-flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">Accrued</Badge>
                    = estimated (no paycheck yet)
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, title, department..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={deptFilter} onValueChange={setDeptFilter}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {uniqueDepts.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                        id="include-er"
                        checked={includeErCosts}
                        onCheckedChange={setIncludeErCosts}
                      />
                      <Label htmlFor="include-er" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                        Incl. ER taxes &amp; benefits
                      </Label>
                    </div>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {filtered.length} employee{filtered.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Monthly Cost Table */}
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">
                          Employee
                        </TableHead>
                        <TableHead className="min-w-[100px]">Department</TableHead>
                        <TableHead className="min-w-[70px]">Type</TableHead>
                        {MONTHS.map((m) => (
                          <TableHead key={m} className="text-right min-w-[90px]">
                            {m}
                          </TableHead>
                        ))}
                        <TableHead className="text-right min-w-[100px] font-semibold">
                          YTD
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((emp) => {
                        const ytd = emp.months.reduce(
                          (sum, m) => sum + getCellAmount(m, costView, includeErCosts),
                          0
                        );

                        return (
                          <TableRow key={`${emp.companyId}-${emp.employeeId}`}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium whitespace-nowrap">
                              {emp.name}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {emp.department || "---"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={emp.payType === "Salary" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {emp.payType}
                              </Badge>
                            </TableCell>
                            {emp.months.map((m, mi) => {
                              const amount = getCellAmount(m, costView, includeErCosts);
                              const isAccrual = m?.is_accrual ?? false;

                              if (!m) {
                                return (
                                  <TableCell
                                    key={MONTHS[mi]}
                                    className="text-right font-mono text-sm text-muted-foreground"
                                  >
                                    ---
                                  </TableCell>
                                );
                              }

                              return (
                                <TableCell
                                  key={MONTHS[mi]}
                                  className={`text-right font-mono text-sm ${
                                    isAccrual ? "text-muted-foreground italic" : ""
                                  }`}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() =>
                                          setDetailTarget({
                                            employeeId: emp.employeeId,
                                            companyId: emp.companyId,
                                            year: selectedYear,
                                            month: mi + 1,
                                            name: emp.name,
                                          })
                                        }
                                        className={`hover:underline cursor-pointer ${
                                          isAccrual ? "border-b border-dashed border-muted-foreground" : ""
                                        }`}
                                      >
                                        {formatCurrency(amount)}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                                      <div className="space-y-0.5">
                                        {isAccrual ? (
                                          <div>Accrued estimate — click for detail</div>
                                        ) : (
                                          <>
                                            <div>Gross: {formatCurrency(m.gross_pay)}</div>
                                            <div>ER Taxes: {formatCurrency(m.er_taxes)}</div>
                                            <div>ER Benefits: {formatCurrency(m.er_benefits)}</div>
                                            {m.hours_worked > 0 && (
                                              <div>{m.hours_worked}h ({m.regular_hours}reg + {m.overtime_hours}OT)</div>
                                            )}
                                            <div>{m.check_count} paycheck{m.check_count !== 1 ? "s" : ""}</div>
                                            <div className="text-muted-foreground pt-0.5">Click for detail</div>
                                          </>
                                        )}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right font-mono font-semibold">
                              {formatCurrency(ytd)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filtered.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3 + MONTHS.length + 1}
                            className="text-center text-muted-foreground py-8"
                          >
                            No employees match the current filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {/* Totals Row */}
                      {filtered.length > 0 && (
                        <TableRow className="font-semibold border-t-2 bg-muted/50">
                          <TableCell className="sticky left-0 bg-muted/50 z-10">
                            Total ({filtered.length} employees)
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          {monthlyTotals.map((total, i) => (
                            <TableCell key={MONTHS[i]} className="text-right font-mono">
                              {total > 0 ? formatCurrency(total) : "---"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono font-bold">
                            {formatCurrency(grandTotal)}
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
        {/* Paycheck detail sheet */}
        <PaycheckDetailSheet
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      </div>
    </TooltipProvider>
  );
}
