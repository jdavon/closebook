"use client";

import { useState, useEffect, useCallback } from "react";
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
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";

interface MaterialityThreshold {
  id: string;
  name: string;
  description: string | null;
  threshold_amount: number | null;
  threshold_percentage: number | null;
  applies_to_category: string | null;
  is_active: boolean;
}

const THRESHOLD_TYPES = [
  { value: "absolute", label: "Absolute Amount" },
  { value: "percentage", label: "Percentage of Balance" },
  { value: "both", label: "Both (lower of)" },
];

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "Reconciliation", label: "Reconciliation" },
  { value: "Accruals", label: "Accruals" },
  { value: "Review", label: "Review" },
  { value: "Reporting", label: "Reporting" },
];

export default function MaterialityThresholdsPage() {
  const [thresholds, setThresholds] = useState<MaterialityThreshold[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [thresholdType, setThresholdType] = useState("absolute");
  const [amount, setAmount] = useState("");
  const [percentage, setPercentage] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editType, setEditType] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPercentage, setEditPercentage] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const loadThresholds = useCallback(async () => {
    const res = await fetch("/api/close/materiality");
    const data = await res.json();
    setThresholds(data.thresholds ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadThresholds();
  }, [loadThresholds]);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    setCreating(true);
    const res = await fetch("/api/close/materiality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        thresholdAmount: amount ? parseFloat(amount) : null,
        thresholdPercentage: percentage ? parseFloat(percentage) : null,
        appliesToCategory: category === "__all" ? null : category || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Failed to create threshold");
    } else {
      toast.success("Threshold created");
      setName("");
      setDescription("");
      setThresholdType("absolute");
      setAmount("");
      setPercentage("");
      setCategory("");
      loadThresholds();
    }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/close/materiality?id=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to delete threshold");
    } else {
      toast.success("Threshold deleted");
      loadThresholds();
    }
  }

  function startEdit(t: MaterialityThreshold) {
    setEditId(t.id);
    setEditName(t.name);
    setEditDescription(t.description ?? "");
    const hasAmt = t.threshold_amount != null;
    const hasPct = t.threshold_percentage != null;
    setEditType(hasAmt && hasPct ? "both" : hasPct ? "percentage" : "absolute");
    setEditAmount(t.threshold_amount?.toString() ?? "");
    setEditPercentage(t.threshold_percentage?.toString() ?? "");
    setEditCategory(t.applies_to_category ?? "");
  }

  async function saveEdit() {
    if (!editId) return;

    const res = await fetch("/api/close/materiality", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        thresholdAmount: editAmount ? parseFloat(editAmount) : null,
        thresholdPercentage: editPercentage ? parseFloat(editPercentage) : null,
        appliesToCategory: editCategory === "__all" ? null : editCategory || null,
      }),
    });

    if (!res.ok) {
      toast.error("Failed to update threshold");
    } else {
      toast.success("Threshold updated");
      setEditId(null);
      loadThresholds();
    }
  }

  function formatThresholdValue(t: MaterialityThreshold) {
    const parts: string[] = [];
    if (t.threshold_amount != null) {
      parts.push(`$${t.threshold_amount.toLocaleString()}`);
    }
    if (t.threshold_percentage != null) {
      parts.push(`${t.threshold_percentage}%`);
    }
    if (parts.length === 2) {
      return `Lower of ${parts.join(" or ")}`;
    }
    return parts.join(" / ") || "—";
  }

  function getThresholdType(t: MaterialityThreshold) {
    const hasAmt = t.threshold_amount != null;
    const hasPct = t.threshold_percentage != null;
    if (hasAmt && hasPct) return "Both";
    if (hasPct) return "Percentage";
    return "Absolute";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Materiality Thresholds
        </h1>
        <p className="text-muted-foreground">
          Define variance tolerances for close tasks. Variances below these
          thresholds can be waived as immaterial during close.
        </p>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New Threshold</CardTitle>
          <CardDescription>
            Add a materiality threshold rule for your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Reconciliation"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label>Threshold Type</Label>
              <Select value={thresholdType} onValueChange={setThresholdType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(thresholdType === "absolute" || thresholdType === "both") && (
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500"
                />
              </div>
            )}
            {(thresholdType === "percentage" || thresholdType === "both") && (
              <div className="space-y-2">
                <Label>Percentage (%)</Label>
                <Input
                  type="number"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  placeholder="e.g. 1.0"
                  step="0.1"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Applies To Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value || "__all"} value={c.value || "__all"}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="mt-4"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Threshold
          </Button>
        </CardContent>
      </Card>

      {/* Existing thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : thresholds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No materiality thresholds configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thresholds.map((t) =>
                  editId === t.id ? (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={editType} onValueChange={setEditType}>
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {THRESHOLD_TYPES.map((tt) => (
                              <SelectItem key={tt.value} value={tt.value}>
                                {tt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {(editType === "absolute" || editType === "both") && (
                            <Input
                              type="number"
                              value={editAmount}
                              onChange={(e) => setEditAmount(e.target.value)}
                              placeholder="$"
                              className="h-8 w-24"
                            />
                          )}
                          {(editType === "percentage" || editType === "both") && (
                            <Input
                              type="number"
                              value={editPercentage}
                              onChange={(e) => setEditPercentage(e.target.value)}
                              placeholder="%"
                              className="h-8 w-20"
                              step="0.1"
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={editCategory || "__all"} onValueChange={(v) => setEditCategory(v === "__all" ? "" : v)}>
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c.value || "__all"} value={c.value || "__all"}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={saveEdit}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{t.name}</span>
                          {t.description && (
                            <p className="text-xs text-muted-foreground">
                              {t.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getThresholdType(t)}
                      </TableCell>
                      <TableCell>{formatThresholdValue(t)}</TableCell>
                      <TableCell>
                        {t.applies_to_category ?? "All"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => startEdit(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDelete(t.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
