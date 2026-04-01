"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { getAllReportingGroups, type VehicleClassification } from "@/lib/utils/vehicle-classification";

export interface DepreciationRule {
  id: string;
  entity_id: string;
  reporting_group: string;
  book_useful_life_months: number | null;
  book_salvage_pct: number | null;
  book_depreciation_method: string;
  created_at: string;
  updated_at: string;
}

interface DepreciationRulesSettingsProps {
  entityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRulesChanged: () => void;
  customClasses?: VehicleClassification[];
}

interface EditingRule {
  id?: string;
  reporting_group: string;
  book_useful_life_months: string;
  book_salvage_pct: string;
  book_depreciation_method: string;
}

const EMPTY_RULE: EditingRule = {
  reporting_group: "",
  book_useful_life_months: "",
  book_salvage_pct: "",
  book_depreciation_method: "straight_line",
};

export function DepreciationRulesSettings({
  entityId,
  open,
  onOpenChange,
  onRulesChanged,
  customClasses,
}: DepreciationRulesSettingsProps) {
  const [rules, setRules] = useState<DepreciationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EditingRule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/assets/depreciation-rules?entityId=${entityId}`);
    if (res.ok) {
      setRules(await res.json());
    }
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    if (open) loadRules();
  }, [open, loadRules]);

  const existingGroups = new Set(rules.map((r) => r.reporting_group));
  const allGroups = getAllReportingGroups(customClasses);
  const availableGroups = allGroups.filter((g) => !existingGroups.has(g));

  const startAdd = () => {
    setEditing({ ...EMPTY_RULE });
    setIsNew(true);
  };

  const startEdit = (rule: DepreciationRule) => {
    setEditing({
      id: rule.id,
      reporting_group: rule.reporting_group,
      book_useful_life_months: rule.book_useful_life_months?.toString() ?? "",
      book_salvage_pct: rule.book_salvage_pct?.toString() ?? "",
      book_depreciation_method: rule.book_depreciation_method,
    });
    setIsNew(false);
  };

  const cancelEdit = () => {
    setEditing(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.reporting_group.trim()) {
      toast.error("Reporting group is required");
      return;
    }

    setSaving(true);
    const method = isNew ? "POST" : "PUT";
    const payload: Record<string, unknown> = {
      book_useful_life_months: editing.book_useful_life_months
        ? parseInt(editing.book_useful_life_months)
        : null,
      book_salvage_pct: editing.book_salvage_pct
        ? parseFloat(editing.book_salvage_pct)
        : null,
      book_depreciation_method: editing.book_depreciation_method,
    };

    if (isNew) {
      payload.entity_id = entityId;
      payload.reporting_group = editing.reporting_group;
    } else {
      payload.id = editing.id;
    }

    const res = await fetch("/api/assets/depreciation-rules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast.success(isNew ? "Rule created" : "Rule updated");
      setEditing(null);
      setIsNew(false);
      await loadRules();
      onRulesChanged();
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to save");
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const res = await fetch(`/api/assets/depreciation-rules?id=${deleteId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Rule deleted");
      setDeleteId(null);
      await loadRules();
      onRulesChanged();
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to delete");
    }
    setDeleting(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Depreciation Rules by Group</SheetTitle>
            <SheetDescription>
              Set default depreciation assumptions per reporting group. These
              apply to assets that don&apos;t have useful life or salvage value
              set directly on the asset record.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Group Rules</h3>
              <Button
                size="sm"
                onClick={startAdd}
                disabled={!!editing || availableGroups.length === 0}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Rule
              </Button>
            </div>

            {editing && (
              <div className="rounded-lg border p-4 space-y-3 bg-muted/40">
                <p className="text-sm font-medium">
                  {isNew ? "New Rule" : `Edit Rule: ${editing.reporting_group}`}
                </p>
                <div className="space-y-3">
                  {isNew && (
                    <div className="space-y-1">
                      <Label className="text-xs">Reporting Group</Label>
                      <Select
                        value={editing.reporting_group}
                        onValueChange={(v) =>
                          setEditing({ ...editing, reporting_group: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select group..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableGroups.map((g) => (
                            <SelectItem key={g} value={g}>
                              {g}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Useful Life (months)</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 60"
                        value={editing.book_useful_life_months}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            book_useful_life_months: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Salvage Value (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 10"
                        value={editing.book_salvage_pct}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            book_salvage_pct: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Depreciation Method</Label>
                    <Select
                      value={editing.book_depreciation_method}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          book_depreciation_method: v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="straight_line">
                          Straight Line
                        </SelectItem>
                        <SelectItem value="declining_balance">
                          Declining Balance
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground py-4">Loading...</p>
            ) : rules.length === 0 && !editing ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No depreciation rules yet. Click &quot;Add Rule&quot; to set
                defaults for a reporting group.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">UL (mo)</TableHead>
                    <TableHead className="text-right">Salvage %</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">
                        {rule.reporting_group}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rule.book_useful_life_months ?? "---"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rule.book_salvage_pct != null
                          ? `${rule.book_salvage_pct}%`
                          : "---"}
                      </TableCell>
                      <TableCell className="capitalize text-sm">
                        {rule.book_depreciation_method.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => startEdit(rule)}
                            disabled={!!editing}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteId(rule.id)}
                            disabled={!!editing}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete depreciation rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the default depreciation assumptions for this
              reporting group. Assets that already have depreciation parameters
              set will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
