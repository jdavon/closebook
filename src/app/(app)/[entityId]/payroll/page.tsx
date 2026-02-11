"use client";

import { useState, useEffect, useCallback } from "react";
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
import { toast } from "sonner";
import {
  RefreshCw,
  Settings,
  Plus,
  DollarSign,
  Users,
  Clock,
  Banknote,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";

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

interface PaylocityConnection {
  id: string;
  company_id: string;
  environment: string;
  sync_status: string;
  last_sync_at: string | null;
  sync_error: string | null;
}

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

export default function PayrollPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const current = getCurrentPeriod();
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  const [accruals, setAccruals] = useState<PayrollAccrual[]>([]);
  const [connection, setConnection] = useState<PaylocityConnection | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Manual add dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualType, setManualType] = useState("wages");
  const [manualDesc, setManualDesc] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    // Load connection
    const { data: conn } = await supabase
      .from("paylocity_connections")
      .select("id, company_id, environment, sync_status, last_sync_at, sync_error")
      .eq("entity_id", entityId)
      .single();

    setConnection((conn as unknown as PaylocityConnection) ?? null);

    // Load accruals for period
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

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSync() {
    setSyncing(true);

    try {
      const res = await fetch("/api/paylocity/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, periodYear, periodMonth }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Sync failed");
      } else {
        toast.success(
          `Synced ${json.employeesSynced} employees — wages: ${formatCurrency(json.accruals.wages)}, tax: ${formatCurrency(json.accruals.payrollTax)}`
        );
        loadData();
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
      loadData();
    }

    setAddingManual(false);
  }

  // Group totals by type
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payroll Accruals
          </h1>
          <p className="text-muted-foreground">
            Accrued wages, payroll taxes, and PTO liability
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${entityId}/payroll/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
          {connection && (
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
          )}
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

      {/* Connection Status */}
      {!connection && (
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">Paylocity Not Connected</p>
                <p className="text-sm text-muted-foreground">
                  Connect your Paylocity account to auto-sync payroll accruals,
                  or add entries manually.
                </p>
              </div>
              <Link href={`/${entityId}/payroll/settings`} className="ml-auto">
                <Button variant="outline">Connect</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {connection?.sync_error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              Last sync error: {connection.sync_error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Period Selector */}
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
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : accruals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Accruals</h3>
              <p className="text-muted-foreground text-center mb-4">
                {connection
                  ? "Sync from Paylocity or add manual accrual entries."
                  : "Connect Paylocity or add manual accrual entries for this period."}
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
                          {a.source === "paylocity_sync"
                            ? "Paylocity"
                            : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANTS[a.status] ?? "outline"}
                        >
                          {STATUS_LABELS[a.status] ?? a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                        {a.notes ?? "---"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Total Row */}
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
    </div>
  );
}
