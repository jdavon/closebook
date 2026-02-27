"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  Card,
  CardContent,
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercentage, getCurrentPeriod, getPriorPeriod, getPeriodLabel } from "@/lib/utils/dates";

interface FluxRow {
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  classification: string;
  currentBalance: number;
  priorBalance: number;
  dollarChange: number;
  percentChange: number | null;
}

export default function FluxAnalysisPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const prior = getPriorPeriod(currentPeriod.year, currentPeriod.month);

  const [year, setYear] = useState(String(currentPeriod.year));
  const [month, setMonth] = useState(String(currentPeriod.month));
  const [rows, setRows] = useState<FluxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState("5000");

  const loadData = useCallback(async () => {
    setLoading(true);
    const currentY = parseInt(year);
    const currentM = parseInt(month);
    const priorPeriod = getPriorPeriod(currentY, currentM);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [currentData, priorData] = await Promise.all([
      fetchAllPaginated<any>((offset, limit) =>
        (supabase as any)
          .from("gl_balances")
          .select("account_id, ending_balance, accounts(name, account_number, classification)")
          .eq("entity_id", entityId)
          .eq("period_year", currentY)
          .eq("period_month", currentM)
          .range(offset, offset + limit - 1)
      ) as Promise<Array<{
        account_id: string; ending_balance: number;
        accounts: { name: string; account_number: string | null; classification: string };
      }>>,
      fetchAllPaginated<any>((offset, limit) =>
        supabase
          .from("gl_balances")
          .select("account_id, ending_balance")
          .eq("entity_id", entityId)
          .eq("period_year", priorPeriod.year)
          .eq("period_month", priorPeriod.month)
          .range(offset, offset + limit - 1)
      ),
    ]);

    const priorMap = new Map<string, number>();
    for (const row of priorData) {
      priorMap.set(row.account_id, row.ending_balance);
    }

    const fluxRows: FluxRow[] = [];
    for (const row of currentData) {
      const priorBalance = priorMap.get(row.account_id) ?? 0;
      const dollarChange = row.ending_balance - priorBalance;
      const percentChange =
        priorBalance !== 0 ? dollarChange / Math.abs(priorBalance) : null;

      fluxRows.push({
        accountId: row.account_id,
        accountNumber: row.accounts?.account_number ?? null,
        accountName: row.accounts?.name ?? "Unknown",
        classification: row.accounts?.classification ?? "",
        currentBalance: row.ending_balance,
        priorBalance,
        dollarChange,
        percentChange,
      });
    }

    // Sort by absolute dollar change descending
    fluxRows.sort(
      (a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange)
    );

    setRows(fluxRows);
    setLoading(false);
  }, [supabase, entityId, year, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const thresholdNum = parseFloat(threshold) || 0;
  const materialRows = rows.filter(
    (r) => Math.abs(r.dollarChange) >= thresholdNum
  );

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Flux Analysis
          </h1>
          <p className="text-muted-foreground">
            Variance analysis: {getPeriodLabel(parseInt(year), parseInt(month))} vs prior period
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Year</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Threshold ($)</Label>
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-28"
              type="number"
              step="1000"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Material Variances ({materialRows.length} accounts above ${parseFloat(threshold).toLocaleString()} threshold)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : materialRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "No balance data available. Sync QuickBooks data first."
                : "No accounts exceed the materiality threshold."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Prior</TableHead>
                  <TableHead className="text-right">$ Change</TableHead>
                  <TableHead className="text-right">% Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialRows.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{row.accountName}</span>
                        {row.accountNumber && (
                          <span className="ml-2 text-xs text-muted-foreground font-mono">
                            {row.accountNumber}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.classification}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.currentBalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.priorBalance)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        row.dollarChange > 0
                          ? "text-green-600"
                          : row.dollarChange < 0
                          ? "text-red-600"
                          : ""
                      }`}
                    >
                      {formatCurrency(row.dollarChange)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        row.percentChange !== null && row.percentChange > 0
                          ? "text-green-600"
                          : row.percentChange !== null && row.percentChange < 0
                          ? "text-red-600"
                          : ""
                      }`}
                    >
                      {row.percentChange !== null
                        ? formatPercentage(row.percentChange)
                        : "N/A"}
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
