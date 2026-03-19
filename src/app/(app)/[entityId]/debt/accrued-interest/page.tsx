"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import * as XLSX from "xlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

interface AccruedInterestRow {
  instrumentId: string;
  instrumentName: string;
  lenderName: string;
  loanNumber: string;
  debtType: string;
  startDate: string;
  originationDate: string | null;
  annualRate: number;
  dayCountConvention: string;
  dailyRate: number;
  balanceAtYearEnd: number;
  decemberInterest: number;
  // For pro-rata: if start_date is in the report year, accrued from start through 12/31
  accruedDays: number;
  accruedInterest: number;
  status: string;
}

const TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  revolving_credit: "Revolving Credit",
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

const DAY_COUNT_LABELS: Record<string, string> = {
  "30/360": "30/360",
  "actual/360": "Actual/360",
  "actual/365": "Actual/365",
  "actual/actual": "Actual/Actual",
};

function getDayCountDenominator(convention: string, year: number): number {
  switch (convention) {
    case "30/360":
      return 360;
    case "actual/360":
      return 360;
    case "actual/365":
      return 365;
    case "actual/actual": {
      const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
      return isLeap ? 366 : 365;
    }
    default:
      return 365;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default function AccruedInterestPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [year, setYear] = useState(2025);
  const [entityName, setEntityName] = useState("");
  const [rows, setRows] = useState<AccruedInterestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);

    // Fetch entity name
    const { data: entityData } = await supabase
      .from("entities")
      .select("name")
      .eq("id", entityId)
      .single();
    if (entityData) setEntityName(entityData.name);

    // Fetch all debt instruments for this entity
    const { data: instruments } = await supabase
      .from("debt_instruments")
      .select("*")
      .eq("entity_id", entityId)
      .order("instrument_name");

    if (!instruments || instruments.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const instrIds = instruments.map((i: AnyRow) => i.id);

    // Fetch December amortization for the selected year (gives us balance + interest)
    const { data: decAmort } = await supabase
      .from("debt_amortization")
      .select("debt_instrument_id, beginning_balance, ending_balance, interest")
      .in("debt_instrument_id", instrIds)
      .eq("period_year", year)
      .eq("period_month", 12);

    const decMap: Record<string, AnyRow> = {};
    if (decAmort) {
      for (const row of decAmort) {
        decMap[row.debt_instrument_id] = row;
      }
    }

    // Also fetch November amortization to get ending balance going into December
    // (in case December amort doesn't exist, we need to find the last available period)
    const { data: allAmort } = await supabase
      .from("debt_amortization")
      .select("debt_instrument_id, period_year, period_month, ending_balance")
      .in("debt_instrument_id", instrIds)
      .lte("period_year", year)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    // Build a map of last known balance per instrument as of year-end
    const lastBalanceMap: Record<string, number> = {};
    if (allAmort) {
      for (const row of allAmort as AnyRow[]) {
        const id = row.debt_instrument_id;
        if (!(id in lastBalanceMap)) {
          // First row is the most recent period (ordered desc)
          lastBalanceMap[id] = Number(row.ending_balance);
        }
      }
    }

    // Fetch rate history for variable rate instruments
    const { data: rateHistory } = await supabase
      .from("debt_rate_history")
      .select("debt_instrument_id, effective_date, interest_rate")
      .in("debt_instrument_id", instrIds)
      .lte("effective_date", `${year}-12-31`)
      .order("effective_date", { ascending: false });

    // Build rate at origination map (first rate, or instrument base rate)
    const originRateMap: Record<string, number> = {};
    if (rateHistory) {
      for (const r of rateHistory as AnyRow[]) {
        // Last one processed (earliest date since sorted desc) wins as origination rate
        originRateMap[r.debt_instrument_id] = Number(r.interest_rate);
      }
    }

    // Build accrued interest rows
    const result: AccruedInterestRow[] = [];

    for (const instr of instruments as AnyRow[]) {
      // Skip paid-off instruments that were paid off before this year
      if (instr.status === "paid_off" || instr.status === "inactive") {
        // Check if they had any balance in the selected year
        const lastBal = lastBalanceMap[instr.id];
        if (lastBal == null || lastBal <= 0) continue;
      }

      const convention = instr.day_count_convention || "30/360";
      const annualRate = Number(instr.interest_rate ?? 0);
      const denominator = getDayCountDenominator(convention, year);
      const dailyRate = annualRate / denominator;

      const dec = decMap[instr.id];
      const lastBal = lastBalanceMap[instr.id];

      // Balance at year-end: use the instrument's actual current_draw (derived from
      // real transactions) as the authoritative balance. The amortization schedule's
      // ending_balance is a projection that may include payments not yet made.
      const balanceAtYearEnd = Number(instr.current_draw ?? instr.original_amount);

      // December interest from amortization schedule
      const decemberInterest = dec ? Number(dec.interest) : 0;

      // Calculate accrued interest at year-end
      // This is the interest accrued in December based on the ending balance
      // For 30/360: 30 days of accrual
      // For actual conventions: actual days in December (31)
      const startDate = instr.origination_date || instr.start_date;
      // Parse as local date parts to avoid UTC timezone shift
      const [sY, sM, sD] = startDate.split("T")[0].split("-").map(Number);
      const startYear = sY;
      const startMonth = sM;
      const startDay = sD;

      let accruedDays: number;
      let accruedInterest: number;

      if (startYear === year && startMonth === 12) {
        // Note started in December of report year - pro-rate from start day to 31
        if (convention === "30/360") {
          accruedDays = Math.min(30, 30 - Math.min(startDay - 1, 30));
        } else {
          accruedDays = 31 - startDay + 1;
        }
        accruedInterest = Math.round(balanceAtYearEnd * dailyRate * accruedDays * 100) / 100;
      } else if (startYear > year) {
        // Note doesn't exist yet in the report year
        accruedDays = 0;
        accruedInterest = 0;
      } else {
        // Note existed before December - full December accrual
        if (convention === "30/360") {
          accruedDays = 30;
        } else {
          accruedDays = daysInMonth(year, 12); // 31
        }
        accruedInterest = Math.round(balanceAtYearEnd * dailyRate * accruedDays * 100) / 100;
      }

      result.push({
        instrumentId: instr.id,
        instrumentName: instr.instrument_name,
        lenderName: instr.lender_name ?? "",
        loanNumber: instr.loan_number ?? "",
        debtType: instr.debt_type,
        startDate: instr.start_date,
        originationDate: instr.origination_date,
        annualRate,
        dayCountConvention: convention,
        dailyRate,
        balanceAtYearEnd,
        decemberInterest,
        accruedDays,
        accruedInterest,
        status: instr.status,
      });
    }

    // Filter out instruments with zero balance and zero accrual
    setRows(result.filter((r) => r.balanceAtYearEnd > 0 || r.accruedInterest > 0));
    setLoading(false);
  }, [entityId, year, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalAccruedInterest = rows.reduce((s, r) => s + r.accruedInterest, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balanceAtYearEnd, 0);

  // ── Excel Export ──────────────────────────────────────────────────────
  function exportToExcel() {
    if (rows.length === 0) return;

    const sheetRows = rows.map((r) => ({
      "Instrument": r.instrumentName,
      "Lender": r.lenderName,
      "Loan #": r.loanNumber,
      "Type": TYPE_LABELS[r.debtType] ?? r.debtType,
      "Note Start Date": r.originationDate || r.startDate,
      "Annual Rate": r.annualRate,
      "Day Count": DAY_COUNT_LABELS[r.dayCountConvention] ?? r.dayCountConvention,
      "Daily Rate": r.dailyRate,
      [`Balance 12/31/${year}`]: r.balanceAtYearEnd,
      "Accrued Days": r.accruedDays,
      [`Accrued Interest 12/31/${year}`]: r.accruedInterest,
    }));

    // Add totals row
    sheetRows.push({
      "Instrument": "TOTAL",
      "Lender": "",
      "Loan #": "",
      "Type": "",
      "Note Start Date": "",
      "Annual Rate": 0,
      "Day Count": "",
      "Daily Rate": 0,
      [`Balance 12/31/${year}`]: totalBalance,
      "Accrued Days": 0,
      [`Accrued Interest 12/31/${year}`]: totalAccruedInterest,
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows);

    // Format columns
    const colKeys = Object.keys(sheetRows[0]);
    ws["!cols"] = colKeys.map((key) => {
      const maxDataLen = sheetRows.reduce(
        (mx, r) => Math.max(mx, String(r[key as keyof typeof r] ?? "").length),
        0
      );
      return { wch: Math.max(key.length, maxDataLen) + 2 };
    });

    // Format rate columns as percentage and currency columns
    const rowCount = sheetRows.length;
    for (let i = 0; i < rowCount; i++) {
      const rateCell = XLSX.utils.encode_cell({ r: i + 1, c: 5 }); // Annual Rate
      if (ws[rateCell]) ws[rateCell].z = "0.000%";
      const dailyCell = XLSX.utils.encode_cell({ r: i + 1, c: 7 }); // Daily Rate
      if (ws[dailyCell]) ws[dailyCell].z = "0.00000000%";
      const balCell = XLSX.utils.encode_cell({ r: i + 1, c: 8 }); // Balance
      if (ws[balCell]) ws[balCell].z = "$#,##0.00";
      const accCell = XLSX.utils.encode_cell({ r: i + 1, c: 10 }); // Accrued Interest
      if (ws[accCell]) ws[accCell].z = "$#,##0.00";
    }

    const wb = XLSX.utils.book_new();
    const sheetName = `Accrued Interest ${year}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const safeName = (entityName || "entity").replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(wb, `${safeName}_accrued_interest_${year}.xlsx`);
  }

  // ── PDF Export ────────────────────────────────────────────────────────
  async function exportToPdf() {
    if (rows.length === 0) return;

    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;

    // Title
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    const title = entityName
      ? `${entityName} — Accrued Interest Schedule`
      : "Accrued Interest Schedule";
    doc.text(title, margin, 40);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`As of December 31, ${year}`, margin, 56);

    const dateStr = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    doc.setFontSize(8);
    doc.text(`Generated ${dateStr}`, pageWidth - margin, 56, { align: "right" });

    // Table
    const head = [
      [
        "Instrument",
        "Lender",
        "Type",
        "Note Start Date",
        "Annual Rate",
        "Day Count",
        "Daily Rate",
        `Balance\n12/31/${year}`,
        "Accrued\nDays",
        `Accrued Interest\n12/31/${year}`,
      ],
    ];

    const body = rows.map((r) => [
      r.instrumentName,
      r.lenderName,
      TYPE_LABELS[r.debtType] ?? r.debtType,
      formatDate(r.originationDate || r.startDate),
      formatPct(r.annualRate),
      DAY_COUNT_LABELS[r.dayCountConvention] ?? r.dayCountConvention,
      formatDailyRate(r.dailyRate),
      formatCurrency(r.balanceAtYearEnd),
      String(r.accruedDays),
      formatCurrency(r.accruedInterest),
    ]);

    // Totals row
    body.push([
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      formatCurrency(totalBalance),
      "",
      formatCurrency(totalAccruedInterest),
    ]);

    autoTable(doc, {
      startY: 70,
      head,
      body,
      theme: "grid",
      headStyles: { fillColor: [41, 41, 41], fontSize: 7.5, halign: "center" },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 110 },
        1: { cellWidth: 80 },
        2: { cellWidth: 65 },
        3: { cellWidth: 70, halign: "center" },
        4: { cellWidth: 50, halign: "right" },
        5: { cellWidth: 55, halign: "center" },
        6: { cellWidth: 70, halign: "right" },
        7: { cellWidth: 80, halign: "right" },
        8: { cellWidth: 45, halign: "center" },
        9: { cellWidth: 90, halign: "right" },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data: AnyRow) => {
        // Bold the totals row
        if (data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          if (data.column.index === 0) {
            data.cell.styles.halign = "left";
          }
        }
      },
    });

    const safeName = (entityName || "entity").replace(/[^a-zA-Z0-9_-]/g, "_");
    doc.save(`${safeName}_accrued_interest_${year}.pdf`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/${entityId}/debt`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Accrued Interest Schedule</h1>
            <p className="text-muted-foreground text-sm">
              Interest accrued as of December 31, {year}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2023, 2024, 2025, 2026].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={exportToExcel}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button
            variant="outline"
            onClick={exportToPdf}
            disabled={rows.length === 0}
          >
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Outstanding Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Accrued Interest
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalAccruedInterest)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No active debt instruments found for {year}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Lender</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Note Start Date</TableHead>
                    <TableHead className="text-right">Annual Rate</TableHead>
                    <TableHead>Day Count</TableHead>
                    <TableHead className="text-right">Daily Rate</TableHead>
                    <TableHead className="text-right">
                      Balance 12/31/{year}
                    </TableHead>
                    <TableHead className="text-center">
                      Accrued Days
                    </TableHead>
                    <TableHead className="text-right">
                      Accrued Interest
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.instrumentId}>
                      <TableCell className="font-medium">
                        {r.instrumentName}
                      </TableCell>
                      <TableCell>{r.lenderName}</TableCell>
                      <TableCell>
                        {TYPE_LABELS[r.debtType] ?? r.debtType}
                      </TableCell>
                      <TableCell>
                        {formatDate(r.originationDate || r.startDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPct(r.annualRate)}
                      </TableCell>
                      <TableCell>
                        {DAY_COUNT_LABELS[r.dayCountConvention] ??
                          r.dayCountConvention}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatDailyRate(r.dailyRate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(r.balanceAtYearEnd)}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.accruedDays}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(r.accruedInterest)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right">
                      {formatCurrency(totalBalance)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right">
                      {formatCurrency(totalAccruedInterest)}
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

// ── Formatting helpers ────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  // Parse as local date to avoid UTC timezone shift (e.g. 2025-12-19 → 12/18 in local TZ)
  const [y, m, d] = dateStr.split("T")[0].split("-");
  return `${m}/${d}/${y}`;
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(3)}%`;
}

function formatDailyRate(rate: number): string {
  return `${(rate * 100).toFixed(8)}%`;
}
