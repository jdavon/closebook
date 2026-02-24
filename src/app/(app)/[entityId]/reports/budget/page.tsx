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
  Eye,
  X,
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

interface BudgetLineItem {
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  months: Record<string, number>;
  total: number;
}

interface BudgetSection {
  id: string;
  title: string;
  lines: BudgetLineItem[];
  subtotal: Record<string, number>;
}

interface ComputedLine {
  id: string;
  label: string;
  amounts: Record<string, number>;
  isGrandTotal?: boolean;
}

interface BudgetViewData {
  version: {
    id: string;
    name: string;
    fiscalYear: number;
    status: string;
  };
  sections: BudgetSection[];
  computedLines: ComputedLine[];
}

const CURRENT_YEAR = new Date().getFullYear();
const FISCAL_YEARS = [
  CURRENT_YEAR - 1,
  CURRENT_YEAR,
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
];

const MONTH_ABBRS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatBudgetAmount(amount: number): string {
  if (amount === 0) return "\u2014";
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);
  return amount < 0 ? `(${formatted})` : formatted;
}

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

  // Budget view state
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [viewData, setViewData] = useState<BudgetViewData | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

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

  // Fetch budget view data when a version is selected for viewing
  const fetchBudgetView = useCallback(
    async (versionId: string) => {
      setViewLoading(true);
      try {
        const res = await fetch(
          `/api/budgets/view?versionId=${versionId}&entityId=${entityId}`
        );
        const data = await res.json();
        if (res.ok) {
          setViewData(data);
        }
      } finally {
        setViewLoading(false);
      }
    },
    [entityId]
  );

  function handleViewBudget(versionId: string) {
    if (viewVersionId === versionId) {
      // Toggle off
      setViewVersionId(null);
      setViewData(null);
    } else {
      setViewVersionId(versionId);
      fetchBudgetView(versionId);
    }
  }

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
    if (viewVersionId === versionId) {
      setViewVersionId(null);
      setViewData(null);
    }
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
        // Refresh view if viewing the same version
        if (viewVersionId === selectedVersionId) {
          fetchBudgetView(selectedVersionId);
        }
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

  // Determine which computed lines go after which sections
  function getComputedLinesAfter(sectionId: string): ComputedLine[] {
    if (!viewData) return [];
    const sectionOrder: Record<string, string> = {
      direct_operating_costs: "gross_margin",
      other_operating_costs: "operating_margin",
      other_income: "net_income",
    };
    const expectedId = sectionOrder[sectionId];
    if (!expectedId) return [];
    return viewData.computedLines.filter((c) => c.id === expectedId);
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewBudget(v.id)}
                          title="View budget data"
                          className={
                            viewVersionId === v.id
                              ? "text-primary"
                              : ""
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
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

      {/* Budget View */}
      {viewVersionId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {viewData?.version.name ?? "Budget Data"}
                </CardTitle>
                <CardDescription>
                  {viewData
                    ? `FY${viewData.version.fiscalYear} \u2014 ${viewData.sections.reduce((sum, s) => sum + s.lines.length, 0)} accounts`
                    : "Loading..."}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setViewVersionId(null);
                  setViewData(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {viewLoading ? (
              <p className="text-muted-foreground text-sm">
                Loading budget data...
              </p>
            ) : viewData &&
              viewData.sections.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No budget data imported for this version yet.
              </p>
            ) : viewData ? (
              <div className="overflow-x-auto">
                <table className="stmt-table">
                  <thead>
                    <tr>
                      <th className="min-w-[250px]">Account</th>
                      {MONTH_ABBRS.map((m, i) => (
                        <th key={i} className="min-w-[90px]">
                          {m}
                        </th>
                      ))}
                      <th className="min-w-[100px]">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewData.sections.map((section) => {
                      const computedAfter = getComputedLinesAfter(section.id);

                      return (
                        <tbody key={section.id}>
                          {/* Section header */}
                          <tr className="stmt-section-header">
                            <td colSpan={14}>{section.title}</td>
                          </tr>
                          <tr className="stmt-separator">
                            <td colSpan={14}></td>
                          </tr>

                          {/* Line items */}
                          {section.lines.map((line, idx) => (
                            <tr
                              key={line.accountId}
                              className={`stmt-line-item ${idx % 2 === 0 ? "stmt-row-striped" : ""}`}
                            >
                              <td>
                                {line.accountNumber
                                  ? `${line.accountNumber} - ${line.accountName}`
                                  : line.accountName}
                              </td>
                              {MONTH_ABBRS.map((_, mi) => (
                                <td key={mi}>
                                  {formatBudgetAmount(
                                    line.months[String(mi + 1)] ?? 0
                                  )}
                                </td>
                              ))}
                              <td>{formatBudgetAmount(line.total)}</td>
                            </tr>
                          ))}

                          {/* Section subtotal */}
                          <tr className="stmt-subtotal">
                            <td>
                              Total{" "}
                              {section.title.charAt(0) +
                                section.title.slice(1).toLowerCase()}
                            </td>
                            {MONTH_ABBRS.map((_, mi) => (
                              <td key={mi}>
                                {formatBudgetAmount(
                                  section.subtotal[String(mi + 1)] ?? 0
                                )}
                              </td>
                            ))}
                            <td>
                              {formatBudgetAmount(section.subtotal.total ?? 0)}
                            </td>
                          </tr>

                          {/* Computed lines after this section */}
                          {computedAfter.map((comp) => (
                            <tr
                              key={comp.id}
                              className={
                                comp.isGrandTotal
                                  ? "stmt-grand-total"
                                  : "stmt-subtotal"
                              }
                            >
                              <td>{comp.label}</td>
                              {MONTH_ABBRS.map((_, mi) => (
                                <td key={mi}>
                                  {formatBudgetAmount(
                                    comp.amounts[String(mi + 1)] ?? 0
                                  )}
                                </td>
                              ))}
                              <td>
                                {formatBudgetAmount(comp.amounts.total ?? 0)}
                              </td>
                            </tr>
                          ))}

                          {/* Spacing */}
                          <tr className="stmt-separator">
                            <td colSpan={14}></td>
                          </tr>
                        </tbody>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

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
