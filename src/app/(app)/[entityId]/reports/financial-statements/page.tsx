"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { formatCurrency, getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";
import type { AccountClassification } from "@/lib/types/database";

interface GLBalance {
  account_id: string;
  ending_balance: number;
  net_change: number;
  accounts: {
    name: string;
    account_number: string | null;
    classification: AccountClassification;
    account_type: string;
  };
}

const CLASSIFICATION_ORDER: AccountClassification[] = [
  "Revenue",
  "Expense",
  "Asset",
  "Liability",
  "Equity",
];

export default function FinancialStatementsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const [year, setYear] = useState(String(currentPeriod.year));
  const [month, setMonth] = useState(String(currentPeriod.month));
  const [balances, setBalances] = useState<GLBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("gl_balances")
      .select(
        "account_id, ending_balance, net_change, accounts(name, account_number, classification, account_type)"
      )
      .eq("entity_id", entityId)
      .eq("period_year", parseInt(year))
      .eq("period_month", parseInt(month))
      .order("accounts(classification)")
      .order("accounts(account_number)");

    setBalances((data as unknown as GLBalance[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, year, month]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  function getBalancesByClassification(classification: AccountClassification) {
    return balances.filter(
      (b) => b.accounts?.classification === classification
    );
  }

  function getClassificationTotal(classification: AccountClassification) {
    return getBalancesByClassification(classification).reduce(
      (sum, b) => sum + (b.ending_balance || 0),
      0
    );
  }

  const revenue = getClassificationTotal("Revenue");
  const expenses = getClassificationTotal("Expense");
  const netIncome = Math.abs(revenue) - Math.abs(expenses);

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function renderSection(classification: AccountClassification, title: string) {
    const items = getBalancesByClassification(classification);
    const total = getClassificationTotal(classification);

    return (
      <>
        <TableRow className="bg-muted/40 font-semibold">
          <TableCell colSpan={2}>{title}</TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCurrency(Math.abs(total))}
          </TableCell>
        </TableRow>
        {items.map((item) => (
          <TableRow key={item.account_id}>
            <TableCell className="pl-8 font-mono text-sm text-muted-foreground">
              {item.accounts?.account_number}
            </TableCell>
            <TableCell className="pl-8">
              {item.accounts?.name}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(Math.abs(item.ending_balance))}
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Financial Statements
          </h1>
          <p className="text-muted-foreground">
            {getPeriodLabel(parseInt(year), parseInt(month))}
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
        </div>
      </div>

      <Tabs defaultValue="income_statement">
        <TabsList>
          <TabsTrigger value="income_statement">Income Statement</TabsTrigger>
          <TabsTrigger value="balance_sheet">Balance Sheet</TabsTrigger>
        </TabsList>

        <TabsContent value="income_statement">
          <Card>
            <CardHeader>
              <CardTitle>Income Statement</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No balance data for this period. Sync QuickBooks to populate.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account #</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderSection("Revenue", "Revenue")}
                    {renderSection("Expense", "Expenses")}
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={2}>Net Income</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          netIncome >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {formatCurrency(netIncome)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balance_sheet">
          <Card>
            <CardHeader>
              <CardTitle>Balance Sheet</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No balance data for this period. Sync QuickBooks to populate.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account #</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderSection("Asset", "Assets")}
                    {renderSection("Liability", "Liabilities")}
                    {renderSection("Equity", "Equity")}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
