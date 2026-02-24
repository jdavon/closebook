"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Upload,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Star,
} from "lucide-react";

interface BudgetVersion {
  id: string;
  entity_id: string;
  name: string;
  fiscal_year: number;
  status: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface PreviewRow {
  accountNumber: string;
  accountName: string;
  accountId: string | null;
  months: Record<string, number>;
  status: "matched" | "unmatched" | "error";
  message?: string;
}

interface PreviewResult {
  rows: PreviewRow[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    monthsFound: number[];
  };
}

const CURRENT_YEAR = new Date().getFullYear();
const FISCAL_YEARS = [
  CURRENT_YEAR - 1,
  CURRENT_YEAR,
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
];

export default function BudgetPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = use(params);

  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [loading, setLoading] = useState(true);

  // New version dialog
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newYear, setNewYear] = useState(String(CURRENT_YEAR));
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);

  // Import state
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    accounts: number;
    amounts: number;
  } | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budgets?entityId=${entityId}`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  async function handleCreateVersion() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          name: newName.trim(),
          fiscalYear: parseInt(newYear),
          notes: newNotes.trim() || null,
        }),
      });
      if (res.ok) {
        setShowNewDialog(false);
        setNewName("");
        setNewNotes("");
        fetchVersions();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleSetActive(versionId: string) {
    await fetch("/api/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, is_active: true }),
    });
    fetchVersions();
  }

  async function handleDelete(versionId: string) {
    if (!confirm("Delete this budget version and all its amounts?")) return;
    await fetch(`/api/budgets?versionId=${versionId}`, { method: "DELETE" });
    fetchVersions();
  }

  async function handleArchive(versionId: string) {
    await fetch("/api/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, status: "archived" }),
    });
    fetchVersions();
  }

  async function handleApprove(versionId: string) {
    await fetch("/api/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, status: "approved", is_active: true }),
    });
    fetchVersions();
  }

  async function handlePreview() {
    if (!importFile || !selectedVersionId) return;
    setImporting(true);
    setPreview(null);
    setImportResult(null);

    const version = versions.find((v) => v.id === selectedVersionId);

    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("entityId", entityId);
      formData.append("versionId", selectedVersionId);
      formData.append("fiscalYear", String(version?.fiscal_year ?? CURRENT_YEAR));
      formData.append("mode", "preview");

      const res = await fetch("/api/budgets/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data);
      } else {
        alert(data.error ?? "Preview failed");
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleCommit() {
    if (!importFile || !selectedVersionId) return;
    setImporting(true);

    const version = versions.find((v) => v.id === selectedVersionId);

    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("entityId", entityId);
      formData.append("versionId", selectedVersionId);
      formData.append("fiscalYear", String(version?.fiscal_year ?? CURRENT_YEAR));
      formData.append("mode", "commit");

      const res = await fetch("/api/budgets/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data.imported);
        setPreview(null);
        setImportFile(null);
      } else {
        alert(data.error ?? "Import failed");
      }
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const version = versions.find((v) => v.id === selectedVersionId);
    const year = version?.fiscal_year ?? CURRENT_YEAR;
    window.open(
      `/api/budgets/template?entityId=${entityId}&fiscalYear=${year}`,
      "_blank"
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Budget Management
          </h1>
          <p className="text-muted-foreground">
            Create, import, and manage budget versions for financial reporting
          </p>
        </div>
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Budget
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Budget Version</DialogTitle>
              <DialogDescription>
                Create a new budget version for a fiscal year.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="e.g., FY2025 Operating Budget"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Fiscal Year</Label>
                <Select value={newYear} onValueChange={setNewYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FISCAL_YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  placeholder="Optional notes about this budget version"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowNewDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateVersion}
                disabled={!newName.trim() || creating}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Budget Versions List */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Versions</CardTitle>
          <CardDescription>
            Manage budget versions. Set one version as active per fiscal year
            for financial statement comparisons.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : versions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No budget versions yet. Create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell>{v.fiscal_year}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          v.status === "approved"
                            ? "default"
                            : v.status === "archived"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {v.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {v.is_active && (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!v.is_active && v.status !== "archived" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetActive(v.id)}
                            title="Set as active"
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {v.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleApprove(v.id)}
                            title="Approve"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {v.status !== "archived" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleArchive(v.id)}
                            title="Archive"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(v.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
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

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle>Import Budget Data</CardTitle>
          <CardDescription>
            Upload an XLSX file with monthly budget amounts. Download a template
            pre-populated with your accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Version selector */}
          <div className="space-y-2">
            <Label>Budget Version</Label>
            <Select
              value={selectedVersionId ?? ""}
              onValueChange={setSelectedVersionId}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a budget version..." />
              </SelectTrigger>
              <SelectContent>
                {versions
                  .filter((v) => v.status !== "archived")
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} ({v.fiscal_year})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {selectedVersionId && (
            <>
              {/* Template download */}
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
                <span className="text-xs text-muted-foreground">
                  Pre-populated with your P&L accounts
                </span>
              </div>

              {/* File upload */}
              <div className="space-y-2">
                <Label>Upload Budget File</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] ?? null);
                      setPreview(null);
                      setImportResult(null);
                    }}
                    className="w-[300px]"
                  />
                  <Button
                    onClick={handlePreview}
                    disabled={!importFile || importing}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {importing ? "Processing..." : "Preview Import"}
                  </Button>
                </div>
              </div>

              {/* Import result */}
              {importResult && (
                <div className="rounded-md bg-green-50 dark:bg-green-950 p-4 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800 dark:text-green-200">
                      Import successful
                    </span>
                  </div>
                  <p className="mt-1 text-green-700 dark:text-green-300">
                    Imported {importResult.amounts} budget amounts across{" "}
                    {importResult.accounts} accounts.
                  </p>
                </div>
              )}

              {/* Preview table */}
              {preview && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-medium">
                        {preview.summary.matched}
                      </span>{" "}
                      matched,{" "}
                      <span className="font-medium text-destructive">
                        {preview.summary.unmatched}
                      </span>{" "}
                      unmatched of {preview.summary.total} rows
                    </div>
                    <Button
                      onClick={handleCommit}
                      disabled={
                        importing || preview.summary.matched === 0
                      }
                    >
                      {importing ? "Importing..." : "Confirm & Import"}
                    </Button>
                  </div>

                  <div className="max-h-[400px] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Account #</TableHead>
                          <TableHead>Account Name</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((row, i) => (
                          <TableRow
                            key={i}
                            className={
                              row.status === "unmatched"
                                ? "bg-destructive/5"
                                : ""
                            }
                          >
                            <TableCell>
                              <Badge
                                variant={
                                  row.status === "matched"
                                    ? "default"
                                    : "destructive"
                                }
                                className="text-xs"
                              >
                                {row.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.accountNumber}
                            </TableCell>
                            <TableCell>{row.accountName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.message}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
