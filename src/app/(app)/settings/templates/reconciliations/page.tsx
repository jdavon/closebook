"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, GripVertical } from "lucide-react";
import type { ReconciliationFieldDef } from "@/lib/types/database";

interface ReconciliationTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  field_definitions: ReconciliationFieldDef[];
  variance_tolerance_amount: number | null;
  variance_tolerance_percentage: number | null;
  is_active: boolean;
  display_order: number | null;
}

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select (Dropdown)" },
];

const CATEGORIES = [
  "Balance Sheet",
  "Bank Reconciliation",
  "Debt",
  "Fixed Assets",
  "Leases",
  "Payroll",
  "Revenue",
  "Intercompany",
  "Other",
];

export default function ReconciliationTemplatesPage() {
  const [templates, setTemplates] = useState<ReconciliationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReconciliationTemplate | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Balance Sheet");
  const [toleranceAmount, setToleranceAmount] = useState("");
  const [tolerancePercentage, setTolerancePercentage] = useState("");
  const [fields, setFields] = useState<ReconciliationFieldDef[]>([]);
  const [saving, setSaving] = useState(false);

  // New field state
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<ReconciliationFieldDef["fieldType"]>("text");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState("");

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/close/reconciliation-templates");
    const data = await res.json();
    setTemplates(data.templates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  function resetForm() {
    setName("");
    setDescription("");
    setCategory("Balance Sheet");
    setToleranceAmount("");
    setTolerancePercentage("");
    setFields([]);
    setEditingTemplate(null);
    resetNewField();
  }

  function resetNewField() {
    setNewFieldName("");
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewFieldRequired(false);
    setNewFieldOptions("");
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(t: ReconciliationTemplate) {
    setEditingTemplate(t);
    setName(t.name);
    setDescription(t.description ?? "");
    setCategory(t.category);
    setToleranceAmount(t.variance_tolerance_amount?.toString() ?? "");
    setTolerancePercentage(t.variance_tolerance_percentage?.toString() ?? "");
    setFields(t.field_definitions ?? []);
    setDialogOpen(true);
  }

  function addField() {
    if (!newFieldName.trim() || !newFieldLabel.trim()) {
      toast.error("Field name and label are required");
      return;
    }

    const field: ReconciliationFieldDef = {
      fieldName: newFieldName.trim(),
      fieldLabel: newFieldLabel.trim(),
      fieldType: newFieldType,
      required: newFieldRequired,
    };

    if (newFieldType === "select" && newFieldOptions.trim()) {
      field.options = newFieldOptions
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
    }

    setFields([...fields, field]);
    resetNewField();
  }

  function removeField(index: number) {
    setFields(fields.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!name.trim() || !category) {
      toast.error("Name and category are required");
      return;
    }

    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      category,
      fieldDefinitions: fields,
      varianceToleranceAmount: toleranceAmount ? parseFloat(toleranceAmount) : null,
      varianceTolerancePercentage: tolerancePercentage ? parseFloat(tolerancePercentage) : null,
    };

    let res: Response;

    if (editingTemplate) {
      res = await fetch("/api/close/reconciliation-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingTemplate.id, ...payload }),
      });
    } else {
      res = await fetch("/api/close/reconciliation-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Failed to save template");
    } else {
      toast.success(editingTemplate ? "Template updated" : "Template created");
      setDialogOpen(false);
      resetForm();
      loadTemplates();
    }

    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/close/reconciliation-templates?id=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to delete template");
    } else {
      toast.success("Template deleted");
      loadTemplates();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Reconciliation Templates
          </h1>
          <p className="text-muted-foreground">
            Define reusable workpaper templates for reconciliation tasks during
            close.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? "Edit Template" : "New Reconciliation Template"}
              </DialogTitle>
              <DialogDescription>
                Configure the template fields and variance tolerances for this
                reconciliation type.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Bank Reconciliation"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe when this template should be used"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Variance Tolerance ($)</Label>
                  <Input
                    type="number"
                    value={toleranceAmount}
                    onChange={(e) => setToleranceAmount(e.target.value)}
                    placeholder="e.g. 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Variance Tolerance (%)</Label>
                  <Input
                    type="number"
                    value={tolerancePercentage}
                    onChange={(e) => setTolerancePercentage(e.target.value)}
                    placeholder="e.g. 1.0"
                    step="0.1"
                  />
                </div>
              </div>

              {/* Field definitions */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Custom Fields</Label>
                <p className="text-xs text-muted-foreground">
                  Define additional fields that users will fill out when
                  completing this workpaper. GL Balance, Sub Balance, and
                  Variance are always included.
                </p>

                {fields.length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Required</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fields.map((f, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">{f.fieldLabel}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({f.fieldName})
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{f.fieldType}</Badge>
                            </TableCell>
                            <TableCell>
                              {f.required ? "Yes" : "No"}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeField(i)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Add field form */}
                <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                  <p className="text-xs font-medium">Add Field</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Field Name (key)</Label>
                      <Input
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        placeholder="e.g. outstanding_checks"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={newFieldLabel}
                        onChange={(e) => setNewFieldLabel(e.target.value)}
                        placeholder="e.g. Outstanding Checks"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={newFieldType}
                        onValueChange={(v) =>
                          setNewFieldType(v as ReconciliationFieldDef["fieldType"])
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((ft) => (
                            <SelectItem key={ft.value} value={ft.value}>
                              {ft.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="new-field-required"
                          checked={newFieldRequired}
                          onCheckedChange={(v) => setNewFieldRequired(v === true)}
                        />
                        <Label htmlFor="new-field-required" className="text-xs">
                          Required
                        </Label>
                      </div>
                    </div>
                  </div>
                  {newFieldType === "select" && (
                    <div className="space-y-1">
                      <Label className="text-xs">
                        Options (comma-separated)
                      </Label>
                      <Input
                        value={newFieldOptions}
                        onChange={(e) => setNewFieldOptions(e.target.value)}
                        placeholder="e.g. Yes, No, N/A"
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addField}
                    disabled={!newFieldName.trim() || !newFieldLabel.trim()}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Field
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()}>
                {editingTemplate ? "Update Template" : "Create Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Templates list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reconciliation templates defined yet. Create one to get
              started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Tolerance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
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
                    <TableCell>{t.category}</TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {(t.field_definitions?.length ?? 0)} custom field
                        {(t.field_definitions?.length ?? 0) !== 1 ? "s" : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {t.variance_tolerance_amount != null && (
                          <span>${t.variance_tolerance_amount.toLocaleString()}</span>
                        )}
                        {t.variance_tolerance_amount != null &&
                          t.variance_tolerance_percentage != null && (
                            <span> / </span>
                          )}
                        {t.variance_tolerance_percentage != null && (
                          <span>{t.variance_tolerance_percentage}%</span>
                        )}
                        {t.variance_tolerance_amount == null &&
                          t.variance_tolerance_percentage == null && (
                            <span className="text-muted-foreground">—</span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.is_active ? "default" : "secondary"}>
                        {t.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(t)}
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
