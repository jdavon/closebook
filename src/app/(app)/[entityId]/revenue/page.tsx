"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload,
  Settings,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";

interface RevenueSchedule {
  id: string;
  period_year: number;
  period_month: number;
  source_file_name: string | null;
  uploaded_at: string | null;
  total_earned_revenue: number;
  total_billed_revenue: number;
  total_accrued_revenue: number;
  total_deferred_revenue: number;
  status: string;
}

interface RevenueLineItem {
  id: string;
  contract_id: string | null;
  customer_name: string | null;
  description: string | null;
  rental_start: string | null;
  rental_end: string | null;
  total_contract_value: number;
  daily_rate: number;
  days_in_period: number;
  earned_revenue: number;
  billed_amount: number;
  accrual_amount: number;
  deferral_amount: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline",
  posted: "default",
  reversed: "secondary",
};

export default function RevenuePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = getCurrentPeriod();
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  const [schedule, setSchedule] = useState<RevenueSchedule | null>(null);
  const [lineItems, setLineItems] = useState<RevenueLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadSchedule = useCallback(async () => {
    setLoading(true);

    const { data: sched } = await supabase
      .from("revenue_schedules")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .single();

    if (sched) {
      setSchedule(sched as unknown as RevenueSchedule);

      const { data: items } = await supabase
        .from("revenue_line_items")
        .select("*")
        .eq("schedule_id", sched.id)
        .order("row_order");

      setLineItems((items as unknown as RevenueLineItem[]) ?? []);
    } else {
      setSchedule(null);
      setLineItems([]);
    }

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", entityId);
    formData.append("periodYear", String(periodYear));
    formData.append("periodMonth", String(periodMonth));

    try {
      const res = await fetch("/api/revenue/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Upload failed");
        if (json.details) {
          json.details.forEach((d: string) => toast.warning(d));
        }
      } else {
        toast.success(
          `Processed ${json.linesProcessed} contracts${
            json.skippedRows > 0 ? ` (${json.skippedRows} skipped)` : ""
          }`
        );
        loadSchedule();
      }
    } catch {
      toast.error("Upload failed — network error");
    }

    setUploading(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const years = Array.from({ length: 5 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Revenue Accruals & Deferrals
          </h1>
          <p className="text-muted-foreground">
            Track earned vs billed revenue by rental contract
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${entityId}/revenue/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Uploading..." : "Upload Spreadsheet"}
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <Select
          value={String(periodYear)}
          onValueChange={(v) => setPeriodYear(Number(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(periodMonth)}
          onValueChange={(v) => setPeriodMonth(Number(v))}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {getPeriodLabel(current.year, m).split(" ")[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {getPeriodLabel(periodYear, periodMonth)}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Earned Revenue</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(schedule?.total_earned_revenue ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Billed Revenue</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(schedule?.total_billed_revenue ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <p className="text-sm text-muted-foreground">Accrual</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1 text-green-600">
              {formatCurrency(schedule?.total_accrued_revenue ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Earned but not billed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-600" />
              <p className="text-sm text-muted-foreground">Deferral</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums mt-1 text-orange-600">
              {formatCurrency(schedule?.total_deferred_revenue ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Billed but not earned</p>
          </CardContent>
        </Card>
      </div>

      {/* Source File Info */}
      {schedule?.source_file_name && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4" />
          <span>
            Source: {schedule.source_file_name}
            {schedule.uploaded_at &&
              ` — uploaded ${new Date(schedule.uploaded_at).toLocaleString()}`}
          </span>
          <Badge variant={STATUS_VARIANTS[schedule.status] ?? "outline"}>
            {STATUS_LABELS[schedule.status] ?? schedule.status}
          </Badge>
        </div>
      )}

      {/* Contract Table */}
      <Card>
        <CardHeader>
          <CardTitle>Rental Contracts</CardTitle>
          <CardDescription>
            {lineItems.length} contract{lineItems.length !== 1 ? "s" : ""} for{" "}
            {getPeriodLabel(periodYear, periodMonth)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : lineItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Revenue Data</h3>
              <p className="text-muted-foreground text-center mb-4">
                Upload a spreadsheet with rental contract data to calculate
                accruals and deferrals for this period.
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Spreadsheet
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Rental Period</TableHead>
                    <TableHead className="text-right">Daily Rate</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Accrual</TableHead>
                    <TableHead className="text-right">Deferral</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.contract_id ?? "---"}
                      </TableCell>
                      <TableCell>{item.customer_name ?? "---"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                        {item.description ?? "---"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {item.rental_start && item.rental_end
                          ? `${new Date(item.rental_start).toLocaleDateString()} – ${new Date(item.rental_end).toLocaleDateString()}`
                          : "---"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(item.daily_rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.days_in_period}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(item.earned_revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(item.billed_amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.accrual_amount > 0 ? (
                          <span className="text-green-600">
                            {formatCurrency(item.accrual_amount)}
                          </span>
                        ) : (
                          "---"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.deferral_amount > 0 ? (
                          <span className="text-orange-600">
                            {formatCurrency(item.deferral_amount)}
                          </span>
                        ) : (
                          "---"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={6}>Totals</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(
                        lineItems.reduce((s, i) => s + i.earned_revenue, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(
                        lineItems.reduce((s, i) => s + i.billed_amount, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-600">
                      {formatCurrency(
                        lineItems.reduce((s, i) => s + i.accrual_amount, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-orange-600">
                      {formatCurrency(
                        lineItems.reduce((s, i) => s + i.deferral_amount, 0)
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
