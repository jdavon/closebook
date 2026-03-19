"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { AccountCombobox } from "@/components/ui/account-combobox";
import { toast } from "sonner";
import { ArrowLeft, Upload, X, FileSpreadsheet } from "lucide-react";
import type { ScheduleType } from "@/lib/types/database";

const MONTH_NAMES = [
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

function formatMonthLabel(startDate: string, rowIndex: number): string {
  const [year, month] = startDate.split("-").map(Number);
  const d = new Date(year, month - 1 + rowIndex, 1);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

const DEFAULT_COLUMNS: Record<
  ScheduleType,
  Array<{ key: string; name: string; type: string; width: number }>
> = {
  prepaid: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "vendor", name: "Vendor", type: "text", width: 150 },
    { key: "total", name: "Total Amount", type: "currency", width: 120 },
    { key: "monthly", name: "Monthly Amort.", type: "currency", width: 120 },
    { key: "remaining", name: "Remaining", type: "currency", width: 120 },
  ],
  fixed_asset: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "beginning", name: "Beg. Balance", type: "currency", width: 120 },
    { key: "additions", name: "Additions", type: "currency", width: 120 },
    { key: "disposals", name: "Disposals", type: "currency", width: 120 },
    { key: "depreciation", name: "Depreciation", type: "currency", width: 120 },
    { key: "ending", name: "End. Balance", type: "currency", width: 120 },
  ],
  debt: [
    { key: "lender", name: "Lender", type: "text", width: 150 },
    { key: "principal", name: "Principal", type: "currency", width: 120 },
    { key: "rate", name: "Rate", type: "percentage", width: 80 },
    { key: "payment", name: "Monthly Pmt", type: "currency", width: 120 },
    { key: "balance", name: "Balance", type: "currency", width: 120 },
  ],
  accrual: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "amount", name: "Amount", type: "currency", width: 120 },
    { key: "reversal_date", name: "Reversal Date", type: "date", width: 120 },
    { key: "status", name: "Status", type: "text", width: 100 },
  ],
  custom: [
    { key: "description", name: "Description", type: "text", width: 250 },
    { key: "amount", name: "Amount", type: "currency", width: 150 },
  ],
};

interface Account {
  id: string;
  name: string;
  account_number: string | null;
}

interface UploadData {
  headers: string[];
  columnTypes: Record<string, string>;
  rows: Record<string, string | number>[];
}

export default function NewSchedulePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("prepaid");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [creating, setCreating] = useState(false);

  // Upload state
  const [uploadData, setUploadData] = useState<UploadData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("id, name, account_number")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    setAccounts((data as Account[]) ?? []);
  }, [supabase, entityId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function handleFileUpload(file: File) {
    setUploading(true);
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/schedules/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "Failed to parse file");
      setUploading(false);
      setFileName("");
      return;
    }

    setUploadData(data);
    setUploading(false);

    if (!name) {
      const baseName = file.name.replace(/\.(xlsx|xls|csv)$/i, "");
      setName(baseName);
    }
  }

  function clearUpload() {
    setUploadData(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    if (scheduleType === "custom" && uploadData) {
      // Build column definitions from spreadsheet headers
      // Month column is first, then the spreadsheet columns
      const columns = [
        { key: "month", name: "Month", type: "text", width: 140 },
        ...uploadData.headers.map((h) => ({
          key: h.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          name: h,
          type: uploadData.columnTypes[h] || "text",
          width: uploadData.columnTypes[h] === "currency" ? 130 : 160,
        })),
      ];

      // Use startDate as YYYY-MM format
      const startISO = `${startDate}-01`;

      // Create the schedule
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sched, error } = await (supabase as any)
        .from("schedules")
        .insert({
          entity_id: entityId,
          name,
          schedule_type: "custom",
          column_definitions: columns,
          account_id: accountId || null,
        })
        .select()
        .single();

      if (error) {
        toast.error(error.message);
        setCreating(false);
        return;
      }

      // Build line items — one per row, month label from start date
      const lineItems = uploadData.rows.map((row, i) => {
        const cellData: Record<string, string | number> = {
          month: formatMonthLabel(startISO, i),
        };
        for (const h of uploadData.headers) {
          const key = h.toLowerCase().replace(/[^a-z0-9]+/g, "_");
          cellData[key] = row[h];
        }

        // Amount = last currency column value
        const currencyCols = columns.filter((c) => c.type === "currency");
        const lastCurrCol = currencyCols[currencyCols.length - 1];
        const amount = lastCurrCol
          ? parseFloat(String(cellData[lastCurrCol.key])) || 0
          : 0;

        return {
          schedule_id: sched.id,
          row_order: i,
          is_header: false,
          is_total: false,
          cell_data: cellData,
          amount,
        };
      });

      if (lineItems.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: itemsErr } = await (supabase as any)
          .from("schedule_line_items")
          .insert(lineItems);

        if (itemsErr) {
          toast.error(itemsErr.message);
          setCreating(false);
          return;
        }
      }

      // Update total
      const total = lineItems.reduce((s, item) => s + item.amount, 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("schedules")
        .update({ total_amount: total })
        .eq("id", sched.id);

      toast.success("Schedule created with imported data");
      router.push(`/${entityId}/schedules/${sched.id}`);
    } else {
      // Standard creation (no upload)
      const columns = DEFAULT_COLUMNS[scheduleType];

      const { data, error } = await supabase
        .from("schedules")
        .insert({
          entity_id: entityId,
          name,
          schedule_type: scheduleType,
          column_definitions: columns,
          account_id: accountId || null,
        })
        .select()
        .single();

      if (error) {
        toast.error(error.message);
        setCreating(false);
        return;
      }

      toast.success("Schedule created");
      router.push(`/${entityId}/schedules/${data.id}`);
    }
  }

  const isCustom = scheduleType === "custom";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/schedules`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Schedule</CardTitle>
          <CardDescription>
            Create a supporting schedule tied to a GL account
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Schedule Name</Label>
              <Input
                id="name"
                placeholder="e.g., Prepaid Expenses - January 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Schedule Type</Label>
              <Select
                value={scheduleType}
                onValueChange={(v) => {
                  setScheduleType(v as ScheduleType);
                  if (v !== "custom") clearUpload();
                }}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">Prepaid Expense</SelectItem>
                  <SelectItem value="fixed_asset">
                    Rental Asset Roll-Forward
                  </SelectItem>
                  <SelectItem value="debt">Debt Schedule</SelectItem>
                  <SelectItem value="accrual">Accrual Schedule</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account">Linked GL Account (optional)</Label>
              <AccountCombobox
                accounts={accounts.map((a) => ({
                  id: a.id,
                  account_number: a.account_number,
                  name: a.name,
                }))}
                value={accountId}
                onValueChange={setAccountId}
                placeholder="Select an account..."
              />
            </div>

            {/* Upload section for custom schedules */}
            {isCustom && (
              <div className="space-y-4 pt-2 border-t">
                <div className="space-y-2">
                  <Label>Import from Spreadsheet (optional)</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload an XLSX or CSV file. Column headers become schedule
                    columns, and each row maps to a month starting from your
                    chosen date.
                  </p>
                </div>

                {!uploadData ? (
                  <div
                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) handleFileUpload(file);
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                    />
                    {uploading ? (
                      <p className="text-sm text-muted-foreground">
                        Parsing file...
                      </p>
                    ) : (
                      <>
                        <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-sm font-medium">
                          Click to upload or drag and drop
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          .xlsx, .xls, or .csv
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* File info bar */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">{fileName}</span>
                        <span className="text-xs text-muted-foreground">
                          {uploadData.rows.length} rows,{" "}
                          {uploadData.headers.length} columns
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearUpload}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Start date picker */}
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Starting Month</Label>
                      <Input
                        id="startDate"
                        type="month"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Row 1 = {formatMonthLabel(`${startDate}-01`, 0)}, Row 2
                        = {formatMonthLabel(`${startDate}-01`, 1)}, etc.
                      </p>
                    </div>

                    {/* Preview table */}
                    <div className="space-y-2">
                      <Label>Preview</Label>
                      <div className="overflow-x-auto border rounded-lg max-h-80 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="sticky top-0 bg-background">
                                Month
                              </TableHead>
                              {uploadData.headers.map((h) => (
                                <TableHead
                                  key={h}
                                  className={`sticky top-0 bg-background ${
                                    uploadData.columnTypes[h] === "currency"
                                      ? "text-right"
                                      : ""
                                  }`}
                                >
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {uploadData.rows.map((row, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium whitespace-nowrap">
                                  {formatMonthLabel(`${startDate}-01`, i)}
                                </TableCell>
                                {uploadData.headers.map((h) => (
                                  <TableCell
                                    key={h}
                                    className={`tabular-nums ${
                                      uploadData.columnTypes[h] === "currency"
                                        ? "text-right"
                                        : ""
                                    }`}
                                  >
                                    {uploadData.columnTypes[h] === "currency"
                                      ? typeof row[h] === "number"
                                        ? row[h].toLocaleString("en-US", {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })
                                        : row[h]
                                      : row[h]}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" disabled={creating}>
              {creating
                ? "Creating..."
                : isCustom && uploadData
                ? "Create Schedule with Imported Data"
                : "Create Schedule"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
