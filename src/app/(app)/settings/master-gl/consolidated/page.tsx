"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  formatCurrency,
  getPeriodLabel,
  getPeriodShortLabel,
  getCurrentPeriod,
  getPriorPeriod,
} from "@/lib/utils/dates";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { AccountClassification } from "@/lib/types/database";

interface EntityBreakdown {
  entityId: string;
  entityName: string;
  entityCode: string;
  accountId: string;
  endingBalance: number;
  adjustments: number;
  adjustedBalance: number;
  debitTotal: number;
  creditTotal: number;
  netChange: number;
  beginningBalance: number;
  compareEndingBalance: number;
}

interface ConsolidatedAccount {
  masterAccountId: string;
  accountNumber: string;
  name: string;
  description: string | null;
  classification: string;
  accountType: string;
  normalBalance: string;
  mappedEntities: number;
  entityBreakdown: EntityBreakdown[];
  endingBalance: number;
  adjustments: number;
  eliminationAdjustments: number;
  adjustedBalance: number;
  debitTotal: number;
  creditTotal: number;
  netChange: number;
  beginningBalance: number;
  compareEndingBalance: number | null;
  compareAdjustedBalance: number | null;
  changeFromCompare: number | null;
}

interface ConsolidatedTotals {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpenses: number;
}

interface UnmappedAccount {
  id: string;
  entityId: string;
  entityName: string;
  entityCode: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  currentBalance: number;
}

interface Elimination {
  id: string;
  organization_id: string;
  period_year: number;
  period_month: number;
  description: string;
  memo: string | null;
  debit_master_account_id: string;
  credit_master_account_id: string;
  amount: number;
  elimination_type: string;
  is_recurring: boolean;
  status: string;
}

interface MasterAccount {
  id: string;
  account_number: string;
  name: string;
  classification: string;
}

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const CLASSIFICATIONS: AccountClassification[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

const ELIM_TYPES = [
  { value: "intercompany", label: "Intercompany" },
  { value: "reclassification", label: "Reclassification" },
  { value: "adjustment", label: "Adjustment" },
];

export default function ConsolidatedPage() {
  const router = useRouter();
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [periodYear, setPeriodYear] = useState(currentPeriod.year);
  const [periodMonth, setPeriodMonth] = useState(currentPeriod.month);
  const [compareMode, setCompareMode] = useState<"none" | "prior" | "year_ago">(
    "none"
  );
  const [consolidated, setConsolidated] = useState<ConsolidatedAccount[]>([]);
  const [totals, setTotals] = useState<ConsolidatedTotals>({
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalRevenue: 0,
    totalExpenses: 0,
  });
  const [compareTotals, setCompareTotals] = useState<ConsolidatedTotals | null>(
    null
  );
  const [unmappedAccounts, setUnmappedAccounts] = useState<UnmappedAccount[]>(
    []
  );
  const [allEliminations, setAllEliminations] = useState<Elimination[]>([]);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Elimination dialog
  const [showElimDialog, setShowElimDialog] = useState(false);
  const [elimForm, setElimForm] = useState({
    description: "",
    memo: "",
    debitMasterAccountId: "",
    creditMasterAccountId: "",
    amount: "",
    eliminationType: "intercompany",
  });
  const [savingElim, setSavingElim] = useState(false);

  const loadOrganization = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
    }
  }, [supabase]);

  function getComparePeriod(): {
    year: number;
    month: number;
  } | null {
    if (compareMode === "prior") {
      return getPriorPeriod(periodYear, periodMonth);
    } else if (compareMode === "year_ago") {
      return { year: periodYear - 1, month: periodMonth };
    }
    return null;
  }

  const loadConsolidated = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    let url = `/api/master-accounts/consolidated?organizationId=${organizationId}&periodYear=${periodYear}&periodMonth=${periodMonth}`;

    const comp = compareMode !== "none" ? getComparePeriod() : null;
    if (comp) {
      url += `&comparePeriodYear=${comp.year}&comparePeriodMonth=${comp.month}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.consolidated) setConsolidated(data.consolidated);
    if (data.totals) setTotals(data.totals);
    if (data.compareTotals) setCompareTotals(data.compareTotals);
    else setCompareTotals(null);
    if (data.unmappedAccounts) setUnmappedAccounts(data.unmappedAccounts);

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, periodYear, periodMonth, compareMode]);

  const loadEliminations = useCallback(async () => {
    if (!organizationId) return;

    const response = await fetch(
      `/api/master-accounts/eliminations?organizationId=${organizationId}&periodYear=${periodYear}&periodMonth=${periodMonth}`
    );
    const data = await response.json();
    if (data.eliminations) setAllEliminations(data.eliminations);
  }, [organizationId, periodYear, periodMonth]);

  const loadMasterAccounts = useCallback(async () => {
    const response = await fetch("/api/master-accounts");
    const data = await response.json();
    if (data.accounts) setMasterAccounts(data.accounts);
  }, []);

  useEffect(() => {
    loadOrganization();
  }, [loadOrganization]);

  useEffect(() => {
    if (organizationId) {
      loadMasterAccounts();
    }
  }, [organizationId, loadMasterAccounts]);

  useEffect(() => {
    if (organizationId) {
      loadConsolidated();
      loadEliminations();
    }
  }, [organizationId, loadConsolidated, loadEliminations]);

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  function toggleRowExpand(masterAccountId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(masterAccountId)) {
        next.delete(masterAccountId);
      } else {
        next.add(masterAccountId);
      }
      return next;
    });
  }

  // Group consolidated accounts by classification
  const grouped = consolidated.reduce<Record<string, ConsolidatedAccount[]>>(
    (acc, account) => {
      const key = account.classification;
      if (!acc[key]) acc[key] = [];
      acc[key].push(account);
      return acc;
    },
    {}
  );

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const netIncome = totals.totalRevenue - totals.totalExpenses;
  const compareNetIncome = compareTotals
    ? compareTotals.totalRevenue - compareTotals.totalExpenses
    : null;
  const hasComparison = compareMode !== "none" && compareTotals !== null;
  const comp = getComparePeriod();

  async function handleExport() {
    if (!organizationId) return;
    window.open(
      `/api/master-accounts/consolidated/export?organizationId=${organizationId}&periodYear=${periodYear}&periodMonth=${periodMonth}`,
      "_blank"
    );
  }

  // Elimination CRUD
  async function handleCreateElimination() {
    if (
      !elimForm.description ||
      !elimForm.debitMasterAccountId ||
      !elimForm.creditMasterAccountId ||
      !elimForm.amount
    ) {
      toast.error("All fields except memo are required");
      return;
    }

    setSavingElim(true);
    const response = await fetch("/api/master-accounts/eliminations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        periodYear,
        periodMonth,
        description: elimForm.description,
        memo: elimForm.memo || null,
        debitMasterAccountId: elimForm.debitMasterAccountId,
        creditMasterAccountId: elimForm.creditMasterAccountId,
        amount: parseFloat(elimForm.amount),
        eliminationType: elimForm.eliminationType,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error || "Failed to create elimination");
      setSavingElim(false);
      return;
    }

    toast.success("Elimination entry created");
    setShowElimDialog(false);
    setElimForm({
      description: "",
      memo: "",
      debitMasterAccountId: "",
      creditMasterAccountId: "",
      amount: "",
      eliminationType: "intercompany",
    });
    setSavingElim(false);
    await loadEliminations();
    await loadConsolidated();
  }

  async function handlePostElimination(id: string) {
    const response = await fetch("/api/master-accounts/eliminations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "posted" }),
    });
    if (!response.ok) {
      toast.error("Failed to post elimination");
      return;
    }
    toast.success("Elimination posted");
    await loadEliminations();
    await loadConsolidated();
  }

  async function handleReverseElimination(id: string) {
    const response = await fetch("/api/master-accounts/eliminations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "reversed" }),
    });
    if (!response.ok) {
      toast.error("Failed to reverse elimination");
      return;
    }
    toast.success("Elimination reversed");
    await loadEliminations();
    await loadConsolidated();
  }

  async function handleDeleteElimination(id: string) {
    if (!confirm("Delete this elimination entry?")) return;
    const response = await fetch("/api/master-accounts/eliminations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      toast.error("Failed to delete elimination");
      return;
    }
    toast.success("Elimination deleted");
    await loadEliminations();
    await loadConsolidated();
  }

  function getMasterAccountLabel(id: string): string {
    const ma = masterAccounts.find((m) => m.id === id);
    return ma ? `${ma.account_number} - ${ma.name}` : id;
  }

  function renderChangeCell(change: number | null) {
    if (change === null) return null;
    const color =
      change > 0
        ? "text-green-600"
        : change < 0
        ? "text-red-600"
        : "text-muted-foreground";
    return (
      <span className={color}>
        {change > 0 ? "+" : ""}
        {formatCurrency(change)}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2"
            onClick={() => router.push("/settings/master-gl")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Master GL
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Consolidated Trial Balance
          </h1>
          <p className="text-muted-foreground">
            {getPeriodLabel(periodYear, periodMonth)}
            {hasComparison && comp
              ? ` vs. ${getPeriodShortLabel(comp.year, comp.month)}`
              : ""}
            {" "}— Adjusted balances across all entities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(periodMonth)}
            onValueChange={(v) => setPeriodMonth(parseInt(v))}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((month, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            onValueChange={(v) => setPeriodYear(parseInt(v))}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                currentPeriod.year - 2,
                currentPeriod.year - 1,
                currentPeriod.year,
                currentPeriod.year + 1,
              ].map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={compareMode} onValueChange={(v) => setCompareMode(v as typeof compareMode)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Compare..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Comparison</SelectItem>
              <SelectItem value="prior">Prior Month</SelectItem>
              <SelectItem value="year_ago">Same Month Last Year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Total Assets", value: totals.totalAssets, compare: compareTotals?.totalAssets },
          {
            label: "Total Liabilities",
            value: totals.totalLiabilities,
            compare: compareTotals?.totalLiabilities,
          },
          { label: "Total Equity", value: totals.totalEquity, compare: compareTotals?.totalEquity },
          { label: "Total Revenue", value: totals.totalRevenue, compare: compareTotals?.totalRevenue },
          {
            label: "Net Income",
            value: netIncome,
            compare: compareNetIncome,
            isNetIncome: true,
          },
        ].map(({ label, value, compare, isNetIncome }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-xl font-semibold tabular-nums ${
                  isNetIncome
                    ? value >= 0
                      ? "text-green-600"
                      : "text-red-600"
                    : ""
                }`}
              >
                {formatCurrency(value)}
              </div>
              {hasComparison && compare !== undefined && compare !== null && (
                <div className="text-xs text-muted-foreground mt-1">
                  vs. {formatCurrency(compare)}{" "}
                  {renderChangeCell(value - compare)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Consolidated Trial Balance */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Account Balances</CardTitle>
            <div className="text-xs text-muted-foreground">
              Showing adjusted balances (GL + posted accruals, depreciation, revenue adjustments, and eliminations)
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading consolidated balances...
            </p>
          ) : consolidated.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No master accounts with data for this period.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {CLASSIFICATIONS.map((classification) => {
                const classAccounts = grouped[classification];
                if (!classAccounts || classAccounts.length === 0) return null;
                const isCollapsed = collapsed[classification];

                const classTotal = classAccounts.reduce(
                  (sum, a) => sum + a.adjustedBalance,
                  0
                );
                const classCompare = hasComparison
                  ? classAccounts.reduce(
                      (sum, a) => sum + (a.compareAdjustedBalance ?? 0),
                      0
                    )
                  : null;

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
                        {classAccounts.length} account
                        {classAccounts.length !== 1 ? "s" : ""}
                      </span>
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {formatCurrency(classTotal)}
                      </span>
                      {hasComparison && classCompare !== null && (
                        <span className="text-xs tabular-nums ml-2">
                          {renderChangeCell(classTotal - classCompare)}
                        </span>
                      )}
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8"></TableHead>
                            <TableHead className="w-24">Number</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead className="text-right">
                              GL Balance
                            </TableHead>
                            <TableHead className="text-right">
                              Adjustments
                            </TableHead>
                            <TableHead className="text-right">
                              Adjusted Balance
                            </TableHead>
                            {hasComparison && (
                              <>
                                <TableHead className="text-right">
                                  Prior
                                </TableHead>
                                <TableHead className="text-right">
                                  Change
                                </TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classAccounts.map((account) => {
                            const isExpanded = expandedRows.has(
                              account.masterAccountId
                            );
                            const hasBreakdown =
                              account.entityBreakdown.length > 0;
                            const totalAdjustments =
                              account.adjustments +
                              account.eliminationAdjustments;
                            return (
                              <>
                                <TableRow
                                  key={account.masterAccountId}
                                  className={
                                    hasBreakdown
                                      ? "cursor-pointer hover:bg-muted/50"
                                      : ""
                                  }
                                  onClick={() =>
                                    hasBreakdown &&
                                    toggleRowExpand(account.masterAccountId)
                                  }
                                >
                                  <TableCell>
                                    {hasBreakdown &&
                                      (isExpanded ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      ))}
                                  </TableCell>
                                  <TableCell className="font-mono text-sm font-medium">
                                    {account.accountNumber}
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-medium">
                                      {account.name}
                                    </span>
                                    {account.mappedEntities > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-2 text-xs"
                                      >
                                        {account.mappedEntities} entit
                                        {account.mappedEntities !== 1
                                          ? "ies"
                                          : "y"}
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(account.endingBalance)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {totalAdjustments !== 0 ? (
                                      <span
                                        className={
                                          totalAdjustments > 0
                                            ? "text-green-600"
                                            : "text-red-600"
                                        }
                                      >
                                        {totalAdjustments > 0 ? "+" : ""}
                                        {formatCurrency(totalAdjustments)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">
                                        —
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums font-medium">
                                    {formatCurrency(account.adjustedBalance)}
                                  </TableCell>
                                  {hasComparison && (
                                    <>
                                      <TableCell className="text-right tabular-nums text-muted-foreground">
                                        {account.compareAdjustedBalance !==
                                        null
                                          ? formatCurrency(
                                              account.compareAdjustedBalance
                                            )
                                          : "—"}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {renderChangeCell(
                                          account.changeFromCompare
                                        )}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                                {isExpanded &&
                                  account.entityBreakdown.map((eb) => (
                                    <TableRow
                                      key={`${account.masterAccountId}-${eb.entityId}`}
                                      className="bg-muted/30"
                                    >
                                      <TableCell></TableCell>
                                      <TableCell></TableCell>
                                      <TableCell className="text-sm text-muted-foreground pl-8">
                                        <Badge
                                          variant="outline"
                                          className="text-xs mr-2"
                                        >
                                          {eb.entityCode}
                                        </Badge>
                                        {eb.entityName}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.endingBalance)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {eb.adjustments !== 0
                                          ? formatCurrency(eb.adjustments)
                                          : "—"}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                        {formatCurrency(eb.adjustedBalance)}
                                      </TableCell>
                                      {hasComparison && (
                                        <>
                                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                            {formatCurrency(
                                              eb.compareEndingBalance
                                            )}
                                          </TableCell>
                                          <TableCell></TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  ))}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consolidation Eliminations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              Consolidation Entries ({allEliminations.length})
            </CardTitle>
            <Button
              size="sm"
              onClick={() => setShowElimDialog(true)}
              disabled={masterAccounts.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Entry
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {allEliminations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No consolidation entries for this period. Add intercompany
              eliminations, reclassifications, or adjustments.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Debit Account</TableHead>
                  <TableHead>Credit Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allEliminations.map((elim) => (
                  <TableRow key={elim.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium text-sm">
                          {elim.description}
                        </span>
                        {elim.memo && (
                          <span className="block text-xs text-muted-foreground">
                            {elim.memo}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {elim.elimination_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {getMasterAccountLabel(elim.debit_master_account_id)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {getMasterAccountLabel(elim.credit_master_account_id)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(Number(elim.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          elim.status === "posted"
                            ? "default"
                            : elim.status === "reversed"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-xs"
                      >
                        {elim.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {elim.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePostElimination(elim.id)}
                            title="Post"
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {elim.status === "posted" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReverseElimination(elim.id)}
                            title="Reverse"
                          >
                            <XCircle className="h-4 w-4 text-amber-600" />
                          </Button>
                        )}
                        {elim.status !== "posted" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteElimination(elim.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Unmapped Accounts Warning */}
      {unmappedAccounts.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Unmapped Entity Accounts ({unmappedAccounts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              These entity accounts are not mapped to any master account and are
              excluded from the consolidated view.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="w-24">Number</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmappedAccounts.slice(0, 50).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {a.entityCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {a.accountNumber ?? "---"}
                    </TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          CLASSIFICATION_COLORS[
                            a.classification as AccountClassification
                          ] ?? ""
                        }
                      >
                        {a.classification}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(a.currentBalance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {unmappedAccounts.length > 50 && (
              <p className="text-sm text-muted-foreground mt-2">
                ...and {unmappedAccounts.length - 50} more unmapped accounts.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Elimination Dialog */}
      <Dialog open={showElimDialog} onOpenChange={setShowElimDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Consolidation Entry</DialogTitle>
            <DialogDescription>
              Create an elimination, reclassification, or adjustment entry for{" "}
              {getPeriodLabel(periodYear, periodMonth)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="e.g., Eliminate intercompany receivable/payable"
                value={elimForm.description}
                onChange={(e) =>
                  setElimForm({ ...elimForm, description: e.target.value })
                }
              />
            </div>

            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={elimForm.eliminationType}
                  onValueChange={(v) =>
                    setElimForm({ ...elimForm, eliminationType: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ELIM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={elimForm.amount}
                  onChange={(e) =>
                    setElimForm({ ...elimForm, amount: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Debit Account</Label>
              <Select
                value={elimForm.debitMasterAccountId}
                onValueChange={(v) =>
                  setElimForm({ ...elimForm, debitMasterAccountId: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select debit account..." />
                </SelectTrigger>
                <SelectContent>
                  {masterAccounts.map((ma) => (
                    <SelectItem key={ma.id} value={ma.id}>
                      {ma.account_number} - {ma.name} ({ma.classification})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Credit Account</Label>
              <Select
                value={elimForm.creditMasterAccountId}
                onValueChange={(v) =>
                  setElimForm({ ...elimForm, creditMasterAccountId: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select credit account..." />
                </SelectTrigger>
                <SelectContent>
                  {masterAccounts.map((ma) => (
                    <SelectItem key={ma.id} value={ma.id}>
                      {ma.account_number} - {ma.name} ({ma.classification})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Memo (optional)</Label>
              <Input
                placeholder="Additional notes..."
                value={elimForm.memo}
                onChange={(e) =>
                  setElimForm({ ...elimForm, memo: e.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowElimDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateElimination} disabled={savingElim}>
              {savingElim ? "Creating..." : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
