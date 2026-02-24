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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus,
  Calculator,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Percent,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Check,
  ChevronsUpDown,
  X,
  Loader2,
} from "lucide-react";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import type { AccountClassification, ClassFilterMode } from "@/lib/types/database";

// ── Types ──────────────────────────────────────────────────────────────

interface CommissionProfile {
  id: string;
  entity_id: string;
  name: string;
  commission_rate: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface QboClass {
  id: string;
  name: string;
}

interface AccountAssignment {
  id: string;
  commission_profile_id: string;
  account_id: string;
  role: "revenue" | "expense";
  class_filter_mode: ClassFilterMode;
  qbo_class_ids: string[];
  accounts?: {
    name: string;
    account_number: string | null;
    classification: string;
    account_type: string;
  };
}

interface CommissionResult {
  id: string;
  commission_profile_id: string;
  period_year: number;
  period_month: number;
  total_revenue: number;
  total_expenses: number;
  commission_base: number;
  commission_rate: number;
  commission_earned: number;
  is_payable: boolean;
  calculated_at: string;
}

interface EntityAccount {
  id: string;
  name: string;
  account_number: string | null;
  classification: AccountClassification;
  account_type: string;
  is_active: boolean;
}

interface FormAssignment {
  account_id: string;
  role: "revenue" | "expense";
  class_filter_mode: ClassFilterMode;
  qbo_class_ids: string[];
}

// ── Page ───────────────────────────────────────────────────────────────

export default function CommissionsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const current = getCurrentPeriod();

  // Period
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);

  // Data
  const [profiles, setProfiles] = useState<CommissionProfile[]>([]);
  const [assignments, setAssignments] = useState<
    Record<string, AccountAssignment[]>
  >({});
  const [results, setResults] = useState<CommissionResult[]>([]);
  const [accounts, setAccounts] = useState<EntityAccount[]>([]);

  // GL balances for detail view
  const [detailBalances, setDetailBalances] = useState<
    Record<string, number>
  >({});

  // QBO Classes
  const [qboClasses, setQboClasses] = useState<QboClass[]>([]);
  const [classBalances, setClassBalances] = useState<
    Record<string, number>
  >({}); // key: `${account_id}__${class_id}`

  // UI
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CommissionProfile | null>(
    null
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Form
  const [formName, setFormName] = useState("");
  const [formRate, setFormRate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formAssignments, setFormAssignments] = useState<FormAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  // Account picker popovers
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});

  const supabase = createClient();

  // ── Data Loading ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);

    // Fetch profiles and assignments via API
    const res = await fetch(
      `/api/commissions?entityId=${entityId}`
    );
    if (res.ok) {
      const data = await res.json();
      setProfiles(data.profiles);
      setAssignments(data.assignments);
    }

    // Fetch commission results for this period
    const { data: resultData } = await supabase
      .from("commission_results")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    setResults(resultData ?? []);

    // Fetch entity accounts for the picker
    const { data: acctData } = await supabase
      .from("accounts")
      .select("id, name, account_number, classification, account_type, is_active")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number");

    setAccounts((acctData ?? []) as EntityAccount[]);

    // Fetch QBO classes for the entity
    const { data: classData } = await supabase
      .from("qbo_classes")
      .select("id, name")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("name");

    setQboClasses((classData ?? []) as QboClass[]);

    // Fetch GL balances for detail expansion (all accounts for this period)
    const { data: glData } = await supabase
      .from("gl_balances")
      .select("account_id, net_change")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const balanceMap: Record<string, number> = {};
    for (const row of glData ?? []) {
      balanceMap[row.account_id] = Number(row.net_change ?? 0);
    }
    setDetailBalances(balanceMap);

    // Fetch class-level GL balances for detail expansion
    const { data: classGlData } = await supabase
      .from("gl_class_balances")
      .select("account_id, qbo_class_id, net_change")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const classBalanceMap: Record<string, number> = {};
    for (const row of classGlData ?? []) {
      classBalanceMap[`${row.account_id}__${row.qbo_class_id}`] = Number(
        row.net_change ?? 0
      );
    }
    setClassBalances(classBalanceMap);

    setLoading(false);
  }, [entityId, periodYear, periodMonth, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Group accounts by classification ─────────────────────────────────

  const groupedAccounts = accounts.reduce(
    (groups, acct) => {
      const key = acct.classification;
      if (!groups[key]) groups[key] = [];
      groups[key].push(acct);
      return groups;
    },
    {} as Record<string, EntityAccount[]>
  );

  // ── Helpers ──────────────────────────────────────────────────────────

  function getResultForProfile(profileId: string): CommissionResult | undefined {
    return results.find((r) => r.commission_profile_id === profileId);
  }

  const summaryRevenue = results.reduce(
    (sum, r) => sum + Number(r.total_revenue),
    0
  );
  const summaryExpenses = results.reduce(
    (sum, r) => sum + Number(r.total_expenses),
    0
  );
  const summaryBase = results.reduce(
    (sum, r) => sum + Number(r.commission_base),
    0
  );
  const summaryEarned = results.reduce(
    (sum, r) => sum + Number(r.commission_earned),
    0
  );

  // ── Actions ──────────────────────────────────────────────────────────

  async function handleCalculate() {
    setCalculating(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "calculate",
          entityId,
          periodYear,
          periodMonth,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Calculated commissions for ${data.results.length} salesperson(s)`
        );
        await loadData();
      } else {
        toast.error(data.error || "Calculation failed");
      }
    } catch {
      toast.error("Failed to calculate commissions");
    }
    setCalculating(false);
  }

  async function handleMarkPayable(resultId: string, isPayable: boolean) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark_payable",
        resultId,
        isPayable,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setResults((prev) =>
        prev.map((r) =>
          r.id === resultId ? { ...r, is_payable: isPayable } : r
        )
      );
      toast.success(isPayable ? "Marked as payable" : "Unmarked as payable");
    } else {
      toast.error(data.error || "Failed to update");
    }
  }

  async function handleDeleteProfile(profileId: string) {
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_profile",
        profileId,
      }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success("Salesperson profile deleted");
      await loadData();
    } else {
      toast.error(data.error || "Failed to delete");
    }
  }

  // ── Dialog ───────────────────────────────────────────────────────────

  function openAddDialog() {
    setEditingProfile(null);
    setFormName("");
    setFormRate("");
    setFormNotes("");
    setFormAssignments([]);
    setOpenPopovers({});
    setDialogOpen(true);
  }

  function openEditDialog(profile: CommissionProfile) {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormRate(String(Number(profile.commission_rate) * 100));
    setFormNotes(profile.notes || "");
    const profileAssignments = assignments[profile.id] ?? [];
    setFormAssignments(
      profileAssignments.map((a) => ({
        account_id: a.account_id,
        role: a.role,
        class_filter_mode: (a.class_filter_mode ?? "all") as ClassFilterMode,
        qbo_class_ids: a.qbo_class_ids ?? [],
      }))
    );
    setOpenPopovers({});
    setDialogOpen(true);
  }

  async function handleSaveProfile() {
    if (!formName.trim()) {
      toast.error("Salesperson name is required");
      return;
    }
    const rateNum = parseFloat(formRate);
    if (isNaN(rateNum) || rateNum < 0) {
      toast.error("Please enter a valid commission rate");
      return;
    }

    // Validate class selections
    const invalidClassFilter = formAssignments.find(
      (a) => a.account_id && a.class_filter_mode !== "all" && a.qbo_class_ids.length === 0
    );
    if (invalidClassFilter) {
      toast.error("Please select at least one class for include/exclude filter");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_profile",
          entityId,
          profile: {
            id: editingProfile?.id || null,
            name: formName.trim(),
            commission_rate: rateNum / 100, // Convert percentage to decimal
            notes: formNotes.trim() || null,
            assignments: formAssignments
              .filter((a) => a.account_id)
              .map((a) => ({
                account_id: a.account_id,
                role: a.role,
                class_filter_mode: a.class_filter_mode,
                qbo_class_ids: a.class_filter_mode === "all" ? [] : a.qbo_class_ids,
              })),
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          editingProfile
            ? "Salesperson updated"
            : "Salesperson added"
        );
        setDialogOpen(false);
        await loadData();
      } else {
        toast.error(data.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save profile");
    }
    setSaving(false);
  }

  function addAssignmentRow() {
    setFormAssignments((prev) => [
      ...prev,
      { account_id: "", role: "revenue", class_filter_mode: "all" as ClassFilterMode, qbo_class_ids: [] },
    ]);
  }

  function removeAssignmentRow(index: number) {
    setFormAssignments((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAssignment(
    index: number,
    field: "account_id" | "role" | "class_filter_mode",
    value: string
  ) {
    setFormAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const updated = { ...a, [field]: value };
        // Reset class IDs when switching to "all"
        if (field === "class_filter_mode" && value === "all") {
          updated.qbo_class_ids = [];
        }
        return updated;
      })
    );
  }

  function toggleClassId(index: number, classId: string) {
    setFormAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const ids = a.qbo_class_ids.includes(classId)
          ? a.qbo_class_ids.filter((id) => id !== classId)
          : [...a.qbo_class_ids, classId];
        return { ...a, qbo_class_ids: ids };
      })
    );
  }

  function toggleRow(profileId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  }

  // ── Detail row helpers ──────────────────────────────────────────────

  function getAssignmentRawBalance(a: AccountAssignment): number {
    if (a.class_filter_mode === "all" || a.qbo_class_ids.length === 0) {
      return detailBalances[a.account_id] ?? 0;
    }
    if (a.class_filter_mode === "include") {
      return a.qbo_class_ids.reduce(
        (sum, cid) => sum + (classBalances[`${a.account_id}__${cid}`] ?? 0),
        0
      );
    }
    // exclude: sum all class balances for this account MINUS excluded ones
    const excludeSet = new Set(a.qbo_class_ids);
    return Object.entries(classBalances)
      .filter(([key]) => {
        const [acctId, classId] = key.split("__");
        return acctId === a.account_id && !excludeSet.has(classId);
      })
      .reduce((sum, [, val]) => sum + val, 0);
  }

  function getClassFilterLabel(a: AccountAssignment): string {
    if (a.class_filter_mode === "all" || a.qbo_class_ids.length === 0) return "All Classes";
    const names = a.qbo_class_ids
      .map((id) => qboClasses.find((c) => c.id === id)?.name ?? "Unknown")
      .sort();
    const prefix = a.class_filter_mode === "include" ? "Include: " : "Exclude: ";
    return prefix + names.join(", ");
  }

  // ── Render ───────────────────────────────────────────────────────────

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Commissions Calculator
          </h1>
          <p className="text-muted-foreground">
            Calculate commission earnings from GL account activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Salesperson
          </Button>
          <Button onClick={handleCalculate} disabled={calculating}>
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label>Year</Label>
              <Select
                value={String(periodYear)}
                onValueChange={(v) => setPeriodYear(Number(v))}
              >
                <SelectTrigger className="w-[100px]">
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
            </div>
            <div className="flex items-center gap-2">
              <Label>Month</Label>
              <Select
                value={String(periodMonth)}
                onValueChange={(v) => setPeriodMonth(Number(v))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {new Date(2000, m - 1).toLocaleString("default", {
                        month: "long",
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="secondary" className="ml-2">
              {getPeriodLabel(periodYear, periodMonth)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue Base</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Expense Deductions
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryExpenses)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Commission Base
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summaryBase)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Commissions
            </CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summaryEarned)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Commissions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Commissions by Salesperson</CardTitle>
          <CardDescription>
            Click a row to view assigned account detail for the period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Percent className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No salesperson profiles</h3>
              <p className="text-muted-foreground mb-4">
                Add a salesperson to start calculating commissions
              </p>
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Salesperson
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue Base</TableHead>
                  <TableHead className="text-right">
                    Expense Deductions
                  </TableHead>
                  <TableHead className="text-right">Commission Base</TableHead>
                  <TableHead className="text-right">
                    Commission Earned
                  </TableHead>
                  <TableHead className="text-center">Payable</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => {
                  const result = getResultForProfile(profile.id);
                  const isExpanded = expandedRows.has(profile.id);
                  const profileAssignments = assignments[profile.id] ?? [];

                  return (
                    <>
                      <TableRow
                        key={profile.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleRow(profile.id)}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {profile.name}
                          {!profile.is_active && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-xs"
                            >
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercentage(Number(profile.commission_rate))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.total_revenue))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.total_expenses))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {result
                            ? formatCurrency(Number(result.commission_base))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {result
                            ? formatCurrency(Number(result.commission_earned))
                            : "—"}
                        </TableCell>
                        <TableCell
                          className="text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {result && (
                            <Checkbox
                              checked={result.is_payable}
                              onCheckedChange={(checked) =>
                                handleMarkPayable(
                                  result.id,
                                  checked as boolean
                                )
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(profile)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDeleteProfile(profile.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {/* Expanded detail row */}
                      {isExpanded && profileAssignments.length > 0 && (
                        <TableRow key={`${profile.id}-detail`}>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <div className="px-8 py-4">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Account #</TableHead>
                                    <TableHead>Account Name</TableHead>
                                    <TableHead>Type</TableHead>
                                    {qboClasses.length > 0 && (
                                      <TableHead>Class</TableHead>
                                    )}
                                    <TableHead className="text-center">
                                      Role
                                    </TableHead>
                                    <TableHead className="text-right">
                                      Net Change
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {profileAssignments.map((a) => {
                                    const rawChange = getAssignmentRawBalance(a);
                                    // Negate revenue accounts (GL stores credits as negative)
                                    const netChange =
                                      a.role === "revenue"
                                        ? rawChange * -1
                                        : rawChange;
                                    return (
                                      <TableRow key={a.id}>
                                        <TableCell className="font-mono text-muted-foreground">
                                          {a.accounts?.account_number ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                          {a.accounts?.name ?? "Unknown"}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                          {a.accounts?.account_type ?? "—"}
                                        </TableCell>
                                        {qboClasses.length > 0 && (
                                          <TableCell className="text-muted-foreground text-xs max-w-[200px]">
                                            <span title={getClassFilterLabel(a)}>
                                              {a.class_filter_mode === "all" ? (
                                                "All Classes"
                                              ) : (
                                                <span className="flex items-center gap-1 flex-wrap">
                                                  <Badge
                                                    variant={a.class_filter_mode === "include" ? "default" : "destructive"}
                                                    className="text-[10px] px-1.5 py-0"
                                                  >
                                                    {a.class_filter_mode === "include" ? "Include" : "Exclude"}
                                                  </Badge>
                                                  {a.qbo_class_ids
                                                    .map((id) => qboClasses.find((c) => c.id === id)?.name ?? "?")
                                                    .join(", ")}
                                                </span>
                                              )}
                                            </span>
                                          </TableCell>
                                        )}
                                        <TableCell className="text-center">
                                          <Badge
                                            variant={
                                              a.role === "revenue"
                                                ? "default"
                                                : "secondary"
                                            }
                                          >
                                            {a.role === "revenue"
                                              ? "Revenue (+)"
                                              : "Expense (-)"}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                          {formatCurrency(netChange)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isExpanded && profileAssignments.length === 0 && (
                        <TableRow key={`${profile.id}-empty`}>
                          <TableCell
                            colSpan={9}
                            className="bg-muted/30 text-center py-4 text-muted-foreground"
                          >
                            No accounts assigned. Edit this salesperson to add
                            revenue/expense accounts.
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {/* Totals Row */}
                {results.length > 0 && (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell>Totals</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryRevenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryExpenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryBase)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(summaryEarned)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Salesperson Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? "Edit Salesperson" : "Add Salesperson"}
            </DialogTitle>
            <DialogDescription>
              Configure the salesperson name, commission rate, and which GL
              accounts contribute to their commission calculation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Salesperson Name</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>

            {/* Rate */}
            <div className="space-y-2">
              <Label htmlFor="rate">Commission Rate (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formRate}
                  onChange={(e) => setFormRate(e.target.value)}
                  placeholder="e.g. 5.00"
                  className="w-[140px]"
                />
                <span className="text-muted-foreground">%</span>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>

            {/* Account Assignments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Account Assignments</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addAssignmentRow}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Account
                </Button>
              </div>

              {formAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No accounts assigned yet. Click &quot;Add Account&quot; to select
                  revenue or expense accounts.
                </p>
              ) : (
                <div className="space-y-2">
                  {formAssignments.map((assignment, index) => {
                    const selectedAccount = accounts.find(
                      (a) => a.id === assignment.account_id
                    );

                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 rounded-md border"
                      >
                        {/* Account Picker */}
                        <Popover
                          open={openPopovers[index] ?? false}
                          onOpenChange={(open) =>
                            setOpenPopovers((prev) => ({
                              ...prev,
                              [index]: open,
                            }))
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="flex-1 justify-between text-sm"
                            >
                              {selectedAccount
                                ? `${selectedAccount.account_number ?? ""} ${selectedAccount.name}`.trim()
                                : "Select account..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[320px] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Search accounts..." />
                              <CommandList>
                                <CommandEmpty>No accounts found.</CommandEmpty>
                                {Object.entries(groupedAccounts).map(
                                  ([classification, accts]) => (
                                    <CommandGroup
                                      key={classification}
                                      heading={classification}
                                    >
                                      {accts.map((acct) => (
                                        <CommandItem
                                          key={acct.id}
                                          value={`${acct.account_number ?? ""} ${acct.name} ${acct.account_type}`}
                                          onSelect={() => {
                                            updateAssignment(
                                              index,
                                              "account_id",
                                              acct.id
                                            );
                                            // Auto-set role based on classification
                                            if (
                                              acct.classification === "Revenue"
                                            ) {
                                              updateAssignment(
                                                index,
                                                "role",
                                                "revenue"
                                              );
                                            } else if (
                                              acct.classification === "Expense"
                                            ) {
                                              updateAssignment(
                                                index,
                                                "role",
                                                "expense"
                                              );
                                            }
                                            setOpenPopovers((prev) => ({
                                              ...prev,
                                              [index]: false,
                                            }));
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              assignment.account_id === acct.id
                                                ? "opacity-100"
                                                : "opacity-0"
                                            )}
                                          />
                                          <div className="flex flex-col">
                                            <span className="text-sm">
                                              {acct.account_number && (
                                                <span className="font-mono text-muted-foreground mr-1">
                                                  {acct.account_number}
                                                </span>
                                              )}
                                              {acct.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                              {acct.account_type}
                                            </span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  )
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>

                        {/* Role Selector */}
                        <Select
                          value={assignment.role}
                          onValueChange={(v) =>
                            updateAssignment(
                              index,
                              "role",
                              v as "revenue" | "expense"
                            )
                          }
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="revenue">
                              Revenue (+)
                            </SelectItem>
                            <SelectItem value="expense">
                              Expense (-)
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        {/* Class Filter (optional) */}
                        {qboClasses.length > 0 && (
                          <div className="flex items-center gap-1">
                            {/* Mode Selector */}
                            <Select
                              value={assignment.class_filter_mode}
                              onValueChange={(v) =>
                                updateAssignment(index, "class_filter_mode", v)
                              }
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Classes</SelectItem>
                                <SelectItem value="include">Include</SelectItem>
                                <SelectItem value="exclude">Exclude</SelectItem>
                              </SelectContent>
                            </Select>

                            {/* Multi-select class picker (only when include/exclude) */}
                            {assignment.class_filter_mode !== "all" && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className="w-[150px] justify-between text-xs"
                                  >
                                    {assignment.qbo_class_ids.length === 0
                                      ? "Select classes..."
                                      : `${assignment.qbo_class_ids.length} selected`}
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[220px] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search classes..." />
                                    <CommandList>
                                      <CommandEmpty>No classes found.</CommandEmpty>
                                      <CommandGroup>
                                        {qboClasses.map((cls) => (
                                          <CommandItem
                                            key={cls.id}
                                            value={cls.name}
                                            onSelect={() => toggleClassId(index, cls.id)}
                                          >
                                            <div className={cn(
                                              "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                              assignment.qbo_class_ids.includes(cls.id)
                                                ? "bg-primary text-primary-foreground"
                                                : "opacity-50"
                                            )}>
                                              {assignment.qbo_class_ids.includes(cls.id) && (
                                                <Check className="h-3 w-3" />
                                              )}
                                            </div>
                                            {cls.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        )}

                        {/* Remove */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeAssignmentRow(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save / Cancel */}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingProfile ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
