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
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import type { CustomVehicleClassRow } from "@/lib/utils/vehicle-classification";
import type { VehicleMasterType } from "@/lib/types/database";

interface ClassSettingsProps {
  entityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClassesChanged: () => void;
}

interface EditingRow {
  id?: string;
  class_code: string;
  class_name: string;
  reporting_group: string;
  master_type: VehicleMasterType;
}

const EMPTY_ROW: EditingRow = {
  class_code: "",
  class_name: "",
  reporting_group: "",
  master_type: "Vehicle",
};

export function ClassSettings({
  entityId,
  open,
  onOpenChange,
  onClassesChanged,
}: ClassSettingsProps) {
  const [classes, setClasses] = useState<CustomVehicleClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EditingRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/assets/classes?entityId=${entityId}`);
    if (res.ok) {
      setClasses(await res.json());
    }
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    if (open) loadClasses();
  }, [open, loadClasses]);

  const startAdd = () => {
    setEditing({ ...EMPTY_ROW });
    setIsNew(true);
  };

  const startEdit = (row: CustomVehicleClassRow) => {
    setEditing({
      id: row.id,
      class_code: row.class_code,
      class_name: row.class_name,
      reporting_group: row.reporting_group,
      master_type: row.master_type as VehicleMasterType,
    });
    setIsNew(false);
  };

  const cancelEdit = () => {
    setEditing(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (
      !editing.class_code.trim() ||
      !editing.class_name.trim() ||
      !editing.reporting_group.trim()
    ) {
      toast.error("All fields are required");
      return;
    }

    setSaving(true);
    const method = isNew ? "POST" : "PUT";
    const body = isNew ? { entity_id: entityId, ...editing } : editing;

    const res = await fetch("/api/assets/classes", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast.success(isNew ? "Class created" : "Class updated");
      setEditing(null);
      setIsNew(false);
      await loadClasses();
      onClassesChanged();
    } else {
      const err = await res.json();
      toast.error(err.error || "Failed to save");
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const res = await fetch(`/api/assets/classes?id=${deleteId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Class deleted");
      setDeleteId(null);
      await loadClasses();
      onClassesChanged();
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
            <SheetTitle>Asset Class Settings</SheetTitle>
            <SheetDescription>
              Create custom asset classes that link to Vehicle or Trailer for
              GL grouping. Custom classes appear alongside built-in classes in
              all dropdowns.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Custom Classes</h3>
              <Button size="sm" onClick={startAdd} disabled={!!editing}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Class
              </Button>
            </div>

            {/* Add/Edit Form */}
            {editing && (
              <div className="rounded-lg border p-4 space-y-3 bg-muted/40">
                <p className="text-sm font-medium">
                  {isNew ? "New Class" : "Edit Class"}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Class Code</Label>
                    <Input
                      placeholder="e.g. 60"
                      value={editing.class_code}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          class_code: e.target.value,
                        })
                      }
                      disabled={!isNew}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Class Name</Label>
                    <Input
                      placeholder="e.g. Generator"
                      value={editing.class_name}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          class_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reporting Group</Label>
                    <Input
                      placeholder="e.g. Power Equipment"
                      value={editing.reporting_group}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          reporting_group: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Master Type (GL Link)</Label>
                    <Select
                      value={editing.master_type}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          master_type: v as VehicleMasterType,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Vehicle">Vehicle</SelectItem>
                        <SelectItem value="Trailer">Trailer</SelectItem>
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

            {/* Class Table */}
            {loading ? (
              <p className="text-sm text-muted-foreground py-4">
                Loading...
              </p>
            ) : classes.length === 0 && !editing ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No custom classes yet. Click &quot;Add Class&quot; to create
                one.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono font-medium">
                        {row.class_code}
                      </TableCell>
                      <TableCell>{row.class_name}</TableCell>
                      <TableCell>{row.reporting_group}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.master_type === "Vehicle"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {row.master_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => startEdit(row)}
                            disabled={!!editing}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteId(row.id)}
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
            <AlertDialogTitle>Delete custom class?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the custom class definition. Existing assets
              using this class code will keep their code but won&apos;t match
              a classification until reassigned.
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
