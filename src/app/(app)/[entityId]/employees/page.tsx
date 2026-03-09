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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Search,
  TrendingUp,
  Loader2,
  Settings,
} from "lucide-react";

// --- Types ---

interface MappedEmployee {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  status: string;
  statusType: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
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

// --- Page ---

export default function EmployeeRosterPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [payTypeFilter, setPayTypeFilter] = useState<string>("all");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/paylocity/employees");
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const data = await res.json();
        setEmployees(data.employees ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter to this entity
  const entityEmployees = useMemo(
    () => employees.filter((e) => e.operatingEntityId === entityId),
    [employees, entityId]
  );

  // Department list
  const uniqueDepts = useMemo(
    () => [...new Set(entityEmployees.map((e) => e.department))].sort(),
    [entityEmployees]
  );

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return entityEmployees.filter((emp) => {
      if (deptFilter !== "all" && emp.department !== deptFilter) return false;
      if (payTypeFilter !== "all" && emp.payType !== payTypeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.displayName.toLowerCase().includes(q) ||
          (emp.jobTitle ?? "").toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entityEmployees, deptFilter, payTypeFilter, search]);

  // KPIs
  const totalComp = entityEmployees.reduce((s, e) => s + e.annualComp, 0);
  const avgComp = entityEmployees.length > 0 ? totalComp / entityEmployees.length : 0;
  const deptCount = uniqueDepts.length;

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
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-muted-foreground">
            Employee roster, compensation, and department breakdown
          </p>
        </div>
        <Link href={`/${entityId}/employees/settings`}>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Headcount</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entityEmployees.length}</div>
            <p className="text-xs text-muted-foreground">Active employees</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Annual Payroll</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalComp)}</div>
            <p className="text-xs text-muted-foreground">Total annual compensation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Compensation</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(avgComp)}</div>
            <p className="text-xs text-muted-foreground">Per employee annual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Departments</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deptCount}</div>
            <p className="text-xs text-muted-foreground">Active departments</p>
          </CardContent>
        </Card>
      </div>

      {/* Employee Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee Roster</CardTitle>
          <CardDescription>
            {entityEmployees.length} active employee{entityEmployees.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter Bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, title, or department..."
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
            <Select value={payTypeFilter} onValueChange={setPayTypeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Salary">Salary</SelectItem>
                <SelectItem value="Hourly">Hourly</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {filteredEmployees.length} of {entityEmployees.length}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Annual Comp</TableHead>
                  <TableHead className="text-right">Base Rate</TableHead>
                  <TableHead>Hire Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">{emp.displayName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {emp.jobTitle || "---"}
                    </TableCell>
                    <TableCell>{emp.department}</TableCell>
                    <TableCell>
                      <Badge variant={emp.payType === "Salary" ? "default" : "secondary"}>
                        {emp.payType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(emp.annualComp)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {emp.baseRate > 0
                        ? `$${emp.baseRate.toFixed(2)}${emp.payType === "Hourly" ? "/hr" : ""}`
                        : "---"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {emp.hireDate
                        ? new Date(emp.hireDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "---"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {emp.statusType || emp.status || "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEmployees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No employees match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Totals */}
          {filteredEmployees.length > 0 && (
            <div className="mt-3 flex justify-end gap-6 text-sm">
              <span className="text-muted-foreground">
                Total Annual:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0))}
                </span>
              </span>
              <span className="text-muted-foreground">
                Monthly:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0) / 12)}
                </span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
