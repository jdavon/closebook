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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Search,
  Loader2,
  DollarSign,
  Users,
  TrendingUp,
} from "lucide-react";

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

interface MappedEmployee {
  id: string;
  companyId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  erTaxes: number;
  erBenefits: number;
  totalComp: number;
  baseRate: number;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
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

export default function MonthlyEmployeeCostPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [costView, setCostView] = useState<"total" | "wages" | "taxes" | "benefits">("total");

  const currentEntity = OPERATING_ENTITIES.find((e) => e.id === entityId);

  useEffect(() => {
    async function load() {
      try {
        const [empRes, allocRes] = await Promise.all([
          fetch("/api/paylocity/employees"),
          fetch("/api/paylocity/allocations"),
        ]);
        if (!empRes.ok) throw new Error(`Failed to fetch employees: ${empRes.status}`);
        const empData = await empRes.json();
        setEmployees(empData.employees ?? []);

        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Allocation override lookup
  const allocationMap = useMemo(() => {
    const map: Record<string, AllocationOverride> = {};
    for (const a of allocations) {
      map[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }
    return map;
  }, [allocations]);

  // Entity employees with overrides applied
  const entityEmployees = useMemo(() => {
    return employees
      .filter((e) => {
        const override = allocationMap[`${e.id}:${e.companyId}`];
        const effectiveEntityId = override?.allocated_entity_id || e.operatingEntityId;
        return effectiveEntityId === entityId;
      })
      .map((e) => {
        const override = allocationMap[`${e.id}:${e.companyId}`];
        if (!override) return e;
        return {
          ...e,
          department: override.department || e.department,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [employees, entityId, allocationMap]);

  // Departments for filter
  const uniqueDepts = useMemo(
    () => [...new Set(entityEmployees.map((e) => e.department))].filter(Boolean).sort(),
    [entityEmployees]
  );

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return entityEmployees.filter((emp) => {
      if (deptFilter !== "all" && emp.department !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.displayName.toLowerCase().includes(q) ||
          emp.jobTitle.toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entityEmployees, deptFilter, search]);

  // Get the monthly cost for an employee based on the selected view
  function getMonthlyAmount(emp: MappedEmployee): number {
    switch (costView) {
      case "wages":
        return emp.annualComp / 12;
      case "taxes":
        return emp.erTaxes / 12;
      case "benefits":
        return (emp.erBenefits ?? 0) / 12;
      case "total":
      default:
        return emp.totalComp / 12;
    }
  }

  // Monthly column totals
  const monthlyTotals = useMemo(() => {
    return MONTHS.map(() =>
      filteredEmployees.reduce((sum, emp) => sum + getMonthlyAmount(emp), 0)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEmployees, costView]);

  const grandTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  const totalMonthly = filteredEmployees.reduce((sum, emp) => sum + getMonthlyAmount(emp), 0);

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
            Per-employee monthly cost breakdown for {currentEntity?.name ?? "this entity"}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Headcount</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredEmployees.length}</div>
            <p className="text-xs text-muted-foreground">
              {entityEmployees.length} total allocated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(totalMonthly)}</div>
            <p className="text-xs text-muted-foreground">
              {costView === "total" ? "Wages + ER taxes + benefits" : costView}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Annual Cost</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompact(grandTotal)}</div>
            <p className="text-xs text-muted-foreground">12-month total</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Breakdown</CardTitle>
          <CardDescription>
            Per-employee cost by month ({new Date().getFullYear()})
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
            <span className="text-sm text-muted-foreground">
              {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? "s" : ""}
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
                    Annual
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => {
                  const monthly = getMonthlyAmount(emp);
                  const annual = monthly * 12;

                  return (
                    <TableRow key={`${emp.companyId}-${emp.id}`}>
                      <TableCell className="sticky left-0 bg-background z-10 font-medium whitespace-nowrap">
                        {emp.displayName}
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
                      {MONTHS.map((m) => (
                        <TableCell key={m} className="text-right font-mono text-sm">
                          {formatCurrency(monthly)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(annual)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredEmployees.length === 0 && (
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
                {filteredEmployees.length > 0 && (
                  <TableRow className="font-semibold border-t-2 bg-muted/50">
                    <TableCell className="sticky left-0 bg-muted/50 z-10">
                      Total ({filteredEmployees.length} employees)
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    {monthlyTotals.map((total, i) => (
                      <TableCell key={MONTHS[i]} className="text-right font-mono">
                        {formatCurrency(total)}
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
    </div>
  );
}
