"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import type { Scope, AllocationAdjustment } from "./types";

const MONTHS = [
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

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];

function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]?.slice(0, 3)} ${year}`;
}

function formatPeriodRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): string {
  return `${formatPeriod(startYear, startMonth)} – ${formatPeriod(endYear, endMonth)}`;
}

/** Count months in a range (inclusive) */
function countMonthsInRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): number {
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

interface MasterAccountOption {
  id: string;
  account_number: string;
  name: string;
  classification: string;
  account_type: string;
}

interface AllocationTabProps {
  organizationId: string | null;
  entities: Array<{ id: string; name: string; code: string }>;
  scope: Scope;
  selectedEntityId: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  onAllocationActivated?: () => void;
}

export function AllocationTab({
  organizationId,
  entities,
  scope,
  selectedEntityId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  onAllocationActivated,
}: AllocationTabProps) {
  const supabase = createClient();

  // Data state
  const [allocations, setAllocations] = useState<AllocationAdjustment[]>([]);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccountOption[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formSourceEntityId, setFormSourceEntityId] = useState<string>("");
  const [formDestEntityId, setFormDestEntityId] = useState<string>("");
  const [formMasterAccountId, setFormMasterAccountId] = useState<string>("");
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formScheduleType, setFormScheduleType] = useState<
    "single_month" | "monthly_spread"
  >("single_month");
  // Single month fields
  const [formYear, setFormYear] = useState(endYear);
  const [formMonth, setFormMonth] = useState(endMonth);
  // Monthly spread fields
  const [formStartYear, setFormStartYear] = useState(startYear);
  const [formStartMonth, setFormStartMonth] = useState(startMonth);
  const [formEndYear, setFormEndYear] = useState(endYear);
  const [formEndMonth, setFormEndMonth] = useState(endMonth);

  // Load allocations
  const loadAllocations = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from("allocation_adjustments")
      .select(
        `
        *,
        source:entities!allocation_adjustments_source_entity_id_fkey(name, code),
        destination:entities!allocation_adjustments_destination_entity_id_fkey(name, code),
        master_accounts!inner(name, account_number)
      `
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (scope === "entity" && selectedEntityId) {
      // Show allocations where the selected entity is source or destination
      query = query.or(
        `source_entity_id.eq.${selectedEntityId},destination_entity_id.eq.${selectedEntityId}`
      );
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load allocations");
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (data ?? []).map((row: any) => ({
      ...row,
      source_entity_name: row.source?.name,
      source_entity_code: row.source?.code,
      destination_entity_name: row.destination?.name,
      destination_entity_code: row.destination?.code,
      master_account_name: row.master_accounts?.name,
      master_account_number: row.master_accounts?.account_number,
    }));

    setAllocations(mapped);
    setLoading(false);
  }, [supabase, organizationId, scope, selectedEntityId]);

  // Load master accounts for dropdown
  const loadMasterAccounts = useCallback(async () => {
    if (!organizationId) return;

    const { data } = await supabase
      .from("master_accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number");

    setMasterAccounts((data as MasterAccountOption[]) ?? []);
  }, [supabase, organizationId]);

  useEffect(() => {
    loadAllocations();
    loadMasterAccounts();
  }, [loadAllocations, loadMasterAccounts]);

  // Reset form
  function resetForm() {
    setEditingId(null);
    setFormSourceEntityId("");
    setFormDestEntityId("");
    setFormMasterAccountId("");
    setFormAmount("");
    setFormDescription("");
    setFormNotes("");
    setFormScheduleType("single_month");
    setFormYear(endYear);
    setFormMonth(endMonth);
    setFormStartYear(startYear);
    setFormStartMonth(startMonth);
    setFormEndYear(endYear);
    setFormEndMonth(endMonth);
  }

  // Open add dialog
  function handleAdd() {
    resetForm();
    setShowDialog(true);
  }

  // Open edit dialog
  function handleEdit(alloc: AllocationAdjustment) {
    setEditingId(alloc.id);
    setFormSourceEntityId(alloc.source_entity_id);
    setFormDestEntityId(alloc.destination_entity_id);
    setFormMasterAccountId(alloc.master_account_id);
    setFormAmount(String(alloc.amount));
    setFormDescription(alloc.description);
    setFormNotes(alloc.notes ?? "");
    setFormScheduleType(alloc.schedule_type);
    if (alloc.schedule_type === "single_month") {
      setFormYear(alloc.period_year ?? endYear);
      setFormMonth(alloc.period_month ?? endMonth);
    } else {
      setFormStartYear(alloc.start_year ?? startYear);
      setFormStartMonth(alloc.start_month ?? startMonth);
      setFormEndYear(alloc.end_year ?? endYear);
      setFormEndMonth(alloc.end_month ?? endMonth);
    }
    setShowDialog(true);
  }

  // Save (create or update)
  async function handleSave() {
    if (
      !formSourceEntityId ||
      !formDestEntityId ||
      !formMasterAccountId ||
      !formDescription.trim()
    ) {
      toast.error(
        "Source entity, destination entity, master account, and description are required"
      );
      return;
    }

    if (formSourceEntityId === formDestEntityId) {
      toast.error("Source and destination entities must be different");
      return;
    }

    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error("Amount must be a non-zero number");
      return;
    }

    if (formScheduleType === "monthly_spread") {
      const months = countMonthsInRange(
        formStartYear,
        formStartMonth,
        formEndYear,
        formEndMonth
      );
      if (months < 1) {
        toast.error("End period must be on or after start period");
        return;
      }
    }

    setSaving(true);

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      source_entity_id: formSourceEntityId,
      destination_entity_id: formDestEntityId,
      master_account_id: formMasterAccountId,
      amount,
      description: formDescription.trim(),
      notes: formNotes.trim() || null,
      schedule_type: formScheduleType,
    };

    if (formScheduleType === "single_month") {
      payload.period_year = formYear;
      payload.period_month = formMonth;
      payload.start_year = null;
      payload.start_month = null;
      payload.end_year = null;
      payload.end_month = null;
    } else {
      payload.period_year = null;
      payload.period_month = null;
      payload.start_year = formStartYear;
      payload.start_month = formStartMonth;
      payload.end_year = formEndYear;
      payload.end_month = formEndMonth;
    }

    if (editingId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("allocation_adjustments")
        .update(payload)
        .eq("id", editingId);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Allocation updated");
        setShowDialog(false);
        loadAllocations();
        onAllocationActivated?.();
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("allocation_adjustments")
        .insert(payload);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Allocation created");
        setShowDialog(false);
        loadAllocations();
        onAllocationActivated?.();
      }
    }

    setSaving(false);
  }

  // Delete
  async function handleDelete(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("allocation_adjustments")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Allocation deleted");
      setAllocations((prev) => prev.filter((a) => a.id !== id));
    }
  }

  // Toggle exclude
  async function handleToggleExclude(id: string, currentValue: boolean) {
    // Optimistic update
    setAllocations((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, is_excluded: !currentValue } : a
      )
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("allocation_adjustments")
      .update({ is_excluded: !currentValue })
      .eq("id", id);

    if (error) {
      // Revert on error
      setAllocations((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, is_excluded: currentValue } : a
        )
      );
      toast.error("Failed to update");
    } else if (currentValue) {
      // Was excluded, now re-included
      onAllocationActivated?.();
    }
  }

  const activeCount = allocations.filter((a) => !a.is_excluded).length;

  // Compute monthly amount for display
  function getMonthlyAmount(alloc: AllocationAdjustment): number | null {
    if (alloc.schedule_type !== "monthly_spread") return null;
    if (
      !alloc.start_year ||
      !alloc.start_month ||
      !alloc.end_year ||
      !alloc.end_month
    )
      return null;
    const months = countMonthsInRange(
      alloc.start_year,
      alloc.start_month,
      alloc.end_year,
      alloc.end_month
    );
    if (months < 1) return null;
    return alloc.amount / months;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Allocation Adjustments</h3>
            <p className="text-sm text-muted-foreground">
              {allocations.length} allocation{allocations.length !== 1 && "s"}
              {allocations.length > 0 && ` (${activeCount} active)`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Move costs between entities. Allocations net to zero at the
              consolidated level.
            </p>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!organizationId}>
            <Plus className="h-4 w-4 mr-1" />
            Add Allocation
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading allocations...
            </p>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No allocation adjustments.{" "}
              {scope === "entity" && !selectedEntityId
                ? "Select an entity to get started."
                : 'Click "Add Allocation" to create one.'}
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">
                      Source → Destination
                    </TableHead>
                    <TableHead className="w-[200px]">Master Account</TableHead>
                    <TableHead className="w-[140px]">Period</TableHead>
                    <TableHead className="w-[120px] text-right">
                      Amount
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[80px] text-center">
                      Excluded
                    </TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((alloc) => {
                    const monthlyAmt = getMonthlyAmount(alloc);
                    return (
                      <TableRow
                        key={alloc.id}
                        className={alloc.is_excluded ? "opacity-50" : ""}
                      >
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">
                              {alloc.source_entity_code}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium">
                              {alloc.destination_entity_code}
                            </span>
                          </div>
                          <span className="text-muted-foreground text-[11px]">
                            {alloc.source_entity_name} →{" "}
                            {alloc.destination_entity_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-medium">
                            {alloc.master_account_number}
                          </span>{" "}
                          — {alloc.master_account_name}
                        </TableCell>
                        <TableCell className="text-xs">
                          {alloc.schedule_type === "single_month" ? (
                            formatPeriod(
                              alloc.period_year!,
                              alloc.period_month!
                            )
                          ) : (
                            <div>
                              <span>
                                {formatPeriodRange(
                                  alloc.start_year!,
                                  alloc.start_month!,
                                  alloc.end_year!,
                                  alloc.end_month!
                                )}
                              </span>
                              <Badge
                                variant="secondary"
                                className="ml-1 text-[9px] py-0"
                              >
                                spread
                              </Badge>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-medium">
                          <div>
                            {formatStatementAmount(alloc.amount, true)}
                          </div>
                          {monthlyAmt !== null && (
                            <div className="text-[10px] text-muted-foreground">
                              {formatStatementAmount(monthlyAmt, true)}/mo
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[300px]">
                          <span className="line-clamp-2">
                            {alloc.description}
                          </span>
                          {alloc.notes && (
                            <span className="text-muted-foreground block text-[11px] line-clamp-1 mt-0.5">
                              {alloc.notes}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={alloc.is_excluded}
                            onCheckedChange={() =>
                              handleToggleExclude(alloc.id, alloc.is_excluded)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleEdit(alloc)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(alloc.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Allocation" : "Add Allocation Adjustment"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the details of this allocation."
                : "Move costs from one entity to another. The source entity will be reduced and the destination increased by the specified amount."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source Entity */}
            <div className="space-y-1.5">
              <Label className="text-xs">Source Entity (costs move from)</Label>
              <Select
                value={formSourceEntityId}
                onValueChange={setFormSourceEntityId}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select source entity..." />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code} — {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Destination Entity */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Destination Entity (costs move to)
              </Label>
              <Select
                value={formDestEntityId}
                onValueChange={setFormDestEntityId}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select destination entity..." />
                </SelectTrigger>
                <SelectContent>
                  {entities
                    .filter((e) => e.id !== formSourceEntityId)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.code} — {e.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Master Account */}
            <div className="space-y-1.5">
              <Label className="text-xs">Master Account</Label>
              <Select
                value={formMasterAccountId}
                onValueChange={setFormMasterAccountId}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select master account..." />
                </SelectTrigger>
                <SelectContent>
                  {masterAccounts.map((ma) => (
                    <SelectItem key={ma.id} value={ma.id}>
                      {ma.account_number} — {ma.name}
                      <Badge
                        variant="outline"
                        className="ml-2 text-[10px] py-0"
                      >
                        {ma.classification}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Schedule Type */}
            <div className="space-y-1.5">
              <Label className="text-xs">Schedule</Label>
              <Select
                value={formScheduleType}
                onValueChange={(v) =>
                  setFormScheduleType(v as "single_month" | "monthly_spread")
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_month">Single Month</SelectItem>
                  <SelectItem value="monthly_spread">
                    Monthly Spread (divide across months)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Period fields */}
            {formScheduleType === "single_month" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Month</Label>
                  <Select
                    value={String(formMonth)}
                    onValueChange={(v) => setFormMonth(parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Year</Label>
                  <Select
                    value={String(formYear)}
                    onValueChange={(v) => setFormYear(parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Month</Label>
                    <Select
                      value={String(formStartMonth)}
                      onValueChange={(v) => setFormStartMonth(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Year</Label>
                    <Select
                      value={String(formStartYear)}
                      onValueChange={(v) => setFormStartYear(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Month</Label>
                    <Select
                      value={String(formEndMonth)}
                      onValueChange={(v) => setFormEndMonth(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Year</Label>
                    <Select
                      value={String(formEndYear)}
                      onValueChange={(v) => setFormEndYear(parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {formScheduleType === "monthly_spread" && (
                  <p className="text-[11px] text-muted-foreground">
                    Total amount will be divided equally across{" "}
                    {countMonthsInRange(
                      formStartYear,
                      formStartMonth,
                      formEndYear,
                      formEndMonth
                    )}{" "}
                    month(s).
                    {formAmount &&
                      !isNaN(parseFloat(formAmount)) &&
                      countMonthsInRange(
                        formStartYear,
                        formStartMonth,
                        formEndYear,
                        formEndMonth
                      ) > 0 &&
                      ` (${formatStatementAmount(parseFloat(formAmount) / countMonthsInRange(formStartYear, formStartMonth, formEndYear, formEndMonth), true)}/mo)`}
                  </p>
                )}
              </div>
            )}

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                This amount will be removed from the source entity and added to
                the destination entity for the selected account.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the nature of this allocation..."
                className="text-xs min-h-[60px] max-h-[120px]"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional details..."
                className="text-xs min-h-[40px] max-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDialog(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving
                ? "Saving..."
                : editingId
                  ? "Update"
                  : "Add Allocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
