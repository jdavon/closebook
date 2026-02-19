"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  formatCurrency,
  getCurrentPeriod,
  getPeriodLabel,
  getPriorPeriod,
  getNextPeriod,
} from "@/lib/utils/dates";
import type { AccountClassification } from "@/lib/types/database";

interface GLBalance {
  account_id: string;
  ending_balance: number;
  debit_total: number;
  credit_total: number;
  net_change: number;
  synced_at: string | null;
  accounts: {
    name: string;
    account_number: string | null;
    classification: AccountClassification;
    account_type: string;
  };
}

interface SyncProgress {
  step: string;
  detail: string;
  progress: number;
  done?: boolean;
  error?: string;
  recordsSynced?: number;
  accountsSynced?: number;
  tbAccountsFound?: number;
  tbAccountsMatched?: number;
  tbAccountsUnmatched?: number;
  unmatchedNames?: string[];
}

const SYNC_STEPS = [
  { key: "auth", label: "Authenticate" },
  { key: "accounts", label: "Chart of Accounts" },
  { key: "trial_balance", label: "Trial Balance" },
  { key: "matching", label: "Match & Save" },
  { key: "finalizing", label: "Finalize" },
];

const CLASSIFICATION_ORDER: AccountClassification[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function TrialBalancePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const [year, setYear] = useState(String(currentPeriod.year));
  const [month, setMonth] = useState(String(currentPeriod.month));
  const [balances, setBalances] = useState<GLBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("gl_balances")
      .select(
        "account_id, ending_balance, debit_total, credit_total, net_change, synced_at, accounts(name, account_number, classification, account_type)"
      )
      .eq("entity_id", entityId)
      .eq("period_year", parseInt(year))
      .eq("period_month", parseInt(month))
      .order("accounts(classification)")
      .order("accounts(account_number)");

    const rows = (data as unknown as GLBalance[]) ?? [];
    setBalances(rows);

    const synced = rows
      .map((r) => r.synced_at)
      .filter(Boolean)
      .sort()
      .pop();
    setLastSyncedAt(synced ?? null);

    setLoading(false);
  }, [supabase, entityId, year, month]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  async function handleSync() {
    setSyncing(true);
    setSyncProgress({ step: "starting", detail: "Starting sync...", progress: 0 });

    const y = parseInt(year);
    const m = parseInt(month);

    try {
      const response = await fetch("/api/qbo/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          syncType: "full",
          periodYear: y,
          periodMonth: m,
        }),
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        toast.error(errData.error || `Sync failed (HTTP ${response.status})`);
        setSyncing(false);
        setSyncProgress(null);
        return;
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as SyncProgress;
              setSyncProgress(event);

              if (event.done) {
                if (event.error) {
                  toast.error(event.error);
                } else {
                  const parts = [];
                  if (event.accountsSynced) parts.push(`${event.accountsSynced} accounts`);
                  if (event.tbAccountsMatched) parts.push(`${event.tbAccountsMatched} balances`);
                  if (event.tbAccountsUnmatched) parts.push(`${event.tbAccountsUnmatched} unmatched`);
                  toast.success(
                    `Synced ${getPeriodLabel(y, m)} — ${parts.join(", ")}`
                  );
                  loadBalances();
                }
              }
            } catch {
              // ignore malformed events
            }
          }
        }
      }
    } catch {
      toast.error("Sync failed — network error");
    }

    setSyncing(false);
    // Keep syncProgress visible for a moment so user can see final state
    setTimeout(() => {
      setSyncProgress((prev) => (prev?.done ? null : prev));
    }, 8000);
  }

  function navigatePeriod(direction: "prev" | "next") {
    const y = parseInt(year);
    const m = parseInt(month);
    const target =
      direction === "prev" ? getPriorPeriod(y, m) : getNextPeriod(y, m);
    setYear(String(target.year));
    setMonth(String(target.month));
  }

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  function getStepIcon(stepKey: string) {
    if (!syncProgress) return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;

    const stepIndex = SYNC_STEPS.findIndex((s) => s.key === stepKey);
    const currentIndex = SYNC_STEPS.findIndex((s) => s.key === syncProgress.step);

    if (syncProgress.step === "complete" || syncProgress.step === "error") {
      if (syncProgress.step === "error" && stepIndex === currentIndex) {
        return <XCircle className="h-4 w-4 text-red-500" />;
      }
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }

    if (stepIndex < currentIndex) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (stepIndex === currentIndex) {
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    }
    return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;
  }

  // Group balances by classification
  const grouped = balances.reduce<Record<string, GLBalance[]>>((acc, b) => {
    const key = b.accounts?.classification ?? "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(b);
    return acc;
  }, {});

  // Compute totals
  const totalDebits = balances.reduce((sum, b) => sum + (b.debit_total ?? 0), 0);
  const totalCredits = balances.reduce((sum, b) => sum + (b.credit_total ?? 0), 0);
  const difference = totalDebits - totalCredits;

  return (
    <div className="space-y-6">
      {/* Header with period navigation */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Trial Balance
          </h1>
          <p className="text-muted-foreground">
            {getPeriodLabel(parseInt(year), parseInt(month))} — Synced from
            QuickBooks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigatePeriod("prev")}
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Year</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-[90px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    currentPeriod.year - 2,
                    currentPeriod.year - 1,
                    currentPeriod.year,
                    currentPeriod.year + 1,
                  ].map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigatePeriod("next")}
            title="Next month"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync Period"}
          </Button>
        </div>
      </div>

      {/* Sync Progress Panel */}
      {syncProgress && (
        <Card className={syncProgress.error ? "border-red-300" : "border-primary/30"}>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {syncProgress.done
                      ? syncProgress.error
                        ? "Sync Failed"
                        : "Sync Complete"
                      : "Syncing..."}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {syncProgress.progress}%
                  </span>
                </div>
                <Progress value={syncProgress.progress} />
              </div>

              {/* Step indicators */}
              <div className="flex items-center gap-6">
                {SYNC_STEPS.map((step) => (
                  <div
                    key={step.key}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    {getStepIcon(step.key)}
                    <span
                      className={
                        syncProgress.step === step.key
                          ? "font-medium text-foreground"
                          : syncProgress.step === "complete" ||
                            SYNC_STEPS.findIndex((s) => s.key === syncProgress.step) >
                              SYNC_STEPS.findIndex((s) => s.key === step.key)
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50"
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Current status detail */}
              <p className="text-sm text-muted-foreground">
                {syncProgress.detail}
              </p>

              {/* Summary when done */}
              {syncProgress.done && !syncProgress.error && (
                <div className="flex gap-6 text-sm pt-1">
                  {syncProgress.accountsSynced !== undefined && (
                    <div>
                      <span className="text-muted-foreground">Accounts: </span>
                      <span className="font-medium">{syncProgress.accountsSynced}</span>
                    </div>
                  )}
                  {syncProgress.tbAccountsFound !== undefined && (
                    <div>
                      <span className="text-muted-foreground">TB Rows: </span>
                      <span className="font-medium">{syncProgress.tbAccountsFound}</span>
                    </div>
                  )}
                  {syncProgress.tbAccountsMatched !== undefined && (
                    <div>
                      <span className="text-muted-foreground">Matched: </span>
                      <span className="font-medium text-green-600">{syncProgress.tbAccountsMatched}</span>
                    </div>
                  )}
                  {(syncProgress.tbAccountsUnmatched ?? 0) > 0 && (
                    <div>
                      <span className="text-muted-foreground">Unmatched: </span>
                      <span className="font-medium text-amber-600">{syncProgress.tbAccountsUnmatched}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Unmatched account names warning */}
              {syncProgress.done &&
                syncProgress.unmatchedNames &&
                syncProgress.unmatchedNames.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/20 dark:border-amber-800">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        Unmatched accounts from QB trial balance
                      </span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {syncProgress.unmatchedNames.join(", ")}
                    </p>
                  </div>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Debits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totalDebits)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Credits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {formatCurrency(totalCredits)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Difference
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold tabular-nums ${
                Math.abs(difference) < 0.01
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {formatCurrency(difference)}
            </div>
            {Math.abs(difference) < 0.01 && balances.length > 0 && (
              <p className="text-xs text-green-600 mt-1">Balanced</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold tabular-nums">
              {balances.length}
            </div>
            {lastSyncedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Synced {new Date(lastSyncedAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trial Balance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Account Detail</CardTitle>
          <CardDescription>
            Debit and credit balances as reported by QuickBooks for the period
            ending{" "}
            {new Date(
              parseInt(year),
              parseInt(month),
              0
            ).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : balances.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">
                No trial balance data for this period.
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Sync from QuickBooks to pull in the trial balance.
              </p>
              <Button onClick={handleSync} disabled={syncing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    syncing ? "animate-spin" : ""
                  }`}
                />
                {syncing ? "Syncing..." : `Sync ${getPeriodLabel(parseInt(year), parseInt(month))}`}
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {CLASSIFICATION_ORDER.map((classification) => {
                const classBalances = grouped[classification];
                if (!classBalances || classBalances.length === 0) return null;

                const isCollapsed = collapsed[classification];
                const classDebits = classBalances.reduce(
                  (sum, b) => sum + (b.debit_total ?? 0),
                  0
                );
                const classCredits = classBalances.reduce(
                  (sum, b) => sum + (b.credit_total ?? 0),
                  0
                );

                return (
                  <div key={classification}>
                    <button
                      onClick={() => toggleCollapse(classification)}
                      className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <Badge
                        variant="outline"
                        className={CLASSIFICATION_COLORS[classification]}
                      >
                        {classification}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {classBalances.length} account
                        {classBalances.length !== 1 ? "s" : ""}
                      </span>
                      <div className="ml-auto flex gap-8 text-sm font-semibold tabular-nums">
                        <span className="w-28 text-right">
                          {formatCurrency(classDebits)}
                        </span>
                        <span className="w-28 text-right">
                          {formatCurrency(classCredits)}
                        </span>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Acct #</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right w-32">
                              Debit
                            </TableHead>
                            <TableHead className="text-right w-32">
                              Credit
                            </TableHead>
                            <TableHead className="text-right w-32">
                              Net Balance
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classBalances.map((b) => (
                            <TableRow key={b.account_id}>
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {b.accounts?.account_number ?? "---"}
                              </TableCell>
                              <TableCell className="font-medium">
                                {b.accounts?.name}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {b.accounts?.account_type}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.debit_total
                                  ? formatCurrency(b.debit_total)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.credit_total
                                  ? formatCurrency(b.credit_total)
                                  : "—"}
                              </TableCell>
                              <TableCell
                                className={`text-right tabular-nums font-medium ${
                                  b.ending_balance >= 0
                                    ? ""
                                    : "text-red-600"
                                }`}
                              >
                                {formatCurrency(b.ending_balance)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Classification subtotal */}
                          <TableRow className="bg-muted/40 font-semibold">
                            <TableCell colSpan={3} className="text-right">
                              {classification} Total
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(classDebits)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(classCredits)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(classDebits - classCredits)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}

              {/* Grand Totals */}
              <div className="border-t-2 pt-3 mt-3">
                <div className="flex items-center justify-end gap-8 px-1">
                  <span className="font-semibold">Grand Total</span>
                  <span className="w-28 text-right font-semibold tabular-nums">
                    {formatCurrency(totalDebits)}
                  </span>
                  <span className="w-28 text-right font-semibold tabular-nums">
                    {formatCurrency(totalCredits)}
                  </span>
                  <span
                    className={`w-28 text-right font-semibold tabular-nums ${
                      Math.abs(difference) < 0.01
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatCurrency(difference)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
