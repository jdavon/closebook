"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

interface DisposalRow {
  _id: string;
  _errors: Record<string, string>;
  _matchedName?: string;
  asset_tag: string;
  disposed_date: string;
  disposed_sale_price: string;
  disposition_method: string;
  disposed_buyer: string;
  notes: string;
}

interface AssetLookup {
  asset_tag: string;
  asset_name: string;
  acquisition_cost: number;
  book_accumulated_depreciation: number;
  status: string;
}

interface ImportResults {
  updated: number;
  skipped: number;
  errors: string[];
}

const METHOD_OPTIONS = [
  { value: "sale", label: "Sale" },
  { value: "trade_in", label: "Trade-In" },
  { value: "scrap", label: "Scrap" },
  { value: "theft", label: "Theft" },
  { value: "casualty", label: "Casualty" },
  { value: "donation", label: "Donation" },
];

let _rowIdCounter = 0;
function nextRowId(): string {
  return `drow_${++_rowIdCounter}_${Date.now()}`;
}

function createEmptyRow(): DisposalRow {
  return {
    _id: nextRowId(),
    _errors: {},
    asset_tag: "",
    disposed_date: "",
    disposed_sale_price: "0",
    disposition_method: "sale",
    disposed_buyer: "",
    notes: "",
  };
}

function parseDateValue(value: unknown): string {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (typeof value === "number") {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + value * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return "";
}

function resolveMethod(value: unknown): string {
  if (!value) return "sale";
  const s = String(value).toLowerCase().replace(/[^a-z_]/g, "");
  if (s.includes("trade")) return "trade_in";
  if (s.includes("scrap")) return "scrap";
  if (s.includes("theft")) return "theft";
  if (s.includes("casualty")) return "casualty";
  if (s.includes("donat")) return "donation";
  return "sale";
}

function buildHeaderMap(headers: string[]): Record<string, string> {
  const find = (patterns: string[]): string => {
    for (const h of headers) {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const p of patterns) {
        if (lower.includes(p)) return h;
      }
    }
    return "";
  };
  return {
    asset_tag: find(["assettag", "tag", "assetid", "unitnumber", "unit"]),
    disposed_date: find([
      "disposeddate",
      "disposaldate",
      "saledate",
      "datesold",
      "dispositiondate",
      "datedisposed",
    ]),
    disposed_sale_price: find([
      "saleprice",
      "disposedsaleprice",
      "proceeds",
      "disposedprice",
      "salesprice",
    ]),
    disposition_method: find([
      "dispositionmethod",
      "disposalmethod",
      "disposedmethod",
      "method",
      "disposaltype",
    ]),
    disposed_buyer: find(["buyer", "purchaser", "soldto", "disposedbuyer"]),
    notes: find(["notes", "comments", "memo", "description"]),
  };
}

function validateRow(
  row: DisposalRow,
  assetByTag: Record<string, AssetLookup>
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!row.asset_tag.trim()) {
    errs.asset_tag = "Required";
  } else if (!assetByTag[row.asset_tag.trim()]) {
    errs.asset_tag = "Not found";
  }
  if (!row.disposed_date) {
    errs.disposed_date = "Required";
  } else if (isNaN(new Date(row.disposed_date).getTime())) {
    errs.disposed_date = "Invalid";
  }
  if (row.disposed_sale_price !== "" && isNaN(Number(row.disposed_sale_price))) {
    errs.disposed_sale_price = "Invalid";
  }
  return errs;
}

export default function DisposalImportWizardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<DisposalRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [assetByTag, setAssetByTag] = useState<Record<string, AssetLookup>>({});

  // Load active assets for tag validation/lookup
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("fixed_assets")
      .select(
        "asset_tag, asset_name, acquisition_cost, book_accumulated_depreciation, status"
      )
      .eq("entity_id", entityId)
      .order("asset_tag")
      .range(0, 2999)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, AssetLookup> = {};
        for (const a of data as unknown as AssetLookup[]) {
          if (a.asset_tag) map[a.asset_tag] = a;
        }
        setAssetByTag(map);
      });
  }, [entityId]);

  const revalidate = useCallback(
    (currentRows: DisposalRow[]): DisposalRow[] => {
      return currentRows.map((row) => {
        const matched = assetByTag[row.asset_tag.trim()];
        return {
          ...row,
          _matchedName: matched?.asset_name,
          _errors: validateRow(row, assetByTag),
        };
      });
    },
    [assetByTag]
  );

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });

      if (rawRows.length === 0) {
        toast.error("Spreadsheet is empty");
        return;
      }

      const headers = Object.keys(rawRows[0]);
      const hm = buildHeaderMap(headers);

      const parsed: DisposalRow[] = rawRows.map((raw) => {
        const row = createEmptyRow();
        if (hm.asset_tag)
          row.asset_tag = String(raw[hm.asset_tag] ?? "").trim();
        if (hm.disposed_date)
          row.disposed_date = parseDateValue(raw[hm.disposed_date]);
        if (hm.disposed_sale_price) {
          const v = raw[hm.disposed_sale_price];
          row.disposed_sale_price =
            typeof v === "number"
              ? String(v)
              : String(v ?? "").replace(/[$,\s]/g, "") || "0";
        }
        if (hm.disposition_method)
          row.disposition_method = resolveMethod(raw[hm.disposition_method]);
        if (hm.disposed_buyer)
          row.disposed_buyer = String(raw[hm.disposed_buyer] ?? "").trim();
        if (hm.notes) row.notes = String(raw[hm.notes] ?? "").trim();
        return row;
      });

      setRows(revalidate(parsed));
      setStep(2);
      toast.success(`Loaded ${parsed.length} rows from ${file.name}`);
    } catch (err) {
      toast.error("Failed to parse spreadsheet");
      console.error(err);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDownloadTemplate() {
    const XLSX = await import("xlsx");
    const headers = [
      "Asset Tag",
      "Disposed Date",
      "Sale Price",
      "Disposition Method",
      "Buyer",
      "Notes",
    ];

    const activeTags = Object.values(assetByTag).filter(
      (a) => a.status === "active"
    );

    let dataRows: unknown[][];
    if (activeTags.length > 0) {
      dataRows = activeTags.map((a) => [
        a.asset_tag,
        "",
        "",
        "Sale",
        "",
        "",
      ]);
    } else {
      dataRows = [["VEH-001", "2025-06-15", 18500, "Sale", "John Smith", ""]];
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 16 },
      { wch: 20 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Disposals");
    XLSX.writeFile(wb, "asset_disposals_import_template.xlsx");
  }

  function handleStartBlank() {
    setRows(
      revalidate(Array.from({ length: 10 }, () => createEmptyRow()))
    );
    setFileName(null);
    setStep(2);
  }

  function updateCell(
    rowIdx: number,
    field: keyof DisposalRow,
    value: string
  ) {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIdx], [field]: value };
      const matched = assetByTag[row.asset_tag.trim()];
      row._matchedName = matched?.asset_name;
      row._errors = validateRow(row, assetByTag);
      updated[rowIdx] = row;
      return updated;
    });
  }

  function addRows(count: number = 5) {
    setRows((prev) => [
      ...prev,
      ...Array.from({ length: count }, () => createEmptyRow()),
    ]);
  }

  function deleteRow(rowIdx: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
  }

  function resetAll() {
    setRows([]);
    setFileName(null);
    setResults(null);
    setStep(1);
  }

  async function handleImport() {
    const nonEmpty = rows.filter(
      (r) => r.asset_tag.trim() || r.disposed_date
    );

    const validated = revalidate(nonEmpty);
    const hasErrors = validated.some((r) => Object.keys(r._errors).length > 0);
    if (hasErrors) {
      setRows(validated);
      toast.error("Fix validation errors before importing");
      return;
    }
    if (validated.length === 0) {
      toast.error("No rows to import");
      return;
    }

    setImporting(true);
    setImportProgress(30);

    const payload = validated.map((r) => ({
      asset_tag: r.asset_tag.trim(),
      disposed_date: r.disposed_date,
      disposed_sale_price: Number(r.disposed_sale_price) || 0,
      disposition_method: r.disposition_method || "sale",
      disposed_buyer: r.disposed_buyer.trim() || undefined,
      notes: r.notes.trim() || undefined,
    }));

    try {
      setImportProgress(60);
      const res = await fetch("/api/assets/import-disposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, rows: payload }),
      });
      setImportProgress(95);
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Import failed");
        setImporting(false);
        return;
      }
      const data: ImportResults = await res.json();
      setResults(data);
      setStep(3);
      setImportProgress(100);
      toast.success(`Disposed ${data.updated} asset(s)`);
    } catch (err) {
      toast.error("Import failed");
      console.error(err);
    } finally {
      setImporting(false);
    }
  }

  // ----------------- STEP 1: Upload -----------------

  if (step === 1) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-4">
          <Link href={`/${entityId}/assets`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Register
            </Button>
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Import Disposals
          </h1>
          <p className="text-muted-foreground">
            Bulk-mark active assets as disposed with sale price, date, and
            disposition method. Gain/loss is calculated from accumulated
            depreciation at the disposal month.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Upload File</CardTitle>
              </div>
              <CardDescription>
                CSV or Excel with disposal data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button variant="outline" className="w-full">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Choose File
              </Button>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={handleDownloadTemplate}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Download Template</CardTitle>
              </div>
              <CardDescription>
                Pre-filled with active asset tags
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Get Template
              </Button>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={handleStartBlank}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Start Blank</CardTitle>
              </div>
              <CardDescription>
                Enter disposals manually
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Blank Grid
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expected Columns</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">Asset Tag</span>{" "}
              (required) — must match an existing asset
            </p>
            <p>
              <span className="font-medium text-foreground">
                Disposed Date
              </span>{" "}
              (required)
            </p>
            <p>
              <span className="font-medium text-foreground">Sale Price</span>{" "}
              (optional, defaults to 0)
            </p>
            <p>
              <span className="font-medium text-foreground">
                Disposition Method
              </span>{" "}
              — sale, trade_in, scrap, theft, casualty, donation
            </p>
            <p>
              <span className="font-medium text-foreground">Buyer</span>{" "}
              (optional)
            </p>
            <p>
              <span className="font-medium text-foreground">Notes</span>{" "}
              (optional)
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----------------- STEP 2: Edit -----------------

  if (step === 2) {
    const errorCount = rows.reduce(
      (s, r) => s + Object.keys(r._errors).length,
      0
    );
    const nonEmptyCount = rows.filter(
      (r) => r.asset_tag.trim() || r.disposed_date
    ).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={resetAll}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Review Disposals</h1>
              {fileName && (
                <p className="text-xs text-muted-foreground">
                  Loaded from {fileName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addRows(5)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add 5 Rows
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              disabled={importing}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Start Over
            </Button>
            <Button onClick={handleImport} disabled={importing || errorCount > 0}>
              {importing ? "Importing..." : `Import ${nonEmptyCount} Disposal${nonEmptyCount !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>

        {importing && <Progress value={importProgress} className="h-1" />}

        {errorCount > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">
                {errorCount} error{errorCount !== 1 ? "s" : ""}
              </span>{" "}
              — check the highlighted cells before importing.
            </div>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="min-w-[130px]">Asset Tag</TableHead>
                    <TableHead className="min-w-[200px]">Asset (matched)</TableHead>
                    <TableHead className="min-w-[150px]">Disposed Date</TableHead>
                    <TableHead className="min-w-[130px] text-right">Sale Price</TableHead>
                    <TableHead className="min-w-[140px]">Method</TableHead>
                    <TableHead className="min-w-[160px]">Buyer</TableHead>
                    <TableHead className="min-w-[200px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteRow(i)}
                          aria-label="Delete row"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          value={row.asset_tag}
                          onChange={(e) =>
                            updateCell(i, "asset_tag", e.target.value)
                          }
                          placeholder="VEH-001"
                          className={
                            row._errors.asset_tag
                              ? "border-destructive"
                              : ""
                          }
                        />
                        {row._errors.asset_tag && (
                          <p className="text-[10px] text-destructive mt-0.5">
                            {row._errors.asset_tag}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row._matchedName ?? (
                          <span className="italic opacity-60">—</span>
                        )}
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          type="date"
                          value={row.disposed_date}
                          onChange={(e) =>
                            updateCell(i, "disposed_date", e.target.value)
                          }
                          className={
                            row._errors.disposed_date
                              ? "border-destructive"
                              : ""
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={row.disposed_sale_price}
                          onChange={(e) =>
                            updateCell(
                              i,
                              "disposed_sale_price",
                              e.target.value
                            )
                          }
                          className="text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Select
                          value={row.disposition_method}
                          onValueChange={(v) =>
                            updateCell(i, "disposition_method", v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {METHOD_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          value={row.disposed_buyer}
                          onChange={(e) =>
                            updateCell(i, "disposed_buyer", e.target.value)
                          }
                          placeholder="Buyer name"
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          value={row.notes}
                          onChange={(e) =>
                            updateCell(i, "notes", e.target.value)
                          }
                          placeholder="Optional notes"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----------------- STEP 3: Results -----------------

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Import Complete
        </h1>
        <p className="text-muted-foreground">
          {results?.updated ?? 0} asset
          {results?.updated === 1 ? "" : "s"} marked as disposed.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Disposed
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {results?.updated ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              Skipped
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {results?.skipped ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Errors
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {results?.errors.length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {results?.errors && results.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Errors</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1 max-h-60 overflow-y-auto">
            {results.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => router.push(`/${entityId}/assets?status=disposed`)}>
          View Sold Register
        </Button>
        <Button variant="outline" onClick={resetAll}>
          Import More
        </Button>
      </div>
    </div>
  );
}
