"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { toast } from "sonner";
import {
  Upload,
  Landmark,
  DollarSign,
  ArrowRight,
  TrendingDown,
  Percent,
  CreditCard,
} from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import type { DebtStatus } from "@/lib/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInstrument = any;

interface AmortizationPeriod {
  debt_instrument_id: string;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
  interest_rate: number | null;
}

interface GLBalance {
  account_id: string;
  ending_balance: number;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  active: "Active",
  paid_off: "Paid Off",
  inactive: "Inactive",
};

const STATUS_VARIANTS: Record<DebtStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  paid_off: "secondary",
  inactive: "outline",
};

const TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  revolving_credit: "Revolving Credit",
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

const PAYMENT_STRUCTURE_LABELS: Record<string, string> = {
  principal_and_interest: "P&I",
  interest_only: "Interest Only",
  balloon: "Balloon",
  custom: "Custom",
  revolving: "Revolving",
};

export default function DebtPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = getCurrentPeriod();
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  const [instruments, setInstruments] = useState<AnyInstrument[]>([]);
  const [amortization, setAmortization] = useState<
    Record<string, AmortizationPeriod>
  >({});
  const [glBalances, setGLBalances] = useState<GLBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: instrData } = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("entity_id", entityId)
      .order("instrument_name");

    const instr = (instrData ?? []) as AnyInstrument[];
    setInstruments(instr);

    if (instr.length > 0) {
      const instrIds = instr.map((i: AnyInstrument) => i.id);
      const { data: amortData } = await supabase
        .from("debt_amortization")
        .select(
          "debt_instrument_id, beginning_balance, payment, principal, interest, ending_balance, interest_rate"
        )
        .in("debt_instrument_id", instrIds)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth);

      const amortMap: Record<string, AmortizationPeriod> = {};
      if (amortData) {
        for (const row of amortData as unknown as AmortizationPeriod[]) {
          amortMap[row.debt_instrument_id] = row;
        }
      }
      setAmortization(amortMap);

      const liabilityAccountIds = instr
        .map((i: AnyInstrument) => i.liability_account_id)
        .filter((id: string | null): id is string => id !== null);

      if (liabilityAccountIds.length > 0) {
        const { data: glData } = await supabase
          .from("gl_balances")
          .select("account_id, ending_balance")
          .eq("entity_id", entityId)
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth)
          .in("account_id", liabilityAccountIds);

        setGLBalances((glData as unknown as GLBalance[]) ?? []);
      } else {
        setGLBalances([]);
      }
    } else {
      setAmortization({});
      setGLBalances([]);
    }

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", entityId);

    try {
      const res = await fetch("/api/debt/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Upload failed");
        if (json.errors?.length > 0) {
          json.errors.slice(0, 5).forEach((err: string) => toast.warning(err));
        }
      } else {
        toast.success(
          `Imported ${json.imported} instrument${json.imported !== 1 ? "s" : ""}${
            json.skipped > 0 ? ` (${json.skipped} skipped)` : ""
          }`
        );
        if (json.errors?.length > 0) {
          json.errors.slice(0, 5).forEach((err: string) => toast.warning(err));
        }
        loadData();
      }
    } catch {
      toast.error("Upload failed — network error");
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Compute summary totals
  const activeInstruments = instruments.filter((i: AnyInstrument) => i.status === "active");
  const totalOutstanding = Object.values(amortization).reduce(
    (sum, a) => sum + a.ending_balance,
    0
  );
  const totalPrincipal = Object.values(amortization).reduce(
    (sum, a) => sum + a.principal,
    0
  );
  const totalInterest = Object.values(amortization).reduce(
    (sum, a) => sum + a.interest,
    0
  );
  const totalPayment = Object.values(amortization).reduce(
    (sum, a) => sum + a.payment,
    0
  );

  // Current / Long-term split
  const totalCurrentPortion = instruments.reduce(
    (sum: number, i: AnyInstrument) => sum + (i.current_portion ?? 0),
    0
  );
  const totalLongTermPortion = instruments.reduce(
    (sum: number, i: AnyInstrument) => sum + (i.long_term_portion ?? 0),
    0
  );

  // Credit utilization for LOCs
  const locTypes = ["line_of_credit", "revolving_credit"];
  const totalCreditLimit = instruments
    .filter((i: AnyInstrument) => locTypes.includes(i.debt_type))
    .reduce((sum: number, i: AnyInstrument) => sum + (i.credit_limit ?? 0), 0);
  const totalCreditUsed = instruments
    .filter((i: AnyInstrument) => locTypes.includes(i.debt_type))
    .reduce((sum: number, i: AnyInstrument) => sum + (i.current_draw ?? 0), 0);
  const creditUtilization =
    totalCreditLimit > 0 ? (totalCreditUsed / totalCreditLimit) * 100 : 0;

  // Weighted average interest rate
  const totalWeightedRate = instruments
    .filter((i: AnyInstrument) => i.status === "active")
    .reduce((sum: number, i: AnyInstrument) => {
      const balance =
        amortization[i.id]?.ending_balance ?? i.current_draw ?? i.original_amount;
      return sum + i.interest_rate * balance;
    }, 0);
  const weightedAvgRate =
    totalOutstanding > 0 ? totalWeightedRate / totalOutstanding : 0;

  // GL comparison
  const glTotal = glBalances.reduce(
    (sum, gl) => sum + Math.abs(gl.ending_balance),
    0
  );
  const glVariance = totalOutstanding - glTotal;
  const hasGLData = glBalances.length > 0;

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Debt Schedule
          </h1>
          <p className="text-muted-foreground">
            Track loans, lines of credit, and amortization schedules
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Importing..." : "Import Spreadsheet"}
          </Button>
        </div>
      </div>

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

      {/* Summary Cards — Row 1: Core Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Total Outstanding
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(totalOutstanding)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeInstruments.length} active instrument
              {activeInstruments.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Monthly Payment</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(totalPayment)}
            </p>
            <div className="flex gap-4 text-xs text-muted-foreground mt-1">
              <span>P: {formatCurrency(totalPrincipal)}</span>
              <span>I: {formatCurrency(totalInterest)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Wtd Avg Rate</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatPercentage(weightedAvgRate, 2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Credit Utilization</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {totalCreditLimit > 0
                ? `${creditUtilization.toFixed(1)}%`
                : "N/A"}
            </p>
            {totalCreditLimit > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(totalCreditUsed)} / {formatCurrency(totalCreditLimit)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards — Row 2: Classification */}
      {(totalCurrentPortion > 0 || totalLongTermPortion > 0) && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Current Portion ({"<"}12 mo)
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalCurrentPortion)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Long-Term Portion
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalLongTermPortion)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Total Debt
              </p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {formatCurrency(totalCurrentPortion + totalLongTermPortion)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* GL Comparison */}
      {hasGLData && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  GL Comparison — {getPeriodLabel(periodYear, periodMonth)}
                </p>
                <div className="flex items-center gap-6 mt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Schedule Total
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatCurrency(totalOutstanding)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">GL Balance</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatCurrency(glTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Variance</p>
                    <p
                      className={`text-lg font-semibold tabular-nums ${
                        glVariance === 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(glVariance)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instruments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Debt Instruments</CardTitle>
          <CardDescription>
            {instruments.length} instrument
            {instruments.length !== 1 ? "s" : ""} for{" "}
            {getPeriodLabel(periodYear, periodMonth)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : instruments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Landmark className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Debt Instruments</h3>
              <p className="text-muted-foreground text-center mb-4">
                Upload a spreadsheet with your loan and line of credit data to
                start tracking debt.
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Spreadsheet
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Lender</TableHead>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Structure</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Original / Limit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instruments.map((instr: AnyInstrument) => {
                    const amort = amortization[instr.id];
                    const isLOC = locTypes.includes(instr.debt_type);
                    return (
                      <TableRow key={instr.id}>
                        <TableCell className="font-medium">
                          {instr.instrument_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {instr.lender_name ?? "---"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs font-mono">
                          {instr.loan_number ?? "---"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {TYPE_LABELS[instr.debt_type] ?? instr.debt_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {PAYMENT_STRUCTURE_LABELS[instr.payment_structure] ??
                              instr.payment_structure ?? "P&I"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>
                            {amort?.interest_rate != null
                              ? formatPercentage(amort.interest_rate, 2)
                              : formatPercentage(instr.interest_rate, 2)}
                          </div>
                          {instr.rate_type && instr.rate_type !== "fixed" && (
                            <span className="text-xs text-muted-foreground">
                              {instr.rate_type}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {isLOC && instr.credit_limit
                            ? formatCurrency(instr.credit_limit)
                            : formatCurrency(instr.original_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {amort
                            ? formatCurrency(amort.ending_balance)
                            : "---"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amort ? formatCurrency(amort.payment) : "---"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amort ? formatCurrency(amort.principal) : "---"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amort ? formatCurrency(amort.interest) : "---"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              STATUS_VARIANTS[instr.status as DebtStatus] ?? "outline"
                            }
                          >
                            {STATUS_LABELS[instr.status as DebtStatus] ?? instr.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/${entityId}/debt/${instr.id}`}>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals Row */}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={7}>Totals</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalOutstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalPayment)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalPrincipal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalInterest)}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
