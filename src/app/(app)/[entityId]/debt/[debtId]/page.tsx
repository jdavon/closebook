"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Link as LinkIcon,
  Calculator,
  ArrowUpDown,
  History,
  FileText,
} from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import {
  generateWhatIfSchedule,
  summarizeSchedule,
} from "@/lib/utils/amortization";
import type { DebtStatus } from "@/lib/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

interface FixedAssetRef {
  id: string;
  asset_name: string;
  asset_tag: string | null;
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
  principal_and_interest: "Principal & Interest",
  interest_only: "Interest Only",
  balloon: "Balloon",
  custom: "Custom",
  revolving: "Revolving",
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  advance: "Advance / Draw",
  principal_payment: "Principal Payment",
  interest_payment: "Interest Payment",
  fee_payment: "Fee Payment",
  late_fee: "Late Fee",
  misc_fee: "Misc Fee",
  origination_fee: "Origination Fee",
  annual_fee: "Annual Fee",
  payment_reversal: "Payment Reversal",
  note_renewal: "Note Renewal",
  payoff: "Payoff",
  adjustment: "Adjustment",
};

const TRANSACTION_TYPE_COLORS: Record<string, string> = {
  advance: "text-red-600",
  principal_payment: "text-green-600",
  interest_payment: "text-amber-600",
  fee_payment: "text-amber-600",
  late_fee: "text-red-500",
  misc_fee: "text-red-500",
  payment_reversal: "text-red-600",
  note_renewal: "text-blue-600",
  payoff: "text-green-700",
  adjustment: "text-muted-foreground",
};

export default function DebtDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const debtId = params.debtId as string;
  const router = useRouter();
  const supabase = createClient();

  const [instrument, setInstrument] = useState<AnyRow | null>(null);
  const [amortization, setAmortization] = useState<AnyRow[]>([]);
  const [rateHistory, setRateHistory] = useState<AnyRow[]>([]);
  const [transactions, setTransactions] = useState<AnyRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAsset, setLinkedAsset] = useState<FixedAssetRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // GL linkage
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [interestAccountId, setInterestAccountId] = useState("");
  const [currentLiabilityAccountId, setCurrentLiabilityAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");

  // What-if scenario
  const [whatIfRate, setWhatIfRate] = useState("");
  const [whatIfTerm, setWhatIfTerm] = useState("");
  const [showWhatIf, setShowWhatIf] = useState(false);

  const loadData = useCallback(async () => {
    // Fetch instrument
    const instrResult = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("id", debtId)
      .single();

    // Fetch amortization
    const amortResult = await supabase
      .from("debt_amortization")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("period_year")
      .order("period_month");

    // Fetch accounts
    const accountsResult = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    // Fetch rate history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rateResult = await (supabase as any)
      .from("debt_rate_history")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("effective_date", { ascending: true });

    // Fetch transactions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txnResult = await (supabase as any)
      .from("debt_transactions")
      .select("*")
      .eq("debt_instrument_id", debtId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });

    const instr = instrResult.data as AnyRow;
    if (instr) {
      setInstrument(instr);
      setLiabilityAccountId(instr.liability_account_id ?? "");
      setInterestAccountId(instr.interest_expense_account_id ?? "");
      setCurrentLiabilityAccountId(instr.current_liability_account_id ?? "");
      setFeeAccountId(instr.fee_expense_account_id ?? "");

      if (instr.fixed_asset_id) {
        const { data: assetData } = await supabase
          .from("fixed_assets")
          .select("id, asset_name, asset_tag")
          .eq("id", instr.fixed_asset_id)
          .single();
        setLinkedAsset((assetData as unknown as FixedAssetRef) ?? null);
      }
    }

    setAmortization((amortResult.data as AnyRow[]) ?? []);
    setRateHistory((rateResult.data as AnyRow[]) ?? []);
    setTransactions((txnResult.data as AnyRow[]) ?? []);
    setAccounts((accountsResult.data as Account[]) ?? []);
    setLoading(false);
  }, [supabase, debtId, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveAccounts() {
    if (!instrument) return;
    setSaving(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("debt_instruments")
      .update({
        liability_account_id: liabilityAccountId || null,
        interest_expense_account_id: interestAccountId || null,
        current_liability_account_id: currentLiabilityAccountId || null,
        fee_expense_account_id: feeAccountId || null,
      })
      .eq("id", debtId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("GL accounts updated");
      loadData();
    }
    setSaving(false);
  }

  // What-if amortization schedule
  const whatIfSchedule = useMemo(() => {
    if (!instrument || !showWhatIf) return [];
    const rate = parseFloat(whatIfRate);
    const term = parseInt(whatIfTerm);
    if (isNaN(rate) || rate <= 0 || isNaN(term) || term <= 0) return [];

    return generateWhatIfSchedule({
      principal: amortization.length > 0
        ? amortization[amortization.length - 1].ending_balance
        : instrument.original_amount,
      annualRate: rate / 100,
      termMonths: term,
      startDate: new Date().toISOString().split("T")[0],
      paymentStructure: instrument.payment_structure ?? "principal_and_interest",
      dayCountConvention: instrument.day_count_convention ?? "30/360",
    });
  }, [instrument, showWhatIf, whatIfRate, whatIfTerm, amortization]);

  const whatIfSummary = useMemo(() => {
    if (whatIfSchedule.length === 0) return null;
    return summarizeSchedule(whatIfSchedule);
  }, [whatIfSchedule]);

  if (loading)
    return <p className="text-muted-foreground p-6">Loading...</p>;
  if (!instrument)
    return <p className="text-muted-foreground p-6">Instrument not found</p>;

  const liabilityAccounts = accounts.filter(
    (a) => a.classification === "Liability"
  );
  const expenseAccounts = accounts.filter(
    (a) => a.classification === "Expense"
  );

  const latestAmort =
    amortization.length > 0 ? amortization[amortization.length - 1] : null;

  const totalInterest = amortization.reduce((sum: number, a: AnyRow) => sum + a.interest, 0);
  const totalPrincipal = amortization.reduce((sum: number, a: AnyRow) => sum + a.principal, 0);
  const totalFees = amortization.reduce((sum: number, a: AnyRow) => sum + (a.fees ?? 0), 0);

  const isLOC = ["line_of_credit", "revolving_credit"].includes(instrument.debt_type);

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString() : "---";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/debt`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {instrument.instrument_name}
            </h1>
            <Badge variant={STATUS_VARIANTS[instrument.status as DebtStatus] ?? "outline"}>
              {STATUS_LABELS[instrument.status as DebtStatus] ?? instrument.status}
            </Badge>
            <Badge variant="outline">
              {TYPE_LABELS[instrument.debt_type] ?? instrument.debt_type}
            </Badge>
            {instrument.payment_structure && (
              <Badge variant="outline">
                {PAYMENT_STRUCTURE_LABELS[instrument.payment_structure] ??
                  instrument.payment_structure}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-muted-foreground mt-1">
            {instrument.lender_name && (
              <span>Lender: {instrument.lender_name}</span>
            )}
            {instrument.loan_number && (
              <span className="font-mono text-sm">
                Loan #{instrument.loan_number}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40 flex-wrap">
        <div>
          <span className="text-sm text-muted-foreground">
            {isLOC ? "Credit Limit" : "Original Amount"}
          </span>
          <p className="text-lg font-semibold tabular-nums">
            {isLOC && instrument.credit_limit
              ? formatCurrency(instrument.credit_limit)
              : formatCurrency(instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">
            {isLOC ? "Outstanding Draw" : "Current Balance"}
          </span>
          <p className="text-lg font-semibold tabular-nums">
            {latestAmort
              ? formatCurrency(latestAmort.ending_balance)
              : formatCurrency(instrument.current_draw ?? instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Interest Rate</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatPercentage(
              latestAmort?.interest_rate ?? instrument.interest_rate,
              2
            )}
            {instrument.rate_type && instrument.rate_type !== "fixed" && (
              <span className="text-xs text-muted-foreground ml-1">
                ({instrument.rate_type})
              </span>
            )}
          </p>
        </div>
        {instrument.term_months && (
          <div>
            <span className="text-sm text-muted-foreground">Term</span>
            <p className="text-lg font-semibold">
              {instrument.term_months} mo ({(instrument.term_months / 12).toFixed(1)} yr)
            </p>
          </div>
        )}
        {instrument.maturity_date && (
          <div>
            <span className="text-sm text-muted-foreground">Maturity</span>
            <p className="text-lg font-semibold">
              {formatDate(instrument.maturity_date)}
            </p>
          </div>
        )}
        {instrument.payment_amount && (
          <div>
            <span className="text-sm text-muted-foreground">Payment</span>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(instrument.payment_amount)}
            </p>
          </div>
        )}
        <div>
          <span className="text-sm text-muted-foreground">Day Count</span>
          <p className="text-lg font-semibold">{instrument.day_count_convention ?? "30/360"}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">
            <FileText className="h-4 w-4 mr-1" />
            Details
          </TabsTrigger>
          <TabsTrigger value="rates">
            <History className="h-4 w-4 mr-1" />
            Rate History ({rateHistory.length})
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <ArrowUpDown className="h-4 w-4 mr-1" />
            Transactions ({transactions.length})
          </TabsTrigger>
          <TabsTrigger value="amortization">Amortization ({amortization.length})</TabsTrigger>
          <TabsTrigger value="whatif">
            <Calculator className="h-4 w-4 mr-1" />
            What-If
          </TabsTrigger>
        </TabsList>

        {/* TAB: Details */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Instrument Details</CardTitle>
                <CardDescription>Loan terms and identifiers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Type</span>
                    <p className="font-medium">{TYPE_LABELS[instrument.debt_type] ?? instrument.debt_type}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payment Structure</span>
                    <p className="font-medium">{PAYMENT_STRUCTURE_LABELS[instrument.payment_structure] ?? instrument.payment_structure ?? "P&I"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Start Date</span>
                    <p className="font-medium">{formatDate(instrument.start_date)}</p>
                  </div>
                  {instrument.maturity_date && (
                    <div>
                      <span className="text-muted-foreground">Maturity Date</span>
                      <p className="font-medium">{formatDate(instrument.maturity_date)}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Interest Rate</span>
                    <p className="font-medium tabular-nums">
                      {formatPercentage(instrument.interest_rate, 2)}
                      {instrument.rate_type && instrument.rate_type !== "fixed" && (
                        <span className="text-muted-foreground ml-1">
                          ({instrument.rate_type}
                          {instrument.index_rate_name ? ` — ${instrument.index_rate_name}` : ""}
                          {instrument.spread_margin ? ` + ${formatPercentage(instrument.spread_margin, 2)}` : ""}
                          )
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Day Count</span>
                    <p className="font-medium">{instrument.day_count_convention ?? "30/360"}</p>
                  </div>
                  {instrument.term_months && (
                    <div>
                      <span className="text-muted-foreground">Term</span>
                      <p className="font-medium">{instrument.term_months} months ({(instrument.term_months / 12).toFixed(1)} years)</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Total Principal Paid</span>
                    <p className="font-medium tabular-nums">{formatCurrency(totalPrincipal)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Interest Paid</span>
                    <p className="font-medium tabular-nums">{formatCurrency(totalInterest)}</p>
                  </div>
                  {totalFees > 0 && (
                    <div>
                      <span className="text-muted-foreground">Total Fees</span>
                      <p className="font-medium tabular-nums">{formatCurrency(totalFees)}</p>
                    </div>
                  )}
                </div>

                {instrument.is_renewable && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Renewal</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {instrument.last_renewal_date && (
                        <div>
                          <span className="text-muted-foreground">Last Renewal</span>
                          <p className="font-medium">{formatDate(instrument.last_renewal_date)}</p>
                        </div>
                      )}
                      {instrument.next_renewal_date && (
                        <div>
                          <span className="text-muted-foreground">Next Renewal</span>
                          <p className="font-medium">{formatDate(instrument.next_renewal_date)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {instrument.is_secured && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Collateral</p>
                    <p className="text-sm">{instrument.collateral_description ?? "Secured — no description"}</p>
                  </div>
                )}

                {linkedAsset && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <LinkIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Linked Asset:</span>
                      <span className="font-medium">
                        {linkedAsset.asset_tag ? `${linkedAsset.asset_tag} — ` : ""}
                        {linkedAsset.asset_name}
                      </span>
                    </div>
                  </div>
                )}

                {(instrument.current_portion != null && instrument.current_portion > 0) && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Balance Sheet Classification</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Current Portion</span>
                        <p className="font-medium tabular-nums">{formatCurrency(instrument.current_portion ?? 0)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Long-Term Portion</span>
                        <p className="font-medium tabular-nums">{formatCurrency(instrument.long_term_portion ?? 0)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {instrument.source_file_name && (
                  <div className="mt-4 pt-4 border-t">
                    <span className="text-muted-foreground text-sm">Source File</span>
                    <p className="font-medium text-xs">
                      {instrument.source_file_name}
                      {instrument.uploaded_at && ` — ${new Date(instrument.uploaded_at).toLocaleString()}`}
                    </p>
                  </div>
                )}

                {instrument.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <span className="text-muted-foreground text-sm">Notes</span>
                    <p className="text-sm whitespace-pre-wrap mt-1">{instrument.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* GL Account Linkage */}
            <Card>
              <CardHeader>
                <CardTitle>GL Accounts</CardTitle>
                <CardDescription>Chart of accounts linkage for journal entries</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Long-Term Liability Account</Label>
                  <Select value={liabilityAccountId} onValueChange={setLiabilityAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select liability account..." /></SelectTrigger>
                    <SelectContent>
                      {liabilityAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_number ? `${a.account_number} - ${a.name}` : a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Current Portion Liability Account</Label>
                  <Select value={currentLiabilityAccountId} onValueChange={setCurrentLiabilityAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select current liability account..." /></SelectTrigger>
                    <SelectContent>
                      {liabilityAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_number ? `${a.account_number} - ${a.name}` : a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Interest Expense Account</Label>
                  <Select value={interestAccountId} onValueChange={setInterestAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select expense account..." /></SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_number ? `${a.account_number} - ${a.name}` : a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fee Expense Account</Label>
                  <Select value={feeAccountId} onValueChange={setFeeAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select fee expense account..." /></SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_number ? `${a.account_number} - ${a.name}` : a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSaveAccounts} disabled={saving} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : "Save GL Accounts"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB: Rate History */}
        <TabsContent value="rates">
          <Card>
            <CardHeader>
              <CardTitle>Rate History</CardTitle>
              <CardDescription>
                {rateHistory.length} rate change{rateHistory.length !== 1 ? "s" : ""} recorded
                {instrument.rate_type !== "fixed" && instrument.index_rate_name && (
                  <span> — Index: {instrument.index_rate_name}
                    {instrument.spread_margin ? ` + ${formatPercentage(instrument.spread_margin, 2)} spread` : ""}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rateHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No rate changes recorded. For variable rate instruments, rate changes will appear here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective Date</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Index</TableHead>
                      <TableHead className="text-right">Spread</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateHistory.map((rate: AnyRow) => (
                      <TableRow key={rate.id}>
                        <TableCell className="font-medium">{formatDate(rate.effective_date)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatPercentage(rate.interest_rate, 3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rate.index_rate != null ? formatPercentage(rate.index_rate, 3) : "---"}</TableCell>
                        <TableCell className="text-right tabular-nums">{rate.spread != null ? formatPercentage(rate.spread, 3) : "---"}</TableCell>
                        <TableCell className="text-muted-foreground">{rate.change_reason ?? "---"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{rate.notes ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Transactions */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Transaction Ledger</CardTitle>
              <CardDescription>
                {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} — draws, payments, fees, and adjustments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No transactions recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">To Principal</TableHead>
                        <TableHead className="text-right">To Interest</TableHead>
                        <TableHead className="text-right">To Fees</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Ref #</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((txn: AnyRow) => (
                        <TableRow key={txn.id}>
                          <TableCell className="font-medium whitespace-nowrap">{formatDate(txn.effective_date)}</TableCell>
                          <TableCell>
                            <span className={`text-sm font-medium ${TRANSACTION_TYPE_COLORS[txn.transaction_type] ?? ""}`}>
                              {TRANSACTION_TYPE_LABELS[txn.transaction_type] ?? txn.transaction_type}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{txn.description ?? "---"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatCurrency(txn.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_principal ? formatCurrency(txn.to_principal) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_interest ? formatCurrency(txn.to_interest) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums">{txn.to_fees ? formatCurrency(txn.to_fees) : "---"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{txn.running_balance != null ? formatCurrency(txn.running_balance) : "---"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{txn.reference_number ?? ""}</TableCell>
                          <TableCell>
                            {txn.is_reconciled && <Badge variant="secondary" className="text-xs">Reconciled</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Amortization Schedule */}
        <TabsContent value="amortization">
          <Card>
            <CardHeader>
              <CardTitle>Amortization Schedule</CardTitle>
              <CardDescription>{amortization.length} period{amortization.length !== 1 ? "s" : ""} generated</CardDescription>
            </CardHeader>
            <CardContent>
              {amortization.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No amortization entries. The schedule will be generated when instrument data is uploaded.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Beg Balance</TableHead>
                        <TableHead className="text-right">Payment</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead className="text-right">End Balance</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {amortization.map((row: AnyRow) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{getPeriodShortLabel(row.period_year, row.period_month)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.beginning_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.payment)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.principal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.interest)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatCurrency(row.ending_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.interest_rate != null ? formatPercentage(row.interest_rate, 2) : "---"}
                          </TableCell>
                          <TableCell>
                            {row.is_manual_override && <Badge variant="secondary" className="text-xs">Override</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Totals</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">{formatCurrency(amortization.reduce((s: number, r: AnyRow) => s + r.payment, 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(totalPrincipal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(totalInterest)}</TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: What-If Scenario */}
        <TabsContent value="whatif">
          <Card>
            <CardHeader>
              <CardTitle>What-If Amortization</CardTitle>
              <CardDescription>Model different rate and term scenarios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label>Annual Rate (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={`Current: ${(instrument.interest_rate * 100).toFixed(2)}`}
                    value={whatIfRate}
                    onChange={(e) => setWhatIfRate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Term (months)</Label>
                  <Input
                    type="number"
                    step="1"
                    placeholder={`Current: ${instrument.term_months ?? 60}`}
                    value={whatIfTerm}
                    onChange={(e) => setWhatIfTerm(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <Button onClick={() => setShowWhatIf(true)} disabled={!whatIfRate || !whatIfTerm}>
                  <Calculator className="mr-2 h-4 w-4" />
                  Generate Schedule
                </Button>
              </div>

              {whatIfSummary && (
                <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40 flex-wrap">
                  <div>
                    <span className="text-sm text-muted-foreground">Monthly Payment</span>
                    <p className="text-lg font-semibold tabular-nums">
                      {whatIfSchedule.length > 0 ? formatCurrency(whatIfSchedule[0].payment) : "---"}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Total Interest</span>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(whatIfSummary.total_interest)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Total Payments</span>
                    <p className="text-lg font-semibold tabular-nums">{formatCurrency(whatIfSummary.total_payments)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">vs Current Interest</span>
                    <p className={`text-lg font-semibold tabular-nums ${
                      whatIfSummary.total_interest < totalInterest ? "text-green-600" :
                      whatIfSummary.total_interest > totalInterest ? "text-red-600" : ""
                    }`}>
                      {formatCurrency(whatIfSummary.total_interest - totalInterest)}
                    </p>
                  </div>
                </div>
              )}

              {whatIfSchedule.length > 0 && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Beg Balance</TableHead>
                        <TableHead className="text-right">Payment</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead className="text-right">End Balance</TableHead>
                        <TableHead className="text-right">Cum. Interest</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {whatIfSchedule.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{getPeriodShortLabel(row.period_year, row.period_month)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.beginning_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.payment)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.principal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(row.interest)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatCurrency(row.ending_balance)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(row.cumulative_interest)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
