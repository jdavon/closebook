"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  XCircle,
  MinusCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface OperatingEntity {
  id: string;
  code: string;
  name: string;
}

interface MappedEmployee {
  id: string;
  companyId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  status: string;
  statusType: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  erTaxes: number;
  totalComp: number;
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
}

interface DisplayEmployee extends MappedEmployee {
  effectiveDepartment: string;
  classValue: string;
  effectiveEntityId: string;
  effectiveEntityName: string;
  hasOverrides: boolean;
}

type RowStatus = "matched" | "no_changes" | "error";

interface PreviewRow {
  rowNumber: number;
  employeeId: string;
  employeeName: string;
  // Raw values from file (before resolution)
  rawCompany: string;
  rawDepartment: string;
  rawClass: string;
  // Resolved values (after entity matching)
  resolvedEntityId: string | null;
  resolvedEntityName: string | null;
  resolvedDepartment: string;
  resolvedClass: string;
  // Current values for comparison display
  currentCompany: string;
  currentDepartment: string;
  currentClass: string;
  status: RowStatus;
  message: string;
}

interface ImportAllocationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: DisplayEmployee[];
  operatingEntities: OperatingEntity[];
  paylocityCompanyId: string | null;
  onComplete: () => void;
}

type Step = 1 | 2 | 3;

// ── Status helpers ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  RowStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className: string;
  }
> = {
  matched: {
    label: "Will Update",
    variant: "default",
    className: "bg-green-100 text-green-800 hover:bg-green-100",
  },
  no_changes: {
    label: "No Changes",
    variant: "secondary",
    className: "bg-gray-100 text-gray-600 hover:bg-gray-100",
  },
  error: {
    label: "Error",
    variant: "destructive",
    className: "bg-red-100 text-red-800 hover:bg-red-100",
  },
};

const STEP_LABELS = ["Upload File", "Preview", "Results"];

// ── Helpers ────────────────────────────────────────────────────────────

/** Normalize a string for comparison (trim, collapse whitespace, lowercase) */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Resolve company input (name or code) to operating entity */
function resolveEntity(
  input: string,
  entities: OperatingEntity[]
): OperatingEntity | null {
  if (!input || !input.trim()) return null;
  const q = norm(input);
  return (
    entities.find(
      (e) =>
        norm(e.name) === q ||
        norm(e.code) === q ||
        norm(e.name).startsWith(q) ||
        q.includes(norm(e.code))
    ) ?? null
  );
}

/**
 * Find the best column value from a parsed row using multiple possible header names.
 * Handles cases where xlsx might add whitespace or change casing in headers.
 */
function getCol(row: Record<string, string>, ...keys: string[]): string {
  // First try exact match
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return String(row[key]).trim();
    }
  }
  // Then try case-insensitive match against all row keys
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const lk = key.toLowerCase();
    const found = rowKeys.find((rk) => rk.toLowerCase().trim() === lk);
    if (found && row[found] !== undefined && row[found] !== null) {
      return String(row[found]).trim();
    }
  }
  return "";
}

// ── Component ──────────────────────────────────────────────────────────

export function ImportAllocationsDialog({
  open,
  onOpenChange,
  employees,
  operatingEntities,
  paylocityCompanyId,
  onComplete,
}: ImportAllocationsDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<RowStatus | "all">("all");
  const [savedCount, setSavedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [parseInfo, setParseInfo] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setFile(null);
      setParsing(false);
      setCommitting(false);
      setPreview([]);
      setStatusFilter("all");
      setSavedCount(0);
      setFailedCount(0);
      setApiErrors([]);
      setParseInfo("");
    }
  }, [open]);

  // Build employee lookup by ID (string key)
  const employeeMap = useMemo(() => {
    const map: Record<string, DisplayEmployee> = {};
    for (const emp of employees) {
      map[String(emp.id).trim()] = emp;
    }
    return map;
  }, [employees]);

  // Summary counts
  const summary = useMemo(() => {
    const matched = preview.filter((r) => r.status === "matched").length;
    const noChanges = preview.filter((r) => r.status === "no_changes").length;
    const errors = preview.filter((r) => r.status === "error").length;
    return { total: preview.length, matched, noChanges, errors };
  }, [preview]);

  // Filtered preview rows
  const filteredPreview =
    statusFilter === "all"
      ? preview
      : preview.filter((r) => r.status === statusFilter);

  // ── Handlers ─────────────────────────────────────────────────────────

  function handleDownloadTemplate() {
    // Build template data from current employees
    const rows = employees.map((emp) => ({
      "Employee ID": String(emp.id),
      "Employee Name": emp.displayName,
      Company: emp.effectiveEntityName,
      Department: emp.effectiveDepartment,
      Class: emp.classValue || "",
    }));

    // Sort by name
    rows.sort((a, b) => a["Employee Name"].localeCompare(b["Employee Name"]));

    const wb = XLSX.utils.book_new();

    // Main data sheet
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws["!cols"] = [
      { wch: 14 }, // Employee ID
      { wch: 28 }, // Employee Name
      { wch: 26 }, // Company
      { wch: 22 }, // Department
      { wch: 18 }, // Class
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Allocations");

    // Reference sheet with valid company names
    const refRows = operatingEntities.map((e) => ({
      Code: e.code,
      "Company Name": e.name,
    }));
    const refWs = XLSX.utils.json_to_sheet(refRows);
    refWs["!cols"] = [{ wch: 8 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, refWs, "Valid Companies");

    XLSX.writeFile(wb, "employee-allocations-template.xlsx");
    toast.success("Template downloaded");
  }

  function handleParseFile() {
    if (!file) return;

    setParsing(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "array" });

        // Prefer "Allocations" sheet, fall back to first sheet
        let sheetName = workbook.SheetNames.find(
          (n) => n.toLowerCase() === "allocations"
        );
        if (!sheetName) {
          sheetName = workbook.SheetNames[0];
        }
        const sheet = workbook.Sheets[sheetName];

        // Parse with defval to ensure empty cells are included as ""
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, string>>(
          sheet,
          { raw: false, defval: "" }
        );

        if (jsonRows.length === 0) {
          toast.error("The uploaded file has no data rows.");
          setParsing(false);
          return;
        }

        // Log column names found for debugging
        const colNames = Object.keys(jsonRows[0]);
        const info = `Sheet: "${sheetName}" | ${jsonRows.length} rows | Columns: ${colNames.join(", ")}`;
        setParseInfo(info);
        console.log("[Import] Parse info:", info);
        console.log("[Import] First row raw:", JSON.stringify(jsonRows[0]));

        // Parse each row
        const rows: PreviewRow[] = jsonRows.map((row, idx) => {
          const employeeId = getCol(
            row,
            "Employee ID",
            "employee_id",
            "EmployeeID",
            "Emp ID",
            "ID"
          );

          const employeeName = getCol(
            row,
            "Employee Name",
            "employee_name",
            "Name"
          );

          const rawCompany = getCol(
            row,
            "Company",
            "company",
            "Entity",
            "entity"
          );

          const rawDepartment = getCol(
            row,
            "Department",
            "department",
            "Dept",
            "dept"
          );

          const rawClass = getCol(row, "Class", "class");

          // Validate: employee must exist
          const emp = employeeMap[employeeId];
          if (!emp) {
            return {
              rowNumber: idx + 2,
              employeeId,
              employeeName: employeeName || `Unknown (${employeeId})`,
              rawCompany,
              rawDepartment,
              rawClass,
              resolvedEntityId: null,
              resolvedEntityName: null,
              resolvedDepartment: rawDepartment,
              resolvedClass: rawClass,
              currentCompany: "",
              currentDepartment: "",
              currentClass: "",
              status: "error" as const,
              message: employeeId
                ? `Employee ID "${employeeId}" not found`
                : "Missing Employee ID",
            };
          }

          // Resolve company
          let resolvedEntity: OperatingEntity | null = null;
          if (rawCompany) {
            resolvedEntity = resolveEntity(rawCompany, operatingEntities);
            if (!resolvedEntity) {
              return {
                rowNumber: idx + 2,
                employeeId,
                employeeName: emp.displayName,
                rawCompany,
                rawDepartment,
                rawClass,
                resolvedEntityId: null,
                resolvedEntityName: null,
                resolvedDepartment: rawDepartment,
                resolvedClass: rawClass,
                currentCompany: emp.effectiveEntityName,
                currentDepartment: emp.effectiveDepartment,
                currentClass: emp.classValue,
                status: "error" as const,
                message: `Company "${rawCompany}" not recognized`,
              };
            }
          }

          const resolvedEntityId =
            resolvedEntity?.id ?? emp.effectiveEntityId;
          const resolvedEntityName =
            resolvedEntity?.name ?? emp.effectiveEntityName;
          // Use file value for dept; only fall back if completely empty
          const resolvedDept = rawDepartment || emp.effectiveDepartment;
          const resolvedClass = rawClass;

          // Check if anything actually changed (normalized comparison)
          const companyChanged =
            norm(resolvedEntityId) !== norm(emp.effectiveEntityId);
          const deptChanged =
            norm(resolvedDept) !== norm(emp.effectiveDepartment);
          const classChanged =
            resolvedClass.trim() !== (emp.classValue ?? "").trim();

          const hasChanges = companyChanged || deptChanged || classChanged;

          return {
            rowNumber: idx + 2,
            employeeId,
            employeeName: emp.displayName,
            rawCompany,
            rawDepartment,
            rawClass,
            resolvedEntityId,
            resolvedEntityName,
            resolvedDepartment: resolvedDept,
            resolvedClass,
            currentCompany: emp.effectiveEntityName,
            currentDepartment: emp.effectiveDepartment,
            currentClass: emp.classValue,
            status: hasChanges
              ? ("matched" as const)
              : ("no_changes" as const),
            message: hasChanges ? "Will be updated" : "No changes detected",
          };
        });

        setPreview(rows);
        setStatusFilter("all");
        setStep(2);

        // Show a toast with summary
        const matched = rows.filter((r) => r.status === "matched").length;
        const noChanges = rows.filter((r) => r.status === "no_changes").length;
        const errs = rows.filter((r) => r.status === "error").length;
        if (matched === 0 && noChanges > 0) {
          toast.warning(
            `No changes detected in ${noChanges} rows. Make sure you edited the Company, Department, or Class columns on the "${sheetName}" sheet.`
          );
        } else {
          toast.info(
            `Parsed ${rows.length} rows: ${matched} to update, ${noChanges} unchanged, ${errs} errors`
          );
        }
      } catch (err) {
        toast.error(
          `Failed to parse file: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
      setParsing(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleCommit() {
    const toSave = preview.filter((r) => r.status === "matched");
    if (toSave.length === 0) return;

    setCommitting(true);
    setApiErrors([]);
    try {
      const allocations = toSave.map((row) => {
        const emp = employeeMap[row.employeeId];
        return {
          employeeId: row.employeeId,
          paylocityCompanyId: emp?.companyId ?? paylocityCompanyId ?? "",
          department: row.resolvedDepartment || null,
          class: row.resolvedClass || null,
          allocatedEntityId: row.resolvedEntityId,
          allocatedEntityName: row.resolvedEntityName,
        };
      });

      const res = await fetch("/api/paylocity/allocations/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save allocations");
        setCommitting(false);
        return;
      }

      setSavedCount(data.saved ?? 0);
      setFailedCount(data.failed ?? 0);
      setApiErrors(data.errors ?? []);
      setStep(3);
    } catch {
      toast.error("An error occurred during import");
    }
    setCommitting(false);
  }

  function handleDone() {
    if (savedCount > 0) {
      onComplete();
    }
    onOpenChange(false);
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={step === 2 ? "max-h-[85vh] flex flex-col" : ""}
        style={step === 2 ? { maxWidth: "80rem" } : undefined}
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEP_LABELS.map((label, i) => {
            const stepNum = (i + 1) as Step;
            const isActive = step === stepNum;
            const isCompleted = step > stepNum;
            return (
              <div key={label} className="flex items-center gap-1">
                {i > 0 && (
                  <div
                    className={`h-px w-6 ${
                      isCompleted ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span>{stepNum}</span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Upload File ───────────────────────────────────── */}
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Allocations — Upload File</DialogTitle>
              <DialogDescription>
                Download the template pre-filled with current employees, update
                the Company, Department, and Class columns on the
                &quot;Allocations&quot; sheet, then upload it back.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-4">
              {/* Download template */}
              <div className="rounded-lg border border-dashed p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  Step 1: Download the allocation template
                </div>
                <p className="text-xs text-muted-foreground">
                  The template has two sheets: &quot;Allocations&quot; (edit this
                  one) with employees pre-filled, and &quot;Valid
                  Companies&quot; as a reference for accepted company names.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template ({employees.length} employees)
                </Button>
              </div>

              <Separator />

              {/* Upload file */}
              <div className="rounded-lg border border-dashed p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Step 2: Upload the completed file
                </div>
                <p className="text-xs text-muted-foreground">
                  Make sure your changes are on the &quot;Allocations&quot;
                  sheet. The &quot;Valid Companies&quot; sheet is for reference
                  only.
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose File
                  </Button>
                  {file ? (
                    <span className="text-sm text-muted-foreground truncate max-w-[250px]">
                      {file.name}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No file selected
                    </span>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!file || parsing} onClick={handleParseFile}>
                {parsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  <>
                    Upload &amp; Preview
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 2: Preview ───────────────────────────────────────── */}
        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Allocations — Preview</DialogTitle>
              <DialogDescription>
                Review the changes below. Only &quot;Will Update&quot; rows will
                be saved.
              </DialogDescription>
            </DialogHeader>

            {/* Parse diagnostic info */}
            {parseInfo && (
              <p className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
                {parseInfo}
              </p>
            )}

            {/* Warning if no changes detected */}
            {summary.matched === 0 && summary.noChanges > 0 && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
                <strong>No changes detected.</strong> The uploaded values match
                the current data. Make sure you edited the{" "}
                <strong>Company</strong>, <strong>Department</strong>, or{" "}
                <strong>Class</strong> columns on the{" "}
                <strong>&quot;Allocations&quot;</strong> sheet (not the
                &quot;Valid Companies&quot; reference sheet).
              </div>
            )}

            {/* Summary badges (clickable filters) */}
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={statusFilter === "all" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setStatusFilter("all")}
              >
                All ({summary.total})
              </Badge>
              <Badge
                variant={statusFilter === "matched" ? "default" : "outline"}
                className={`cursor-pointer ${
                  statusFilter === "matched"
                    ? "bg-green-600 hover:bg-green-700"
                    : ""
                }`}
                onClick={() => setStatusFilter("matched")}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Will Update ({summary.matched})
              </Badge>
              <Badge
                variant={statusFilter === "no_changes" ? "default" : "outline"}
                className={`cursor-pointer ${
                  statusFilter === "no_changes"
                    ? "bg-gray-600 hover:bg-gray-700"
                    : ""
                }`}
                onClick={() => setStatusFilter("no_changes")}
              >
                <MinusCircle className="mr-1 h-3 w-3" />
                No Changes ({summary.noChanges})
              </Badge>
              {summary.errors > 0 && (
                <Badge
                  variant={statusFilter === "error" ? "default" : "outline"}
                  className={`cursor-pointer ${
                    statusFilter === "error"
                      ? "bg-red-600 hover:bg-red-700"
                      : ""
                  }`}
                  onClick={() => setStatusFilter("error")}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  Errors ({summary.errors})
                </Badge>
              )}
            </div>

            {/* Preview table */}
            <div className="flex-1 overflow-auto border rounded-md min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-24">Emp ID</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Company (current → file)</TableHead>
                    <TableHead>Department (current → file)</TableHead>
                    <TableHead>Class (current → file)</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPreview.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground py-8"
                      >
                        No rows to display.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPreview.map((row, idx) => {
                      const cfg = STATUS_CONFIG[row.status];

                      // For all rows, show current vs file values
                      const companyChanged =
                        row.status === "matched" &&
                        norm(row.resolvedEntityName ?? "") !==
                          norm(row.currentCompany);
                      const deptChanged =
                        row.status === "matched" &&
                        norm(row.resolvedDepartment) !==
                          norm(row.currentDepartment);
                      const classChanged =
                        row.status === "matched" &&
                        row.resolvedClass.trim() !==
                          (row.currentClass ?? "").trim();

                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.employeeId}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.employeeName}
                          </TableCell>
                          {/* Company */}
                          <TableCell className="text-sm">
                            {companyChanged ? (
                              <span>
                                <span className="line-through text-muted-foreground">
                                  {row.currentCompany}
                                </span>{" "}
                                <span className="text-green-700 font-medium">
                                  → {row.resolvedEntityName}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {row.rawCompany || row.currentCompany || "—"}
                              </span>
                            )}
                          </TableCell>
                          {/* Department */}
                          <TableCell className="text-sm">
                            {deptChanged ? (
                              <span>
                                <span className="line-through text-muted-foreground">
                                  {row.currentDepartment}
                                </span>{" "}
                                <span className="text-green-700 font-medium">
                                  → {row.resolvedDepartment}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {row.rawDepartment ||
                                  row.currentDepartment ||
                                  "—"}
                              </span>
                            )}
                          </TableCell>
                          {/* Class */}
                          <TableCell className="text-sm">
                            {classChanged ? (
                              <span>
                                <span className="line-through text-muted-foreground">
                                  {row.currentClass || "(none)"}
                                </span>{" "}
                                <span className="text-green-700 font-medium">
                                  → {row.resolvedClass}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {row.rawClass || row.currentClass || "—"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={cfg.variant}
                              className={`text-xs ${cfg.className}`}
                            >
                              {cfg.label}
                            </Badge>
                            {row.status === "error" && (
                              <p className="text-xs text-red-600 mt-0.5">
                                {row.message}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={committing || summary.matched === 0}
                onClick={handleCommit}
              >
                {committing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Import {summary.matched} Allocation
                    {summary.matched !== 1 ? "s" : ""}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 3: Results ───────────────────────────────────────── */}
        {step === 3 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Complete</DialogTitle>
              <DialogDescription>
                Employee allocations have been updated.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="rounded-lg border p-4 space-y-3">
                {savedCount > 0 ? (
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">
                      {savedCount} allocation{savedCount !== 1 ? "s" : ""} saved
                      successfully
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-yellow-700">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">
                      No allocations were saved
                    </span>
                  </div>
                )}

                {failedCount > 0 && (
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">
                      {failedCount} allocation{failedCount !== 1 ? "s" : ""}{" "}
                      failed to save
                    </span>
                  </div>
                )}

                {/* Show API errors (e.g. table doesn't exist) */}
                {apiErrors.length > 0 && (
                  <div className="space-y-1 rounded-md bg-red-50 border border-red-200 p-3">
                    <p className="text-sm font-medium text-red-800">
                      Server errors:
                    </p>
                    <ul className="text-xs text-red-700 ml-4 list-disc space-y-0.5">
                      {apiErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.noChanges > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {summary.noChanges} employee
                    {summary.noChanges !== 1 ? "s had" : " had"} no changes and{" "}
                    {summary.noChanges !== 1 ? "were" : "was"} skipped.
                  </p>
                )}

                {summary.errors > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {summary.errors} row{summary.errors !== 1 ? "s" : ""} had
                      errors:
                    </p>
                    <ul className="text-xs text-muted-foreground ml-4 list-disc space-y-0.5">
                      {preview
                        .filter((r) => r.status === "error")
                        .slice(0, 10)
                        .map((r, i) => (
                          <li key={i}>
                            Row {r.rowNumber}: {r.message}
                          </li>
                        ))}
                      {preview.filter((r) => r.status === "error").length >
                        10 && (
                        <li>
                          ...and{" "}
                          {preview.filter((r) => r.status === "error").length -
                            10}{" "}
                          more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
