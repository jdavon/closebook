"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  DollarSign,
  Building2,
  Search,
  TrendingUp,
  Loader2,
  Settings,
  Info,
  Landmark,
  Pencil,
  Check,
  X,
  Upload,
} from "lucide-react";
import { ImportAllocationsDialog } from "./import-allocations-dialog";

// --- Constants ---

/** Employing entity IDs → Paylocity company IDs */
const EMPLOYING_ENTITIES: Record<string, string> = {
  "b664a9c1-3817-4df4-9261-f51b3403a5de": "132427", // Silverco
  "7529580d-3b44-4a9b-91f4-bc2db25f5211": "316791", // HDR
};

/** All operating entities for Company dropdown */
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
  status: string;
  statusType: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  erTaxes: number;
  totalComp: number;
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
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

/** Employee with merged allocation overrides */
interface DisplayEmployee extends MappedEmployee {
  /** Effective department (override or default) */
  effectiveDepartment: string;
  /** Class (from override only) */
  classValue: string;
  /** Effective company/entity (override or default) */
  effectiveEntityId: string;
  effectiveEntityName: string;
  /** Whether this employee has any overrides */
  hasOverrides: boolean;
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

// --- Editable Cell Component ---

function EditableTextCell({
  value,
  onSave,
  placeholder = "---",
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="h-7 text-xs w-[140px]"
          disabled={saving}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave} disabled={saving}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancel} disabled={saving}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 py-0.5"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function EditableSelectCell({
  value,
  options,
  onSave,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (newValue: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (newValue: string) => {
    if (newValue === value) return;
    setSaving(true);
    try {
      await onSave(newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-7 text-xs w-[160px] border-transparent hover:border-input">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Page ---

export default function EmployeeRosterPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [employees, setEmployees] = useState<MappedEmployee[]>([]);
  const [allocations, setAllocations] = useState<AllocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [payTypeFilter, setPayTypeFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"roster" | "allocations">("roster");

  // Determine if this entity is an employing entity (Silverco or HDR)
  const paylocityCompanyId = EMPLOYING_ENTITIES[entityId] ?? null;
  const isEmployingEntity = paylocityCompanyId !== null;
  const currentEntity = OPERATING_ENTITIES.find((e) => e.id === entityId);
  const entityName = currentEntity?.name ?? "this entity";

  // Fetch employees + allocations
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

  // Reset company filter when switching to allocations tab (irrelevant there)
  useEffect(() => {
    if (activeTab === "allocations") {
      setCompanyFilter("all");
    }
  }, [activeTab]);

  // Refresh allocations (called after import wizard completes)
  const refreshAllocations = useCallback(async () => {
    try {
      const res = await fetch("/api/paylocity/allocations");
      if (res.ok) {
        const data = await res.json();
        setAllocations(data.allocations ?? []);
      }
    } catch {
      // Silent fail — stale data is acceptable
    }
  }, []);

  // Build allocation lookup: "employeeId:companyId" → override
  const allocationMap = useMemo(() => {
    const map: Record<string, AllocationOverride> = {};
    for (const a of allocations) {
      map[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }
    return map;
  }, [allocations]);

  // Helper: merge a single employee with allocation overrides
  const mergeOverrides = useCallback(
    (emp: MappedEmployee): DisplayEmployee => {
      const override = allocationMap[`${emp.id}:${emp.companyId}`];
      return {
        ...emp,
        effectiveDepartment: override?.department || emp.department,
        classValue: override?.class || "",
        effectiveEntityId: override?.allocated_entity_id || emp.operatingEntityId,
        effectiveEntityName: override?.allocated_entity_name || emp.operatingEntityName,
        hasOverrides: !!override,
      };
    },
    [allocationMap]
  );

  // Roster employees: ALL from the Paylocity company (clerical view)
  const rosterDisplayEmployees: DisplayEmployee[] = useMemo(() => {
    if (!isEmployingEntity) return [];
    return employees
      .filter((e) => e.companyId === paylocityCompanyId)
      .map(mergeOverrides);
  }, [employees, isEmployingEntity, paylocityCompanyId, mergeOverrides]);

  // Cost allocation employees: those whose effective entity matches THIS entity (across all companies)
  const allocDisplayEmployees: DisplayEmployee[] = useMemo(() => {
    return employees
      .filter((e) => {
        const override = allocationMap[`${e.id}:${e.companyId}`];
        const effectiveEntityId = override?.allocated_entity_id || e.operatingEntityId;
        return effectiveEntityId === entityId;
      })
      .map(mergeOverrides);
  }, [employees, entityId, allocationMap, mergeOverrides]);

  // Active display employees based on tab selection
  const displayEmployees: DisplayEmployee[] = useMemo(() => {
    if (!isEmployingEntity) return allocDisplayEmployees;
    return activeTab === "roster" ? rosterDisplayEmployees : allocDisplayEmployees;
  }, [isEmployingEntity, activeTab, rosterDisplayEmployees, allocDisplayEmployees]);

  // Department and company lists for filters
  const uniqueDepts = useMemo(
    () => [...new Set(displayEmployees.map((e) => e.effectiveDepartment))].filter(Boolean).sort(),
    [displayEmployees]
  );

  const uniqueCompanies = useMemo(
    () =>
      [...new Set(displayEmployees.map((e) => e.effectiveEntityName))].filter(Boolean).sort(),
    [displayEmployees]
  );

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return displayEmployees.filter((emp) => {
      if (deptFilter !== "all" && emp.effectiveDepartment !== deptFilter) return false;
      if (payTypeFilter !== "all" && emp.payType !== payTypeFilter) return false;
      if (companyFilter !== "all" && emp.effectiveEntityName !== companyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          emp.displayName.toLowerCase().includes(q) ||
          emp.id.toLowerCase().includes(q) ||
          (emp.jobTitle ?? "").toLowerCase().includes(q) ||
          emp.effectiveDepartment.toLowerCase().includes(q) ||
          emp.effectiveEntityName.toLowerCase().includes(q) ||
          emp.classValue.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [displayEmployees, deptFilter, payTypeFilter, companyFilter, search]);

  // KPIs
  const totalAnnualComp = displayEmployees.reduce((s, e) => s + e.annualComp, 0);
  const totalERTaxes = displayEmployees.reduce((s, e) => s + e.erTaxes, 0);
  const totalFullComp = displayEmployees.reduce((s, e) => s + e.totalComp, 0);
  const avgComp = displayEmployees.length > 0 ? totalFullComp / displayEmployees.length : 0;
  const deptCount = uniqueDepts.length;

  // Silverco total payroll (company 132427, all entities)
  const silvercoEmployees = useMemo(
    () => employees.filter((e) => e.companyId === "132427"),
    [employees]
  );
  const silvercoTotalComp = silvercoEmployees.reduce((s, e) => s + e.totalComp, 0);
  const silvercoHeadcount = silvercoEmployees.length;

  // Save allocation override
  const saveAllocation = useCallback(
    async (
      emp: DisplayEmployee,
      field: "department" | "class" | "company",
      value: string
    ) => {
      // Determine the full allocation to save
      const existing = allocationMap[`${emp.id}:${emp.companyId}`];

      let department = existing?.department || emp.department;
      let classValue = existing?.class || "";
      let allocatedEntityId = existing?.allocated_entity_id || emp.operatingEntityId;
      let allocatedEntityName = existing?.allocated_entity_name || emp.operatingEntityName;

      if (field === "department") department = value;
      if (field === "class") classValue = value;
      if (field === "company") {
        allocatedEntityId = value;
        const entity = OPERATING_ENTITIES.find((e) => e.id === value);
        allocatedEntityName = entity?.name ?? value;
      }

      const res = await fetch("/api/paylocity/allocations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: emp.id,
          paylocityCompanyId: emp.companyId,
          department,
          class: classValue,
          allocatedEntityId,
          allocatedEntityName,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();

      // Update local allocation state
      setAllocations((prev) => {
        const key = `${emp.id}:${emp.companyId}`;
        const idx = prev.findIndex(
          (a) => `${a.employee_id}:${a.paylocity_company_id}` === key
        );
        const updated: AllocationOverride = {
          employee_id: emp.id,
          paylocity_company_id: emp.companyId,
          department: data.allocation?.department ?? department,
          class: data.allocation?.class ?? classValue,
          allocated_entity_id: data.allocation?.allocated_entity_id ?? allocatedEntityId,
          allocated_entity_name: data.allocation?.allocated_entity_name ?? allocatedEntityName,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    },
    [allocationMap]
  );

  // Entity options for Company dropdown
  const entityOptions = OPERATING_ENTITIES.map((e) => ({
    value: e.id,
    label: e.name,
  }));

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
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
            <p className="text-muted-foreground">
              {isEmployingEntity
                ? activeTab === "roster"
                  ? "Full payroll roster — click any Department, Class, or Company cell to edit"
                  : `Employees allocated to ${entityName} with compensation costs`
                : "Employee roster, compensation, and department breakdown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Link href={`/${entityId}/employees/settings`}>
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
          </div>
        </div>

        {/* Tabs — only for employing entities (Silverco, HDR) */}
        {isEmployingEntity && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "roster" | "allocations")}
          >
            <TabsList>
              <TabsTrigger value="roster">
                Roster ({rosterDisplayEmployees.length})
              </TabsTrigger>
              <TabsTrigger value="allocations">
                Cost Allocations ({allocDisplayEmployees.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Headcount</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{displayEmployees.length}</div>
              <p className="text-xs text-muted-foreground">Active employees</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(totalFullComp)}</div>
              <p className="text-xs text-muted-foreground">
                Wages {formatCompact(totalAnnualComp)} + ER taxes {formatCompact(totalERTaxes)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Total Comp</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(avgComp)}</div>
              <p className="text-xs text-muted-foreground">Per employee (incl. ER taxes)</p>
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

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Silverco Payroll</CardTitle>
              <Landmark className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCompact(silvercoTotalComp)}</div>
              <p className="text-xs text-muted-foreground">
                {silvercoHeadcount} employees across all entities
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Employee Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEmployingEntity && activeTab === "allocations"
                ? "Cost Allocations"
                : "Employee Roster"}
            </CardTitle>
            <CardDescription>
              {isEmployingEntity && activeTab === "allocations"
                ? `${displayEmployees.length} employee${displayEmployees.length !== 1 ? "s" : ""} allocated to ${entityName}`
                : `${displayEmployees.length} active employee${displayEmployees.length !== 1 ? "s" : ""}${isEmployingEntity ? " (full payroll company view)" : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filter Bar */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, title, department, company, class..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {isEmployingEntity && activeTab === "roster" && (
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {uniqueCompanies.map((co) => (
                      <SelectItem key={co} value={co}>
                        {co}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                {filteredEmployees.length} of {displayEmployees.length}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Company
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Operating entity this employee is allocated to
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Pay Type</TableHead>
                    <TableHead className="text-right">Annual Comp</TableHead>
                    <TableHead className="text-right">ER Taxes</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        Total Comp
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Annual wages + employer payroll taxes (FICA SS, Medicare, FUTA, CA SUI, ETT, SDI)
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Base Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow key={`${emp.companyId}-${emp.id}`}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {emp.displayName}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {emp.id}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {emp.jobTitle || "---"}
                      </TableCell>
                      {/* Company — editable select */}
                      <TableCell>
                        <EditableSelectCell
                          value={emp.effectiveEntityId}
                          options={entityOptions}
                          onSave={(val) => saveAllocation(emp, "company", val)}
                        />
                      </TableCell>
                      {/* Department — editable text */}
                      <TableCell>
                        <EditableTextCell
                          value={emp.effectiveDepartment}
                          onSave={(val) => saveAllocation(emp, "department", val)}
                          placeholder="Set department"
                        />
                      </TableCell>
                      {/* Class — editable text */}
                      <TableCell>
                        <EditableTextCell
                          value={emp.classValue}
                          onSave={(val) => saveAllocation(emp, "class", val)}
                          placeholder="Set class"
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={emp.payType === "Salary" ? "default" : "secondary"}>
                          {emp.payType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(emp.annualComp)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {formatCurrency(emp.erTaxes)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(emp.totalComp)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground whitespace-nowrap">
                        {emp.baseRate > 0
                          ? `$${emp.baseRate.toFixed(2)}${emp.payType === "Hourly" ? "/hr" : ""}`
                          : "---"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
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
                  Annual Wages:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.annualComp, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  ER Taxes:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.erTaxes, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Total Cost:{" "}
                  <span className="font-bold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.totalComp, 0))}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Monthly:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(filteredEmployees.reduce((s, e) => s + e.totalComp, 0) / 12)}
                  </span>
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Import Allocations Dialog */}
      <ImportAllocationsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        employees={displayEmployees}
        operatingEntities={OPERATING_ENTITIES}
        paylocityCompanyId={paylocityCompanyId}
        onComplete={refreshAllocations}
      />
    </TooltipProvider>
  );
}
