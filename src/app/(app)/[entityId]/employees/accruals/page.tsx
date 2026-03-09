"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  RefreshCw,
  Settings,
  Plus,
  DollarSign,
  Users,
  Clock,
  Banknote,
  Search,
  Loader2,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";

// --- Types ---

interface PayrollAccrual {
  id: string;
  period_year: number;
  period_month: number;
  accrual_type: string;
  description: string;
  amount: number;
  source: string;
  status: string;
  notes: string | null;
}

interface AccrualEmployee {
  id: string;
  displayName: string;
  department: string;
  costCenterCode: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  dailyRate: number;
  accrualDays: number;
  wageAccrual: number;
  taxAccrual: number;
  benefitAccrual: number;
  annualBenefitCost: number;
  benefitBreakdown: Record<string, number>;
  totalAccrual: number;
  taxBreakdown: Record<string, number>;
}

// --- Constants ---

const TYPE_LABELS: Record<string, string> = {
  wages: "Accrued Wages",
  payroll_tax: "Payroll Tax",
  pto: "PTO Liability",
  benefits: "Benefits",
};

const TYPE_ICONS: Record<string, typeof DollarSign> = {
  wages: Banknote,
  payroll_tax: DollarSign,
  pto: Clock,
  benefits: Users,
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline",
  posted: "default",
  reversed: "secondary",
};

function formatComp(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// --- Page ---

export default function PayrollAccrualsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const current = getCurrentPeriod();
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  const [accruals, setAccruals] = useState<PayrollAccrual[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Employees tab — actual accrual detail from calculation engine
  const [accrualEmployees, setAccrualEmployees] = useState<AccrualEmployee[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [empWarnings, setEmpWarnings] = useState<string[]>([]);
  const [empLoadedPeriod, setEmpLoadedPeriod] = useState<string>("");

  // Manual add dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualType, setManualType] = useState("wages");
  const [manualDesc, setManualDesc] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  // --- Data Loading ---

  const loadAccruals = useCallback(async () => {
    setLoading(true);

    const { data: acc } = await supabase
      .from("payroll_accruals")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .order("accrual_type")
      .order("description");

    setAccruals((acc as unknown as PayrollAccrual[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  const loadEmployees = useCallback(async () => {
    const periodKey = `${periodYear}-${periodMonth}`;
    if (empLoadedPeriod === periodKey && accrualEmployees.length > 0) return;
    setEmpLoading(true);
    try {
      const res = await fetch(
        `/api/paylocity/accrual-detail?year=${periodYear}&month=${periodMonth}`
      );
      if (res.ok) {
        const data = await res.json();
        setAccrualEmployees(data.employees ?? []);
        setEmpWarnings(data.warnings ?? []);
        setEmpLoadedPeriod(periodKey);
      }
    } catch {
      // silent fail
    }
    setEmpLoading(false);
  }, [periodYear, periodMonth, empLoadedPeriod, accrualEmployees.length]);

  useEffect(() => {
    loadAccruals();
  }, [loadAccruals]);

  // Filter accrual employees for this entity
  const entityEmployees = useMemo(() => {
    const filtered = accrualEmployees.filter((e) => e.operatingEntityId === entityId);
    if (!empSearch) return filtered;
    const q = empSearch.toLowerCase();
    return filtered.filter(
      (e) =>
        (e.displayName ?? "").toLowerCase().includes(q) ||
        (e.jobTitle ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
    );
  }, [accrualEmployees, entityId, empSearch]);

  const entityTotalComp = entityEmployees.reduce((s, e) => s + e.annualComp, 0);
  const entityTotalWageAccrual = entityEmployees.reduce((s, e) => s + e.wageAccrual, 0);
  const entityTotalTaxAccrual = entityEmployees.reduce((s, e) => s + e.taxAccrual, 0);
  const entityTotalBenefitAccrual = entityEmployees.reduce((s, e) => s + (e.benefitAccrual ?? 0), 0);
  const entityTotalAccrual = entityTotalWageAccrual + entityTotalTaxAccrual + entityTotalBenefitAccrual;

  // --- Handlers ---

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/paylocity/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodYear, periodMonth }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Sync failed");
      } else {
        toast.success(
          `Synced ${json.employeeCount} employees — wages: ${formatCurrency(json.totalWageAccrual)}, tax: ${formatCurrency(json.totalTaxAccrual)}`
        );
        loadAccruals();
      }
    } catch {
      toast.error("Sync failed — network error");
    }
    setSyncing(false);
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    setAddingManual(true);

    const amount = parseFloat(manualAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error("Invalid amount");
      setAddingManual(false);
      return;
    }

    const { error } = await supabase.from("payroll_accruals").upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        accrual_type: manualType,
        description:
          manualDesc || `${TYPE_LABELS[manualType]} - ${periodMonth}/${periodYear}`,
        amount,
        source: "manual",
        status: "draft",
        notes: manualNotes || null,
      },
      {
        onConflict:
          "entity_id,period_year,period_month,accrual_type,description",
      }
    );

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Manual accrual added");
      setDialogOpen(false);
      setManualDesc("");
      setManualAmount("");
      setManualNotes("");
      loadAccruals();
    }
    setAddingManual(false);
  }

  // --- Computed ---

  const totals = accruals.reduce(
    (acc, a) => {
      acc[a.accrual_type] = (acc[a.accrual_type] ?? 0) + a.amount;
      acc.total += a.amount;
      return acc;
    },
    { total: 0 } as Record<string, number>
  );

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payroll Accruals</h1>
          <p className="text-muted-foreground">
            Accrued costs, employee calculations, and payroll cost allocation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${entityId}/employees/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="accruals" className="space-y-4">
        <TabsList>
          <TabsTrigger value="accruals">Accruals</TabsTrigger>
          <TabsTrigger value="employees" onClick={loadEmployees}>
            Employee Detail
          </TabsTrigger>
        </TabsList>

        {/* Accruals Tab */}
        <TabsContent value="accruals" className="space-y-4">
          {/* Period Selector + Actions */}
          <div className="flex items-center gap-4">
            <Select
              value={String(periodYear)}
              onValueChange={(v) => setPeriodYear(Number(v))}
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
            <Select
              value={String(periodMonth)}
              onValueChange={(v) => setPeriodMonth(Number(v))}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {getPeriodLabel(current.year, m).split(" ")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {getPeriodLabel(periodYear, periodMonth)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing..." : "Sync from Paylocity"}
              </Button>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Manual
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Manual Accrual</DialogTitle>
                    <DialogDescription>
                      Add a manual payroll accrual entry for{" "}
                      {getPeriodLabel(periodYear, periodMonth)}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleAddManual} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Accrual Type</Label>
                      <Select value={manualType} onValueChange={setManualType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="wages">Accrued Wages</SelectItem>
                          <SelectItem value="payroll_tax">Payroll Tax</SelectItem>
                          <SelectItem value="pto">PTO Liability</SelectItem>
                          <SelectItem value="benefits">Benefits</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input
                        placeholder="e.g., Accrued Wages - Jan 16-31"
                        value={manualDesc}
                        onChange={(e) => setManualDesc(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea
                        placeholder="Optional notes..."
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={addingManual}>
                      {addingManual ? "Adding..." : "Add Accrual"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Accrued Wages</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(totals["wages"] ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Payroll Tax</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(totals["payroll_tax"] ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">PTO Liability</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(totals["pto"] ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Total Accruals</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(totals.total)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Accruals Table */}
          <Card>
            <CardHeader>
              <CardTitle>Accrual Entries</CardTitle>
              <CardDescription>
                {accruals.length} entr{accruals.length !== 1 ? "ies" : "y"} for{" "}
                {getPeriodLabel(periodYear, periodMonth)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : accruals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Accruals</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    Sync from Paylocity or add manual accrual entries for this period.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accruals.map((a) => {
                      const Icon = TYPE_ICONS[a.accrual_type] ?? DollarSign;
                      return (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {TYPE_LABELS[a.accrual_type] ?? a.accrual_type}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{a.description}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatCurrency(a.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {a.source === "paylocity_sync" ? "Paylocity" : "Manual"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANTS[a.status] ?? "outline"}>
                              {STATUS_LABELS[a.status] ?? a.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                            {a.notes ?? "---"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-semibold border-t-2">
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(totals.total)}
                      </TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Employee Detail Tab */}
        <TabsContent value="employees" className="space-y-4">
          {empLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Calculating accruals from Paylocity data...
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This may take a moment (fetching pay statements for YTD caps)
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Employee Summary */}
              <div className="grid grid-cols-6 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Employees</p>
                    </div>
                    <p className="text-2xl font-semibold mt-1">
                      {entityEmployees.length}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Annual Payroll</p>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {formatComp(entityTotalComp)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Accrued Wages</p>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {formatCurrency(entityTotalWageAccrual)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Employer Taxes</p>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {formatCurrency(entityTotalTaxAccrual)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">ER Benefits</p>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {formatCurrency(entityTotalBenefitAccrual)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Total Cost</p>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {formatCurrency(entityTotalAccrual)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Wages + Tax + Benefits
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Warnings */}
              {empWarnings.length > 0 && (
                <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950">
                  <CardContent className="pt-4 pb-3">
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                      {empWarnings.length} warning{empWarnings.length !== 1 ? "s" : ""}
                    </p>
                    <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-0.5">
                      {empWarnings.slice(0, 5).map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                      {empWarnings.length > 5 && (
                        <li>...and {empWarnings.length - 5} more</li>
                      )}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Search + Refresh */}
              <div className="flex items-center gap-3">
                <div className="relative max-w-md flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search employees..."
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmpLoadedPeriod("");
                    loadEmployees();
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Recalculate
                </Button>
              </div>

              {/* Employee Accruals Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Employee Accrual Detail</CardTitle>
                  <CardDescription>
                    {entityEmployees.length} employee{entityEmployees.length !== 1 ? "s" : ""} — calculated for {getPeriodLabel(periodYear, periodMonth)} using working-day pro-rata and YTD tax caps
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {entityEmployees.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Users className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">No Employees</h3>
                      <p className="text-muted-foreground text-center">
                        No employees are assigned to this entity via cost centers.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Pay Type</TableHead>
                            <TableHead className="text-right">Annual Comp</TableHead>
                            <TableHead className="text-right">Daily Rate</TableHead>
                            <TableHead className="text-right">Accrual Days</TableHead>
                            <TableHead className="text-right">Accrued Wages</TableHead>
                            <TableHead className="text-right">Employer Tax</TableHead>
                            <TableHead className="text-right" title="Employer-paid benefits (medical, 401k match, etc.) pro-rated for the accrual period">ER Benefits</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entityEmployees.map((emp) => (
                            <TableRow key={emp.id} title={
                              Object.entries(emp.taxBreakdown ?? {})
                                .map(([k, v]) => `${k}: $${v.toFixed(2)}`)
                                .join(", ")
                            }>
                              <TableCell className="font-medium">
                                {emp.displayName}
                              </TableCell>
                              <TableCell>{emp.department}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    emp.payType === "Salary" ? "default" : "secondary"
                                  }
                                >
                                  {emp.payType}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatComp(emp.annualComp)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground text-xs">
                                {formatCurrency(emp.dailyRate)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {emp.accrualDays}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(emp.wageAccrual)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(emp.taxAccrual)}
                              </TableCell>
                              <TableCell className="text-right font-mono" title={
                                Object.entries(emp.benefitBreakdown ?? {})
                                  .map(([k, v]) => `${k}: $${v.toFixed(2)}`)
                                  .join(", ") || "No employer benefits"
                              }>
                                {formatCurrency(emp.benefitAccrual ?? 0)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {formatCurrency(emp.totalAccrual)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="font-semibold border-t-2">
                            <TableCell colSpan={3}>Total</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatComp(entityTotalComp)}
                            </TableCell>
                            <TableCell colSpan={2} />
                            <TableCell className="text-right font-mono">
                              {formatCurrency(entityTotalWageAccrual)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(entityTotalTaxAccrual)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(entityTotalBenefitAccrual)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(entityTotalAccrual)}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
