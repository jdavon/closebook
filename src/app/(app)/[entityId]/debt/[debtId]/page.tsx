"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { ArrowLeft, Save, Link as LinkIcon } from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getPeriodShortLabel,
} from "@/lib/utils/dates";
import type { DebtType, DebtStatus } from "@/lib/types/database";

interface DebtInstrumentData {
  id: string;
  instrument_name: string;
  lender_name: string | null;
  debt_type: DebtType;
  original_amount: number;
  interest_rate: number;
  term_months: number | null;
  start_date: string;
  maturity_date: string | null;
  payment_amount: number | null;
  credit_limit: number | null;
  current_draw: number | null;
  liability_account_id: string | null;
  interest_expense_account_id: string | null;
  fixed_asset_id: string | null;
  status: DebtStatus;
  source_file_name: string | null;
  uploaded_at: string | null;
}

interface AmortizationRow {
  id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
  is_manual_override: boolean;
}

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

const STATUS_VARIANTS: Record<
  DebtStatus,
  "default" | "secondary" | "outline"
> = {
  active: "default",
  paid_off: "secondary",
  inactive: "outline",
};

const TYPE_LABELS: Record<DebtType, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
};

export default function DebtDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const debtId = params.debtId as string;
  const router = useRouter();
  const supabase = createClient();

  const [instrument, setInstrument] = useState<DebtInstrumentData | null>(null);
  const [amortization, setAmortization] = useState<AmortizationRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAsset, setLinkedAsset] = useState<FixedAssetRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable GL linkage
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [interestAccountId, setInterestAccountId] = useState("");

  const loadData = useCallback(async () => {
    const [instrResult, amortResult, accountsResult] = await Promise.all([
      supabase
        .from("debt_instruments")
        .select("*")
        .eq("id", debtId)
        .single(),
      supabase
        .from("debt_amortization")
        .select("*")
        .eq("debt_instrument_id", debtId)
        .order("period_year")
        .order("period_month"),
      supabase
        .from("accounts")
        .select("id, name, account_number, classification")
        .eq("entity_id", entityId)
        .eq("is_active", true)
        .order("account_number")
        .order("name"),
    ]);

    const instr = instrResult.data as unknown as DebtInstrumentData;
    if (instr) {
      setInstrument(instr);
      setLiabilityAccountId(instr.liability_account_id ?? "");
      setInterestAccountId(instr.interest_expense_account_id ?? "");

      // Load linked fixed asset if present
      if (instr.fixed_asset_id) {
        const { data: assetData } = await supabase
          .from("fixed_assets")
          .select("id, asset_name, asset_tag")
          .eq("id", instr.fixed_asset_id)
          .single();
        setLinkedAsset((assetData as unknown as FixedAssetRef) ?? null);
      }
    }

    setAmortization((amortResult.data as unknown as AmortizationRow[]) ?? []);
    setAccounts((accountsResult.data as Account[]) ?? []);
    setLoading(false);
  }, [supabase, debtId, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveAccounts() {
    if (!instrument) return;
    setSaving(true);

    const { error } = await supabase
      .from("debt_instruments")
      .update({
        liability_account_id: liabilityAccountId || null,
        interest_expense_account_id: interestAccountId || null,
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

  // Current balance from latest amortization entry
  const latestAmort = amortization.length > 0
    ? amortization[amortization.length - 1]
    : null;

  // Total interest paid
  const totalInterest = amortization.reduce((sum, a) => sum + a.interest, 0);
  const totalPrincipal = amortization.reduce((sum, a) => sum + a.principal, 0);

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
            <Badge variant={STATUS_VARIANTS[instrument.status] ?? "outline"}>
              {STATUS_LABELS[instrument.status] ?? instrument.status}
            </Badge>
            <Badge variant="outline">
              {TYPE_LABELS[instrument.debt_type]}
            </Badge>
          </div>
          {instrument.lender_name && (
            <p className="text-muted-foreground">
              Lender: {instrument.lender_name}
            </p>
          )}
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40 flex-wrap">
        <div>
          <span className="text-sm text-muted-foreground">Original Amount</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Current Balance</span>
          <p className="text-lg font-semibold tabular-nums">
            {latestAmort
              ? formatCurrency(latestAmort.ending_balance)
              : formatCurrency(instrument.original_amount)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Interest Rate</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatPercentage(instrument.interest_rate)}
          </p>
        </div>
        {instrument.term_months && (
          <div>
            <span className="text-sm text-muted-foreground">Term</span>
            <p className="text-lg font-semibold">
              {instrument.term_months} months
            </p>
          </div>
        )}
        {instrument.payment_amount && (
          <div>
            <span className="text-sm text-muted-foreground">
              Monthly Payment
            </span>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(instrument.payment_amount)}
            </p>
          </div>
        )}
        {instrument.maturity_date && (
          <div>
            <span className="text-sm text-muted-foreground">Maturity</span>
            <p className="text-lg font-semibold">
              {new Date(instrument.maturity_date).toLocaleDateString()}
            </p>
          </div>
        )}
        {instrument.debt_type === "line_of_credit" &&
          instrument.credit_limit && (
            <div>
              <span className="text-sm text-muted-foreground">
                Credit Limit
              </span>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(instrument.credit_limit)}
              </p>
            </div>
          )}
      </div>

      {/* Instrument Details + GL Accounts side by side */}
      <div className="grid grid-cols-2 gap-6">
        {/* Instrument Details */}
        <Card>
          <CardHeader>
            <CardTitle>Instrument Details</CardTitle>
            <CardDescription>Loan terms and identifiers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Type</span>
                <p className="font-medium">
                  {TYPE_LABELS[instrument.debt_type]}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Start Date</span>
                <p className="font-medium">
                  {new Date(instrument.start_date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Interest Rate</span>
                <p className="font-medium tabular-nums">
                  {formatPercentage(instrument.interest_rate)}
                </p>
              </div>
              {instrument.maturity_date && (
                <div>
                  <span className="text-muted-foreground">Maturity Date</span>
                  <p className="font-medium">
                    {new Date(
                      instrument.maturity_date
                    ).toLocaleDateString()}
                  </p>
                </div>
              )}
              {instrument.term_months && (
                <div>
                  <span className="text-muted-foreground">Term</span>
                  <p className="font-medium">
                    {instrument.term_months} months (
                    {(instrument.term_months / 12).toFixed(1)} years)
                  </p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">
                  Total Principal Paid
                </span>
                <p className="font-medium tabular-nums">
                  {formatCurrency(totalPrincipal)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Total Interest Paid
                </span>
                <p className="font-medium tabular-nums">
                  {formatCurrency(totalInterest)}
                </p>
              </div>
              {instrument.source_file_name && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Source File</span>
                  <p className="font-medium text-xs">
                    {instrument.source_file_name}
                    {instrument.uploaded_at &&
                      ` — ${new Date(instrument.uploaded_at).toLocaleString()}`}
                  </p>
                </div>
              )}
            </div>

            {/* Linked Asset */}
            {linkedAsset && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Linked Asset:</span>
                  <span className="font-medium">
                    {linkedAsset.asset_tag
                      ? `${linkedAsset.asset_tag} — `
                      : ""}
                    {linkedAsset.asset_name}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* GL Account Linkage */}
        <Card>
          <CardHeader>
            <CardTitle>GL Accounts</CardTitle>
            <CardDescription>
              Chart of accounts linkage for journal entries
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="liabilityAccount">Liability Account</Label>
              <Select
                value={liabilityAccountId}
                onValueChange={setLiabilityAccountId}
              >
                <SelectTrigger id="liabilityAccount">
                  <SelectValue placeholder="Select liability account..." />
                </SelectTrigger>
                <SelectContent>
                  {liabilityAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_number
                        ? `${account.account_number} - ${account.name}`
                        : account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interestAccount">Interest Expense Account</Label>
              <Select
                value={interestAccountId}
                onValueChange={setInterestAccountId}
              >
                <SelectTrigger id="interestAccount">
                  <SelectValue placeholder="Select expense account..." />
                </SelectTrigger>
                <SelectContent>
                  {expenseAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_number
                        ? `${account.account_number} - ${account.name}`
                        : account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleSaveAccounts}
              disabled={saving}
              className="w-full"
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save GL Accounts"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Full Amortization Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Amortization Schedule</CardTitle>
          <CardDescription>
            {amortization.length} period
            {amortization.length !== 1 ? "s" : ""} generated
          </CardDescription>
        </CardHeader>
        <CardContent>
          {amortization.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No amortization entries. The schedule will be generated when
              instrument data is uploaded.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">
                      Beginning Balance
                    </TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">
                      Ending Balance
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {amortization.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {getPeriodShortLabel(row.period_year, row.period_month)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.beginning_balance)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.payment)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.principal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.interest)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(row.ending_balance)}
                      </TableCell>
                      <TableCell>
                        {row.is_manual_override && (
                          <Badge variant="secondary" className="text-xs">
                            Override
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Totals</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(
                        amortization.reduce((s, r) => s + r.payment, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalPrincipal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalInterest)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
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
