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

interface MonthlyHours {
  otHours: number;
  otDollars: number;
  dtHours: number;
  dtDollars: number;
  mealHours: number;
  mealDollars: number;
  regHours: number;
  regDollars: number;
}

interface OTEmployee {
  id: string;
  displayName: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  payType: string;
  monthlyHours: Record<string, MonthlyHours>;
  totals: {
    otHours: number;
    otDollars: number;
    dtHours: number;
    dtDollars: number;
    mealHours: number;
    mealDollars: number;
    regHours: number;
    regDollars: number;
    premiumHours: number;
    premiumDollars: number;
  };
}

// --- Helpers ---

function fmtHrs(h: number): string {
  return h.toFixed(1);
}

function pct(num: number, den: number): string {
  if (den <= 0) return "0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Summing helpers for aggregating MonthlyHours across employees
function emptyHours(): MonthlyHours {
  return { otHours: 0, otDollars: 0, dtHours: 0, dtDollars: 0, mealHours: 0, mealDollars: 0, regHours: 0, regDollars: 0 };
}
function addHours(a: MonthlyHours, b: MonthlyHours): MonthlyHours {
  return {
    otHours: a.otHours + b.otHours,
    otDollars: a.otDollars + b.otDollars,
    dtHours: a.dtHours + b.dtHours,
    dtDollars: a.dtDollars + b.dtDollars,
    mealHours: a.mealHours + b.mealHours,
    mealDollars: a.mealDollars + b.mealDollars,
    regHours: a.regHours + b.regHours,
    regDollars: a.regDollars + b.regDollars,
  };
}
function premiumHours(h: MonthlyHours): number {
  return h.otHours + h.dtHours + h.mealHours;
}
function premiumDollars(h: MonthlyHours): number {
  return h.otDollars + h.dtDollars + h.mealDollars;
}
function totalHours(h: MonthlyHours): number {
  return h.regHours + h.otHours + h.dtHours + h.mealHours;
}

// Aggregated types for the hierarchy
interface EmpRow {
  id: string;
  displayName: string;
  payType: string;
  hours: MonthlyHours;
}

interface DeptAgg {
  department: string;
  hours: MonthlyHours;
  employees: EmpRow[];
}

interface MonthAgg {
  month: string;
  hours: MonthlyHours;
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

  // Entity-level totals
  const entityTotals = useMemo(() => {
    const t = {
      otHours: 0, otDollars: 0,
      dtHours: 0, dtDollars: 0,
      mealHours: 0, mealDollars: 0,
      regHours: 0, regDollars: 0,
      premiumHours: 0, premiumDollars: 0,
    };
    for (const e of entityEmployees) {
      t.otHours += e.totals.otHours;
      t.otDollars += e.totals.otDollars;
      t.dtHours += e.totals.dtHours;
      t.dtDollars += e.totals.dtDollars;
      t.mealHours += e.totals.mealHours;
      t.mealDollars += e.totals.mealDollars;
      t.regHours += e.totals.regHours;
      t.regDollars += e.totals.regDollars;
      t.premiumHours += e.totals.premiumHours;
      t.premiumDollars += e.totals.premiumDollars;
    }
    return t;
  }, [entityEmployees]);

  const employeesWithPremium = entityEmployees.filter(
    (e) => e.totals.premiumHours > 0
  ).length;
  const entityTotalHrs = entityTotals.regHours + entityTotals.premiumHours;

  // Build month → department → employee hierarchy
  const monthlyData: MonthAgg[] = useMemo(() => {
    // Collect all months
    const monthSet = new Set<string>();
    for (const emp of entityEmployees) {
      for (const m of Object.keys(emp.monthlyHours)) {
        monthSet.add(m);
      }
    }

    const months = [...monthSet].sort().reverse(); // newest first

    return months.map((month) => {
      const deptMap: Record<string, DeptAgg> = {};

      for (const emp of entityEmployees) {
        const mData = emp.monthlyHours[month];
        if (!mData) continue;

        const dept = emp.department || "Unassigned";
        if (!deptMap[dept]) {
          deptMap[dept] = {
            department: dept,
            hours: emptyHours(),
            employees: [],
          };
        }
        deptMap[dept].hours = addHours(deptMap[dept].hours, mData);
        deptMap[dept].employees.push({
          id: emp.id,
          displayName: emp.displayName,
          payType: emp.payType,
          hours: mData,
        });
      }

      // Sort departments by premium hours desc, employees within each by premium hours desc
      const departments = Object.values(deptMap)
        .sort((a, b) => premiumHours(b.hours) - premiumHours(a.hours))
        .map((d) => ({
          ...d,
          employees: d.employees.sort(
            (a, b) => premiumHours(b.hours) - premiumHours(a.hours)
          ),
        }));

      const monthHours = departments.reduce(
        (s, d) => addHours(s, d.hours),
        emptyHours()
      );

      return { month, hours: monthHours, departments };
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

  // Render a row of hours columns (OT / DT / Meal / Premium Total / Reg / Total / %)
  function HoursCells({
    h,
    bold = false,
    muted = false,
  }: {
    h: MonthlyHours;
    bold?: boolean;
    muted?: boolean;
  }) {
    const cls = `text-right tabular-nums ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`;
    const ph = premiumHours(h);
    const pd = premiumDollars(h);
    const th = totalHours(h);
    return (
      <>
        <TableCell className={cls}>{fmtHrs(h.otHours)}</TableCell>
        <TableCell className={cls}>{fmtHrs(h.dtHours)}</TableCell>
        <TableCell className={cls}>{fmtHrs(h.mealHours)}</TableCell>
        <TableCell className={`${cls} font-semibold`}>
          {formatCurrency(pd)}
        </TableCell>
        <TableCell className={`${cls} text-muted-foreground`}>
          {fmtHrs(h.regHours)}
        </TableCell>
        <TableCell className={cls}>{pct(ph, th)}</TableCell>
      </>
    );
  }

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
            OT, double time, and meal premiums — by month, department, and
            employee
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
          Showing premium pay data for {year}
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
              Fetching pay statement details for all employees
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">OT Hours</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {fmtHrs(entityTotals.otHours)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  1.5x &mdash; {formatCurrency(entityTotals.otDollars)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    DT + Meal Hours
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {fmtHrs(entityTotals.dtHours + entityTotals.mealHours)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  DT: {fmtHrs(entityTotals.dtHours)} hrs ({formatCurrency(entityTotals.dtDollars)})
                  &nbsp;|&nbsp; Meal: {fmtHrs(entityTotals.mealHours)} hrs ({formatCurrency(entityTotals.mealDollars)})
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Total Premium Cost
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(entityTotals.premiumDollars)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtHrs(entityTotals.premiumHours)} premium hours YTD
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Premium % of Hours
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {pct(entityTotals.premiumHours, entityTotalHrs)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {employeesWithPremium} of {entityEmployees.length} employees
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Breakdown</CardTitle>
              <CardDescription>
                Click a month to expand by department, then click a department to
                see individual employees. Sorted by premium hours (largest
                first).
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
                        <TableHead className="w-[280px]">
                          Month / Department / Employee
                        </TableHead>
                        <TableHead className="text-right" title="Overtime hours (1.5x rate)">
                          OT Hrs
                        </TableHead>
                        <TableHead className="text-right" title="Double time hours (2x rate)">
                          DT Hrs
                        </TableHead>
                        <TableHead className="text-right" title="Meal premium hours">
                          Meal Hrs
                        </TableHead>
                        <TableHead className="text-right" title="Total premium pay cost (OT + DT + Meal)">
                          Premium $
                        </TableHead>
                        <TableHead className="text-right" title="Regular hours for comparison">
                          Reg Hrs
                        </TableHead>
                        <TableHead className="text-right" title="Premium hours as % of total hours">
                          Prem %
                        </TableHead>
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
                              <HoursCells h={m.hours} bold />
                            </TableRow>

                            {/* Department Rows */}
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
                                      <HoursCells h={dept.hours} />
                                    </TableRow>

                                    {/* Employee Rows */}
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
                                          <HoursCells h={emp.hours} muted />
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
                        <HoursCells
                          h={{
                            otHours: entityTotals.otHours,
                            otDollars: entityTotals.otDollars,
                            dtHours: entityTotals.dtHours,
                            dtDollars: entityTotals.dtDollars,
                            mealHours: entityTotals.mealHours,
                            mealDollars: entityTotals.mealDollars,
                            regHours: entityTotals.regHours,
                            regDollars: entityTotals.regDollars,
                          }}
                          bold
                        />
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
