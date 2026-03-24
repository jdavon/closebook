"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
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
  Users,
  DollarSign,
  Building2,
  TrendingUp,
  Loader2,
  Clock,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

// --- Types ---

interface MappedEmployee {
  id: string;
  companyId: string;
  displayName: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  baseRate: number;
  department: string;
  operatingEntityId: string;
}

interface AllocationOverride {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
}

interface PayrollSummaryMonth {
  year: number;
  month: number;
  grossPay: number;
  netPay: number;
  hours: number;
  checkCount: number;
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

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DEPT_COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626",
  "#0891b2", "#ca8a04", "#7c3aed", "#059669", "#e11d48",
];

// --- Page ---

export default function EmployeeDetailsPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [payrollHistory, setPayrollHistory] = useState<PayrollSummaryMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  useEffect(() => {
    async function load() {
      try {
        const [empRes, allocRes, payRes] = await Promise.all([
          fetch("/api/paylocity/employees"),
          fetch("/api/paylocity/allocations"),
          fetch(`/api/paylocity/payroll-summary?year=${selectedYear}`),
        ]);

        if (empRes.ok) {
          const empData = await empRes.json();
          setEmployees(empData.employees ?? []);
        }

        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations ?? []);
        }

        if (payRes.ok) {
          const payData = await payRes.json();
          setPayrollHistory(payData.months ?? []);
        } else {
          // payroll-summary might not exist yet — that's ok
          setPayrollHistory([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedYear]);

  // Build allocation lookup and apply overrides
  const allocationMap = useMemo(() => {
    const map: Record<string, AllocationOverride> = {};
    for (const a of allocations) {
      map[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }
    return map;
  }, [allocations]);

  // Filter to entity using effective (overridden) entity
  const entityEmployees = useMemo(
    () => employees.filter((e) => {
      const override = allocationMap[`${e.id}:${e.companyId}`];
      const effectiveEntityId = override?.allocated_entity_id || e.operatingEntityId;
      return effectiveEntityId === entityId;
    }).map((e) => {
      const override = allocationMap[`${e.id}:${e.companyId}`];
      if (!override) return e;
      return {
        ...e,
        department: override.department || e.department,
      };
    }),
    [employees, entityId, allocationMap]
  );

  // Department breakdown
  const deptBreakdown = useMemo(() => {
    const map: Record<string, { headcount: number; totalComp: number; avgComp: number; salaryCount: number; hourlyCount: number }> = {};
    for (const emp of entityEmployees) {
      const dept = emp.department || "Unassigned";
      if (!map[dept]) {
        map[dept] = { headcount: 0, totalComp: 0, avgComp: 0, salaryCount: 0, hourlyCount: 0 };
      }
      map[dept].headcount++;
      map[dept].totalComp += emp.annualComp;
      if (emp.payType === "Salary") map[dept].salaryCount++;
      else map[dept].hourlyCount++;
    }
    // Calculate averages
    for (const dept of Object.values(map)) {
      dept.avgComp = dept.headcount > 0 ? dept.totalComp / dept.headcount : 0;
    }
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.totalComp - a.totalComp);
  }, [entityEmployees]);

  // Dept bar chart data
  const deptChartData = useMemo(
    () => deptBreakdown.map((d) => ({
      name: d.name.length > 15 ? d.name.slice(0, 15) + "..." : d.name,
      fullName: d.name,
      annual: Math.round(d.totalComp),
      headcount: d.headcount,
    })),
    [deptBreakdown]
  );

  // Monthly payroll trend (from payroll-summary if available)
  const monthlyTrend = useMemo(() => {
    if (payrollHistory.length === 0) {
      // Fallback: estimate from employee data
      const monthlyEst = entityEmployees.reduce((s, e) => s + e.annualComp, 0) / 12;
      return Array.from({ length: 12 }, (_, i) => ({
        name: MONTH_NAMES[i],
        month: i + 1,
        amount: i < new Date().getMonth() ? Math.round(monthlyEst) : 0,
      })).filter((m) => m.amount > 0);
    }
    return payrollHistory.map((m) => ({
      name: MONTH_NAMES[m.month - 1],
      month: m.month,
      amount: Math.round(m.grossPay),
    }));
  }, [payrollHistory, entityEmployees]);

  // KPIs
  const totalComp = entityEmployees.reduce((s, e) => s + e.annualComp, 0);
  const avgHourlyCost = (() => {
    const hourlyEmps = entityEmployees.filter((e) => e.payType === "Hourly" && e.baseRate > 0);
    if (hourlyEmps.length === 0) return 0;
    return hourlyEmps.reduce((s, e) => s + e.baseRate, 0) / hourlyEmps.length;
  })();
  const salaryCount = entityEmployees.filter((e) => e.payType === "Salary").length;
  const hourlyCount = entityEmployees.filter((e) => e.payType === "Hourly").length;

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employee Details</h1>
          <p className="text-muted-foreground">
            Cost analysis, department breakdown, and payroll trends
          </p>
        </div>
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
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Payroll Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalComp)}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(Math.round(totalComp / 12))}/mo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Hourly Cost</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgHourlyCost > 0 ? `$${avgHourlyCost.toFixed(2)}` : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">
              {hourlyCount} hourly employee{hourlyCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Headcount</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entityEmployees.length}</div>
            <p className="text-xs text-muted-foreground">
              {salaryCount} salary, {hourlyCount} hourly
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Departments</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deptBreakdown.length}</div>
            <p className="text-xs text-muted-foreground">Active departments</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Department Cost Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by Department</CardTitle>
            <CardDescription>Annual compensation allocated by department</CardDescription>
          </CardHeader>
          <CardContent>
            {deptChartData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deptChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis tickFormatter={(v: number) => formatCompact(v)} className="text-xs" />
                    <RechartsTooltip
                      formatter={(value) => [formatCurrency(Number(value)), "Annual Comp"]}
                      labelFormatter={(label) => {
                        const item = deptChartData.find((d) => d.name === String(label));
                        return item ? `${item.fullName} (${item.headcount} employees)` : String(label);
                      }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Bar dataKey="annual" radius={[4, 4, 0, 0]}>
                      {deptChartData.map((_entry, i) => (
                        <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No department data available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Monthly Payroll Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Payroll Trend</CardTitle>
            <CardDescription>
              {selectedYear} payroll cost by month
              {payrollHistory.length === 0 && " (estimated from annual comp)"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrend} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis tickFormatter={(v: number) => formatCompact(v)} className="text-xs" />
                    <RechartsTooltip
                      formatter={(value) => [formatCurrency(Number(value)), "Payroll"]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No payroll data for {selectedYear}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Department Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Breakdown</CardTitle>
          <CardDescription>Cost and headcount by department</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Headcount</TableHead>
                  <TableHead className="text-right">Salary</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Annual Comp</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">Avg Comp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptBreakdown.map((dept) => (
                  <TableRow key={dept.name}>
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell className="text-right">{dept.headcount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{dept.salaryCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{dept.hourlyCount}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(dept.totalComp)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(Math.round(dept.totalComp / 12))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(Math.round(dept.avgComp))}
                    </TableCell>
                  </TableRow>
                ))}
                {deptBreakdown.length > 1 && (
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{entityEmployees.length}</TableCell>
                    <TableCell className="text-right">{salaryCount}</TableCell>
                    <TableCell className="text-right">{hourlyCount}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(totalComp)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(Math.round(totalComp / 12))}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entityEmployees.length > 0 ? formatCurrency(Math.round(totalComp / entityEmployees.length)) : "---"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* OT Analysis Placeholder */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Overtime Analysis
          </CardTitle>
          <CardDescription>
            OT hours, cost by employee/department, and trends over time.
            Coming soon — requires earnings detail integration from Paylocity.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
