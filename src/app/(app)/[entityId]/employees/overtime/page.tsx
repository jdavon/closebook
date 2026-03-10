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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock,
  DollarSign,
  ChevronRight,
  ChevronDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeft,
  Loader2,
  TrendingUp,
  AlertTriangle,
  CalendarDays,
  TableIcon,
} from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  format,
  addMonths,
  subMonths,
} from "date-fns";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";

// --- Constants ---

/** Employing entity IDs → Paylocity company IDs (mirrors employees page) */
const EMPLOYING_ENTITIES: Record<string, string> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": "132427", // Silverco
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": "316791", // HDR
};

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

type DataStatus = "ok" | "summary_failed" | "details_failed" | "both_failed";

interface OTEmployee {
  id: string;
  companyId: string;
  displayName: string;
  department: string;
  classValue: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  payType: string;
  dataStatus?: DataStatus;
  monthlyHours: Record<string, MonthlyHours>;
  weeklyHours: Record<string, MonthlyHours>;
  dailyHours?: Record<string, MonthlyHours>;
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

interface PayPeriod {
  checkDate: string;
  beginDate: string;
  endDate: string;
}

interface Diagnostics {
  totalEmployees: number;
  dataOk: number;
  summaryFailed: number;
  detailsFailed: number;
  bothFailed: number;
}

interface AllocationOverride {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
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

function weekLabel(key: string): string {
  // "2026-W10" → "Week 10"
  const weekStr = key.split("-W")[1];
  return `Week ${parseInt(weekStr, 10)}`;
}

function emptyHours(): MonthlyHours {
  return {
    otHours: 0, otDollars: 0, dtHours: 0, dtDollars: 0,
    mealHours: 0, mealDollars: 0, regHours: 0, regDollars: 0,
  };
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

function premiumHrs(h: MonthlyHours): number {
  return h.otHours + h.dtHours + h.mealHours;
}

function premiumDlrs(h: MonthlyHours): number {
  return h.otDollars + h.dtDollars + h.mealDollars;
}

function totalHrs(h: MonthlyHours): number {
  return h.regHours + h.otHours + h.dtHours + h.mealHours;
}

/** Get the hours for a specific period, or totals for "all" */
function getEmployeePeriodHours(
  emp: OTEmployee,
  period: string,
  granularity: "monthly" | "weekly"
): MonthlyHours {
  if (period === "all") {
    return {
      otHours: emp.totals.otHours,
      otDollars: emp.totals.otDollars,
      dtHours: emp.totals.dtHours,
      dtDollars: emp.totals.dtDollars,
      mealHours: emp.totals.mealHours,
      mealDollars: emp.totals.mealDollars,
      regHours: emp.totals.regHours,
      regDollars: emp.totals.regDollars,
    };
  }
  const source = granularity === "weekly" ? emp.weeklyHours : emp.monthlyHours;
  return source?.[period] ?? emptyHours();
}

// --- Aggregated Tree Types ---

interface EmployeeNode {
  id: string;
  displayName: string;
  payType: string;
  hours: MonthlyHours;
  dataStatus?: DataStatus;
}

interface ClassNode {
  classLabel: string;
  hours: MonthlyHours;
  employees: EmployeeNode[];
}

interface DepartmentNode {
  department: string;
  hours: MonthlyHours;
  classes: ClassNode[];
}

// --- Page ---

export default function OvertimeAnalysisPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const current = getCurrentPeriod();

  const [year, setYear] = useState(current.year);
  const [rawEmployees, setRawEmployees] = useState<OTEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [payPeriods, setPayPeriods] = useState<PayPeriod[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View controls
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [calendarMonth, setCalendarMonth] = useState<string>(""); // "YYYY-MM"
  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("all");

  // Collapsible state
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());

  // --- Fetch Data ---
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [otRes, allocRes] = await Promise.all([
          fetch(`/api/paylocity/ot-analysis?year=${year}`),
          fetch("/api/paylocity/allocations"),
        ]);
        if (!otRes.ok) throw new Error(`Failed to fetch: ${otRes.status}`);
        const otData = await otRes.json();
        setRawEmployees(otData.employees ?? []);
        setAvailableMonths(otData.months ?? []);
        setAvailableWeeks(otData.weeks ?? []);
        setPayPeriods(otData.payPeriods ?? []);
        setDiagnostics(otData.diagnostics ?? null);

        // Default calendar month to most recent month with data
        const months = otData.months ?? [];
        if (months.length > 0) {
          setCalendarMonth(months[months.length - 1]);
        }

        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations ?? []);
        }
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

  // Reset period when granularity changes
  useEffect(() => {
    setSelectedPeriod("all");
  }, [granularity]);

  // Build allocation lookup
  const allocationMap = useMemo(() => {
    const map: Record<string, AllocationOverride> = {};
    for (const a of allocations) {
      map[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }
    return map;
  }, [allocations]);

  // Apply client-side allocation overrides
  const allEmployees = useMemo(() => {
    return rawEmployees.map((emp) => {
      const override = allocationMap[`${emp.id}:${emp.companyId}`];
      if (!override) return emp;

      const effectiveEntityId =
        override.allocated_entity_id || emp.operatingEntityId;
      const effectiveEntityName =
        override.allocated_entity_name || emp.operatingEntityName;
      const effectiveEntityCode = effectiveEntityName.includes("Silverco")
        ? "AVON"
        : effectiveEntityName.includes("Avon Rental")
          ? "ARH"
          : effectiveEntityName.includes("Versatile")
            ? "VS"
            : effectiveEntityName.includes("Hollywood Depot")
              ? "HDR"
              : emp.operatingEntityCode;

      return {
        ...emp,
        department: override.department || emp.department,
        classValue: override.class || "",
        operatingEntityId: effectiveEntityId,
        operatingEntityCode: effectiveEntityCode,
        operatingEntityName: effectiveEntityName,
      };
    });
  }, [rawEmployees, allocationMap]);

  // Filter to this entity's employee pool.
  // For employing entities (Silverco, HDR): include ALL employees from the
  // Paylocity company (matching the Roster tab on the employees page), PLUS
  // any employees from other companies that are allocated here.
  // For non-employing entities: use allocation-based filtering only.
  const paylocityCompanyId = EMPLOYING_ENTITIES[entityId] ?? null;

  const entityEmployees = useMemo(() => {
    if (paylocityCompanyId) {
      // Employing entity — union of roster + cross-company allocations
      return allEmployees.filter(
        (e) =>
          e.companyId === paylocityCompanyId ||
          e.operatingEntityId === entityId
      );
    }
    // Non-employing entity — allocation-based only
    return allEmployees.filter((e) => e.operatingEntityId === entityId);
  }, [allEmployees, entityId, paylocityCompanyId]);

  // Build Department > Class > Employee org tree for the selected period
  const orgTree: DepartmentNode[] = useMemo(() => {
    // 1. Group employees by department → class
    const deptMap = new Map<string, Map<string, OTEmployee[]>>();

    for (const emp of entityEmployees) {
      const dept = emp.department || "Unassigned";
      const cls = emp.classValue || "Unassigned";

      if (!deptMap.has(dept)) deptMap.set(dept, new Map());
      const classMap = deptMap.get(dept)!;
      if (!classMap.has(cls)) classMap.set(cls, []);
      classMap.get(cls)!.push(emp);
    }

    // 2. Build tree nodes with hours for the selected period
    const departments: DepartmentNode[] = [];

    for (const [dept, classMap] of deptMap) {
      const classes: ClassNode[] = [];

      for (const [cls, employees] of classMap) {
        const empNodes: EmployeeNode[] = employees
          .map((emp) => ({
            id: emp.id,
            displayName: emp.displayName,
            payType: emp.payType,
            hours: getEmployeePeriodHours(emp, selectedPeriod, granularity),
            dataStatus: emp.dataStatus,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

        const classHours = empNodes.reduce(
          (sum, e) => addHours(sum, e.hours),
          emptyHours()
        );

        classes.push({
          classLabel: cls,
          hours: classHours,
          employees: empNodes,
        });
      }

      // Sort classes alphabetically
      classes.sort((a, b) => a.classLabel.localeCompare(b.classLabel));

      const deptHours = classes.reduce(
        (sum, c) => addHours(sum, c.hours),
        emptyHours()
      );

      departments.push({
        department: dept,
        hours: deptHours,
        classes,
      });
    }

    // Sort departments alphabetically
    departments.sort((a, b) => a.department.localeCompare(b.department));

    return departments;
  }, [entityEmployees, selectedPeriod, granularity]);

  // Auto-expand all departments on load
  useEffect(() => {
    if (orgTree.length > 0) {
      setExpandedDepts(new Set(orgTree.map((d) => d.department)));
    }
  }, [orgTree]);

  // Entity-level totals for the selected period
  const entityTotals = useMemo(() => {
    return orgTree.reduce(
      (sum, dept) => addHours(sum, dept.hours),
      emptyHours()
    );
  }, [orgTree]);

  // Aggregate daily hours across all entity employees for calendar view
  const calendarData = useMemo(() => {
    const byDay: Record<string, MonthlyHours> = {};
    for (const emp of entityEmployees) {
      if (!emp.dailyHours) continue;
      for (const [date, hours] of Object.entries(emp.dailyHours)) {
        byDay[date] = byDay[date] ? addHours(byDay[date], hours) : { ...hours };
      }
    }
    return byDay;
  }, [entityEmployees]);

  // Pay period ranges relevant to the calendar month
  const calendarPayPeriods = useMemo(() => {
    if (!calendarMonth) return [];
    return payPeriods.filter((pp) => pp.checkDate.startsWith(calendarMonth));
  }, [payPeriods, calendarMonth]);

  const entityPremiumHrs = premiumHrs(entityTotals);
  const entityTotalHrs = totalHrs(entityTotals);
  const employeesWithPremium = entityEmployees.filter((e) => {
    const h = getEmployeePeriodHours(e, selectedPeriod, granularity);
    return premiumHrs(h) > 0;
  }).length;

  // Toggle handlers
  function toggleDept(dept: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }

  function toggleClass(key: string) {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);

  // Period options for the dropdown
  const periodOptions = useMemo(() => {
    const periods = granularity === "weekly" ? availableWeeks : availableMonths;
    return periods.map((key) => ({
      key,
      label: granularity === "weekly" ? weekLabel(key) : monthLabel(key),
    }));
  }, [granularity, availableMonths, availableWeeks]);

  // Period label for display
  const periodLabel =
    selectedPeriod === "all"
      ? "YTD"
      : granularity === "weekly"
        ? weekLabel(selectedPeriod)
        : monthLabel(selectedPeriod);

  // Render a row of hours columns
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
    const ph = premiumHrs(h);
    const pd = premiumDlrs(h);
    const th = totalHrs(h);
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
            OT, double time, and meal premiums — by department, class, and
            employee
          </p>
        </div>
      </div>

      {/* Controls Row */}
      <div className="flex flex-wrap items-center gap-4">
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

        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as "table" | "calendar")}
        >
          <TabsList>
            <TabsTrigger value="table" className="gap-1.5">
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {viewMode === "table" && (
          <>
            <Tabs
              value={granularity}
              onValueChange={(v) =>
                setGranularity(v as "monthly" | "weekly")
              }
            >
              <TabsList>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
              </TabsList>
            </Tabs>

            <Select
              value={selectedPeriod}
              onValueChange={setSelectedPeriod}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Year (YTD)</SelectItem>
                {periodOptions.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <span className="text-sm text-muted-foreground">
          {entityEmployees.length} employees &middot;{" "}
          {viewMode === "calendar" && calendarMonth
            ? monthLabel(calendarMonth)
            : periodLabel}
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
                  DT: {fmtHrs(entityTotals.dtHours)} hrs (
                  {formatCurrency(entityTotals.dtDollars)}) &nbsp;|&nbsp; Meal:{" "}
                  {fmtHrs(entityTotals.mealHours)} hrs (
                  {formatCurrency(entityTotals.mealDollars)})
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
                  {formatCurrency(premiumDlrs(entityTotals))}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtHrs(entityPremiumHrs)} premium hours &middot; {periodLabel}
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
                  {pct(entityPremiumHrs, entityTotalHrs)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {employeesWithPremium} of {entityEmployees.length} employees
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Diagnostics Warning — show if any API calls failed */}
          {diagnostics && (diagnostics.summaryFailed > 0 || diagnostics.detailsFailed > 0) && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Some pay data could not be loaded</p>
                <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                  {diagnostics.summaryFailed > 0 && (
                    <span>{diagnostics.summaryFailed} employee(s) had summary data failures. </span>
                  )}
                  {diagnostics.detailsFailed > 0 && (
                    <span>{diagnostics.detailsFailed} employee(s) had detail data failures. </span>
                  )}
                  Affected employees are marked with a ⚠ icon. Their OT data may be incomplete.
                </p>
              </div>
            </div>
          )}

          {viewMode === "table" ? (
            /* Department > Class > Employee Table */
            <Card>
              <CardHeader>
                <CardTitle>
                  {periodLabel} Breakdown
                </CardTitle>
                <CardDescription>
                  Click a department to expand by class, then click a class to
                  see individual employees. Sorted alphabetically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {orgTree.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No Employees</h3>
                    <p className="text-muted-foreground text-center">
                      No employees allocated to this entity.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[280px]">
                            Department / Class / Employee
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Overtime hours (1.5x rate)"
                          >
                            OT Hrs
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Double time hours (2x rate)"
                          >
                            DT Hrs
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Meal premium hours"
                          >
                            Meal Hrs
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Total premium pay cost (OT + DT + Meal)"
                          >
                            Premium $
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Regular hours for comparison"
                          >
                            Reg Hrs
                          </TableHead>
                          <TableHead
                            className="text-right"
                            title="Premium hours as % of total hours"
                          >
                            Prem %
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgTree.map((dept) => {
                          const deptExpanded = expandedDepts.has(
                            dept.department
                          );
                          const totalEmpCount = dept.classes.reduce(
                            (s, c) => s + c.employees.length,
                            0
                          );

                          return (
                            <DeptSection
                              key={dept.department}
                              dept={dept}
                              expanded={deptExpanded}
                              totalEmpCount={totalEmpCount}
                              expandedClasses={expandedClasses}
                              onToggleDept={() =>
                                toggleDept(dept.department)
                              }
                              onToggleClass={toggleClass}
                              HoursCells={HoursCells}
                            />
                          );
                        })}

                        {/* Grand Total Row */}
                        <TableRow className="font-semibold border-t-2">
                          <TableCell>{periodLabel} Total</TableCell>
                          <HoursCells h={entityTotals} bold />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            /* Calendar View */
            <CalendarView
              calendarMonth={calendarMonth}
              onMonthChange={setCalendarMonth}
              calendarData={calendarData}
              payPeriods={calendarPayPeriods}
              availableMonths={availableMonths}
            />
          )}
        </>
      )}
    </div>
  );
}

// --- Sub-components to avoid key issues with fragments ---

function DeptSection({
  dept,
  expanded,
  totalEmpCount,
  expandedClasses,
  onToggleDept,
  onToggleClass,
  HoursCells,
}: {
  dept: DepartmentNode;
  expanded: boolean;
  totalEmpCount: number;
  expandedClasses: Set<string>;
  onToggleDept: () => void;
  onToggleClass: (key: string) => void;
  HoursCells: React.FC<{ h: MonthlyHours; bold?: boolean; muted?: boolean }>;
}) {
  return (
    <>
      {/* Department Row */}
      <TableRow
        className="cursor-pointer hover:bg-muted/50 font-semibold bg-muted/30"
        onClick={onToggleDept}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span>{dept.department}</span>
            <span className="text-xs text-muted-foreground font-normal">
              ({totalEmpCount} emp)
            </span>
          </div>
        </TableCell>
        <HoursCells h={dept.hours} bold />
      </TableRow>

      {/* Class Rows */}
      {expanded &&
        dept.classes.map((cls) => {
          const clsKey = `${dept.department}::${cls.classLabel}`;
          const clsExpanded = expandedClasses.has(clsKey);
          return (
            <ClassSection
              key={clsKey}
              cls={cls}
              clsKey={clsKey}
              expanded={clsExpanded}
              onToggle={() => onToggleClass(clsKey)}
              HoursCells={HoursCells}
            />
          );
        })}
    </>
  );
}

function ClassSection({
  cls,
  clsKey,
  expanded,
  onToggle,
  HoursCells,
}: {
  cls: ClassNode;
  clsKey: string;
  expanded: boolean;
  onToggle: () => void;
  HoursCells: React.FC<{ h: MonthlyHours; bold?: boolean; muted?: boolean }>;
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/30"
        onClick={onToggle}
      >
        <TableCell>
          <div className="flex items-center gap-2 pl-6">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium">{cls.classLabel}</span>
            <span className="text-xs text-muted-foreground">
              ({cls.employees.length} emp)
            </span>
          </div>
        </TableCell>
        <HoursCells h={cls.hours} />
      </TableRow>

      {/* Employee Rows */}
      {expanded &&
        cls.employees.map((emp) => {
          const hasFetchError = emp.dataStatus && emp.dataStatus !== "ok";
          return (
            <TableRow key={`${clsKey}::${emp.id}`} className="text-sm">
              <TableCell>
                <div className="flex items-center gap-2 pl-14">
                  {hasFetchError && (
                    <span
                      title={
                        emp.dataStatus === "both_failed"
                          ? "Both summary & detail data failed to load"
                          : emp.dataStatus === "summary_failed"
                            ? "Summary data (OT/REG hours) failed to load"
                            : "Detail data (DT/Meal) failed to load"
                      }
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    </span>
                  )}
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
          );
        })}
    </>
  );
}

// --- Calendar View ---

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarView({
  calendarMonth,
  onMonthChange,
  calendarData,
  payPeriods,
  availableMonths,
}: {
  calendarMonth: string;
  onMonthChange: (m: string) => void;
  calendarData: Record<string, MonthlyHours>;
  payPeriods: PayPeriod[];
  availableMonths: string[];
}) {
  if (!calendarMonth) return null;

  const [yearStr, monthStr] = calendarMonth.split("-");
  const monthDate = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Build a set of dates within pay period ranges for background highlighting
  // Parse date strings as local time (not UTC) to avoid timezone day-shift
  function parseLocalDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const periodRangeSet = new Set<string>();
  for (const pp of payPeriods) {
    const start = parseLocalDate(pp.beginDate);
    const end = parseLocalDate(pp.endDate);
    const rangeDays = eachDayOfInterval({
      start: start < monthStart ? monthStart : start,
      end: end > monthEnd ? monthEnd : end,
    });
    for (const d of rangeDays) {
      periodRangeSet.add(format(d, "yyyy-MM-dd"));
    }
  }

  // Leading empty cells for alignment (days before the 1st)
  const leadingBlanks = getDay(monthStart); // 0=Sun

  // Month totals from calendar data
  const monthTotal = Object.entries(calendarData)
    .filter(([date]) => date.startsWith(calendarMonth))
    .reduce((sum, [, h]) => addHours(sum, h), emptyHours());

  const prevMonth = format(subMonths(monthDate, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthDate, 1), "yyyy-MM");
  const canGoPrev = availableMonths.includes(prevMonth);
  const canGoNext = availableMonths.includes(nextMonth);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {format(monthDate, "MMMM yyyy")} Premium Calendar
            </CardTitle>
            <CardDescription>
              Aggregate OT, DT, and Meal premiums across all employees per pay
              date. Shaded bands show pay period ranges.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={!canGoPrev}
              onClick={() => onMonthChange(prevMonth)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!canGoNext}
              onClick={() => onMonthChange(nextMonth)}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Month summary bar */}
        {premiumHrs(monthTotal) > 0 && (
          <div className="flex flex-wrap gap-4 mb-4 p-3 rounded-lg bg-muted/50 text-sm">
            <span>
              <span className="font-medium text-blue-600 dark:text-blue-400">
                OT:
              </span>{" "}
              {fmtHrs(monthTotal.otHours)} hrs (
              {formatCurrency(monthTotal.otDollars)})
            </span>
            <span>
              <span className="font-medium text-orange-600 dark:text-orange-400">
                DT:
              </span>{" "}
              {fmtHrs(monthTotal.dtHours)} hrs (
              {formatCurrency(monthTotal.dtDollars)})
            </span>
            <span>
              <span className="font-medium text-purple-600 dark:text-purple-400">
                Meal:
              </span>{" "}
              {fmtHrs(monthTotal.mealHours)} hrs (
              {formatCurrency(monthTotal.mealDollars)})
            </span>
            <span className="font-semibold">
              Total: {formatCurrency(premiumDlrs(monthTotal))}
            </span>
          </div>
        )}

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
          {/* Day name headers */}
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground text-center"
            >
              {name}
            </div>
          ))}

          {/* Leading blanks */}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} className="bg-background min-h-[100px]" />
          ))}

          {/* Day cells */}
          {daysInMonth.map((date) => {
            const dateStr = format(date, "yyyy-MM-dd");
            const dayNum = date.getDate();
            const isWeekend = getDay(date) === 0 || getDay(date) === 6;
            const inPayPeriod = periodRangeSet.has(dateStr);
            const dayData = calendarData[dateStr];
            const hasData = dayData && premiumHrs(dayData) > 0;

            return (
              <div
                key={dateStr}
                className={`bg-background min-h-[100px] p-1.5 relative ${
                  isWeekend ? "bg-muted/30" : ""
                } ${inPayPeriod ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
              >
                <span
                  className={`text-xs tabular-nums ${
                    hasData
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {dayNum}
                </span>
                {hasData && (
                  <div className="mt-1 space-y-0.5">
                    {dayData.otHours > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span className="text-[10px] tabular-nums text-blue-700 dark:text-blue-300 leading-tight">
                          OT {fmtHrs(dayData.otHours)}h
                        </span>
                      </div>
                    )}
                    {dayData.dtHours > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                        <span className="text-[10px] tabular-nums text-orange-700 dark:text-orange-300 leading-tight">
                          DT {fmtHrs(dayData.dtHours)}h
                        </span>
                      </div>
                    )}
                    {dayData.mealHours > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                        <span className="text-[10px] tabular-nums text-purple-700 dark:text-purple-300 leading-tight">
                          Meal {fmtHrs(dayData.mealHours)}h
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] font-semibold tabular-nums text-foreground/80 mt-0.5 leading-tight">
                      {formatCurrency(premiumDlrs(dayData))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            Overtime (1.5x)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
            Double Time (2x)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-purple-500" />
            Meal Premium
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800" />
            Pay period range
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
