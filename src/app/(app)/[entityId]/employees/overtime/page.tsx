"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Clock,
  DollarSign,
  Users,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";

// --- Types ---

interface MonthlyOT {
  otHours: number;
  otDollars: number;
  regHours: number;
  regDollars: number;
  totalHours: number;
}

interface OTEmployee {
  id: string;
  displayName: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  payType: string;
  monthlyOT: Record<string, MonthlyOT>;
  totalOTHours: number;
  totalOTDollars: number;
  totalRegHours: number;
}

// --- Helpers ---

function formatHours(h: number): string {
  return h.toFixed(1);
}

function otPercent(otHours: number, totalHours: number): string {
  if (totalHours <= 0) return "0%";
  return `${((otHours / totalHours) * 100).toFixed(1)}%`;
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Aggregated types for the hierarchy
interface DeptAgg {
  department: string;
  otHours: number;
  otDollars: number;
  regHours: number;
  totalHours: number;
  employees: {
    id: string;
    displayName: string;
    payType: string;
    otHours: number;
    otDollars: number;
    regHours: number;
    totalHours: number;
  }[];
}

interface MonthAgg {
  month: string;
  otHours: number;
  otDollars: number;
  regHours: number;
  totalHours: number;
  departments: DeptAgg[];
}

// --- Page ---

export default function OvertimeAnalysisPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const current = getCurrentPeriod();

  const [year, setYear] = useState(current.year);
  const [allEmployees, setAllEmployees] = useState<OTEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collapsible state
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  // --- Fetch Data ---
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/paylocity/ot-analysis?year=${year}`);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const data = await res.json();
        setAllEmployees(data.employees ?? []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load OT data"
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [year]);

  // Filter to this entity
  const entityEmployees = useMemo(
    () => allEmployees.filter((e) => e.operatingEntityId === entityId),
    [allEmployees, entityId]
  );

  // Entity-level KPIs
  const totalOTHours = entityEmployees.reduce(
    (s, e) => s + e.totalOTHours,
    0
  );
  const totalOTDollars = entityEmployees.reduce(
    (s, e) => s + e.totalOTDollars,
    0
  );
  const totalRegHours = entityEmployees.reduce(
    (s, e) => s + e.totalRegHours,
    0
  );
  const totalHours = totalOTHours + totalRegHours;
  const employeesWithOT = entityEmployees.filter(
    (e) => e.totalOTHours > 0
  ).length;

  // Build month → department → employee hierarchy
  const monthlyData: MonthAgg[] = useMemo(() => {
    // Collect all months
    const monthSet = new Set<string>();
    for (const emp of entityEmployees) {
      for (const m of Object.keys(emp.monthlyOT)) {
        monthSet.add(m);
      }
    }

    const months = [...monthSet].sort().reverse(); // newest first

    return months.map((month) => {
      // Aggregate by department for this month
      const deptMap: Record<string, DeptAgg> = {};

      for (const emp of entityEmployees) {
        const mData = emp.monthlyOT[month];
        if (!mData) continue;

        const dept = emp.department || "Unassigned";
        if (!deptMap[dept]) {
          deptMap[dept] = {
            department: dept,
            otHours: 0,
            otDollars: 0,
            regHours: 0,
            totalHours: 0,
            employees: [],
          };
        }
        deptMap[dept].otHours += mData.otHours;
        deptMap[dept].otDollars += mData.otDollars;
        deptMap[dept].regHours += mData.regHours;
        deptMap[dept].totalHours += mData.totalHours;
        deptMap[dept].employees.push({
          id: emp.id,
          displayName: emp.displayName,
          payType: emp.payType,
          otHours: mData.otHours,
          otDollars: mData.otDollars,
          regHours: mData.regHours,
          totalHours: mData.totalHours,
        });
      }

      // Sort departments by OT hours desc, employees within each dept by OT hours desc
      const departments = Object.values(deptMap)
        .sort((a, b) => b.otHours - a.otHours)
        .map((d) => ({
          ...d,
          employees: d.employees.sort((a, b) => b.otHours - a.otHours),
        }));

      const monthOT = departments.reduce((s, d) => s + d.otHours, 0);
      const monthOTD = departments.reduce((s, d) => s + d.otDollars, 0);
      const monthReg = departments.reduce((s, d) => s + d.regHours, 0);
      const monthTotal = departments.reduce((s, d) => s + d.totalHours, 0);

      return {
        month,
        otHours: monthOT,
        otDollars: monthOTD,
        regHours: monthReg,
        totalHours: monthTotal,
        departments,
      };
    });
  }, [entityEmployees]);

  // Toggle handlers
  function toggleMonth(month: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function toggleDept(key: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/${entityId}/employees`}>
              <Button variant="ghost" size="sm" className="gap-1 -ml-2">
                <ArrowLeft className="h-4 w-4" />
                Employees
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Overtime Analysis
          </h1>
          <p className="text-muted-foreground">
            OT hours broken down by month, department, and employee
          </p>
        </div>
      </div>

      {/* Year Selector */}
      <div className="flex items-center gap-4">
        <Select
          value={String(year)}
          onValueChange={(v) => setYear(Number(v))}
        >
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
        <span className="text-sm text-muted-foreground">
          Showing overtime data for {year}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Loading overtime data from Paylocity...
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Fetching pay statements for all employees
            </p>
          </div>
        </div>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Total OT Hours
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatHours(totalOTHours)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  YTD {year}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Total OT Cost</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(totalOTDollars)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  YTD {year}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Employees w/ OT
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {employeesWithOT}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / {entityEmployees.length}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">OT % of Hours</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {otPercent(totalOTHours, totalHours)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatHours(totalOTHours)} of{" "}
                  {formatHours(totalHours)} total hours
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly OT Breakdown</CardTitle>
              <CardDescription>
                Click a month to expand by department, then click a department to
                see individual employees. Sorted by OT hours (largest first).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Data</h3>
                  <p className="text-muted-foreground text-center">
                    No pay statement data found for {year}.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">
                          Month / Department / Employee
                        </TableHead>
                        <TableHead className="text-right">OT Hours</TableHead>
                        <TableHead className="text-right">OT Cost</TableHead>
                        <TableHead className="text-right">Reg Hours</TableHead>
                        <TableHead className="text-right">
                          Total Hours
                        </TableHead>
                        <TableHead className="text-right">OT %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyData.map((m) => {
                        const monthExpanded = expandedMonths.has(m.month);
                        return (
                          <>
                            {/* Month Row */}
                            <TableRow
                              key={m.month}
                              className="cursor-pointer hover:bg-muted/50 font-semibold bg-muted/30"
                              onClick={() => toggleMonth(m.month)}
                            >
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {monthExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                  )}
                                  <span>{monthLabel(m.month)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatHours(m.otHours)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(m.otDollars)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatHours(m.regHours)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatHours(m.totalHours)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {otPercent(m.otHours, m.totalHours)}
                              </TableCell>
                            </TableRow>

                            {/* Department Rows (expanded) */}
                            {monthExpanded &&
                              m.departments.map((dept) => {
                                const deptKey = `${m.month}::${dept.department}`;
                                const deptExpanded =
                                  expandedDepts.has(deptKey);
                                return (
                                  <>
                                    <TableRow
                                      key={deptKey}
                                      className="cursor-pointer hover:bg-muted/30"
                                      onClick={() => toggleDept(deptKey)}
                                    >
                                      <TableCell>
                                        <div className="flex items-center gap-2 pl-6">
                                          {deptExpanded ? (
                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                          ) : (
                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                          )}
                                          <span className="font-medium">
                                            {dept.department}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            ({dept.employees.length} emp)
                                          </span>
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium">
                                        {formatHours(dept.otHours)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium">
                                        {formatCurrency(dept.otDollars)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-muted-foreground">
                                        {formatHours(dept.regHours)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-muted-foreground">
                                        {formatHours(dept.totalHours)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {otPercent(
                                          dept.otHours,
                                          dept.totalHours
                                        )}
                                      </TableCell>
                                    </TableRow>

                                    {/* Employee Rows (expanded) */}
                                    {deptExpanded &&
                                      dept.employees.map((emp) => (
                                        <TableRow
                                          key={`${deptKey}::${emp.id}`}
                                          className="text-sm"
                                        >
                                          <TableCell>
                                            <div className="flex items-center gap-2 pl-14">
                                              <span className="text-muted-foreground">
                                                {emp.displayName}
                                              </span>
                                              <span className="text-xs text-muted-foreground/60">
                                                {emp.payType}
                                              </span>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {formatHours(emp.otHours)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {formatCurrency(emp.otDollars)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-muted-foreground">
                                            {formatHours(emp.regHours)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-muted-foreground">
                                            {formatHours(emp.totalHours)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {otPercent(
                                              emp.otHours,
                                              emp.totalHours
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                  </>
                                );
                              })}
                          </>
                        );
                      })}

                      {/* Grand Total Row */}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>YTD Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(totalOTHours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalOTDollars)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatHours(totalRegHours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatHours(totalHours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {otPercent(totalOTHours, totalHours)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
