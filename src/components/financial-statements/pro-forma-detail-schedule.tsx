"use client";

import { Card, CardContent } from "@/components/ui/card";
import { StatementHeader } from "./statement-header";
import { formatStatementAmount } from "./format-utils";
import type { ProFormaAdjustmentDetail, Period, Granularity } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ProFormaDetailScheduleProps {
  companyName: string;
  adjustments: ProFormaAdjustmentDetail[];
  periods: Period[];
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  /** When true, renders as a print-only page with full detail listing */
  printMode?: boolean;
}

export function ProFormaDetailSchedule({
  companyName,
  adjustments,
  periods,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  printMode = false,
}: ProFormaDetailScheduleProps) {
  if (adjustments.length === 0) return null;

  // Filter out the "TOTAL" period for the columnar view — we'll compute our own total
  const displayPeriods = periods.filter((p) => !p.isTotal);
  const hasTotal = periods.some((p) => p.isTotal);

  // Group adjustments by a display key (account + description + entity)
  // so that entries spanning multiple months appear as a single row
  const groupedRows: Array<{
    key: string;
    entityCode: string;
    entityName: string;
    accountNumber: string;
    accountName: string;
    offsetAccountNumber: string | null;
    offsetAccountName: string | null;
    description: string;
    notes: string | null;
    amountsByBucket: Record<string, number>;
    total: number;
  }> = [];

  const groupMap = new Map<string, (typeof groupedRows)[number]>();

  for (const adj of adjustments) {
    const key = `${adj.entityCode}|${adj.accountNumber}|${adj.description}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        key,
        entityCode: adj.entityCode,
        entityName: adj.entityName,
        accountNumber: adj.accountNumber,
        accountName: adj.accountName,
        offsetAccountNumber: adj.offsetAccountNumber,
        offsetAccountName: adj.offsetAccountName,
        description: adj.description,
        notes: adj.notes,
        amountsByBucket: {},
        total: 0,
      };
      groupMap.set(key, group);
      groupedRows.push(group);
    }
    group.amountsByBucket[adj.bucketKey] =
      (group.amountsByBucket[adj.bucketKey] ?? 0) + adj.amount;
    group.total += adj.amount;
  }

  // Sort by account number then entity code
  groupedRows.sort((a, b) =>
    a.accountNumber.localeCompare(b.accountNumber) ||
    a.entityCode.localeCompare(b.entityCode)
  );

  // Compute period totals
  const periodTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const period of displayPeriods) {
    let sum = 0;
    for (const row of groupedRows) {
      sum += row.amountsByBucket[period.key] ?? 0;
    }
    periodTotals[period.key] = sum;
    grandTotal += sum;
  }

  const totalBorderClass = "border-l-2 border-border";

  // --- Print-only detailed listing (table format with all fields) ---
  if (printMode) {
    return (
      <div className="stmt-page-break stmt-pf-print-schedule">
        <Card>
          <CardContent className="pt-2 pb-6 px-4">
            <StatementHeader
              companyName={companyName}
              statementTitle="Pro Forma Adjustment Detail"
              startYear={startYear}
              startMonth={startMonth}
              endYear={endYear}
              endMonth={endMonth}
              granularity={granularity}
            />
            <table className="stmt-table stmt-pf-detail-table">
              <thead>
                <tr>
                  <th className="text-left min-w-[60px]">Entity</th>
                  <th className="text-left min-w-[80px]">Account</th>
                  <th className="text-left min-w-[80px]">Offset Account</th>
                  <th className="text-left min-w-[70px]">Period</th>
                  <th className="text-right min-w-[90px]">Amount</th>
                  <th className="text-left min-w-[200px]">Description</th>
                </tr>
              </thead>
              <tbody>
                {adjustments
                  .sort(
                    (a, b) =>
                      a.periodYear - b.periodYear ||
                      a.periodMonth - b.periodMonth ||
                      a.accountNumber.localeCompare(b.accountNumber)
                  )
                  .map((adj, i) => (
                    <tr
                      key={adj.id}
                      className={i % 2 === 0 ? "stmt-row-striped" : ""}
                    >
                      <td>{adj.entityCode}</td>
                      <td>
                        {adj.accountNumber} — {adj.accountName}
                      </td>
                      <td>
                        {adj.offsetAccountNumber
                          ? `${adj.offsetAccountNumber} — ${adj.offsetAccountName}`
                          : "—"}
                      </td>
                      <td>
                        {MONTHS[adj.periodMonth - 1]?.slice(0, 3)}{" "}
                        {adj.periodYear}
                      </td>
                      <td className="text-right">
                        {formatStatementAmount(adj.amount, true)}
                      </td>
                      <td>{adj.description}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="stmt-grand-total">
                  <td colSpan={4} className="font-bold">
                    Total Pro Forma Adjustments
                  </td>
                  <td className="text-right font-bold">
                    {formatStatementAmount(grandTotal, true)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- On-screen columnar view (matches statement period columns) ---
  return (
    <div className="stmt-page-break">
      <Card>
        <CardContent className="pt-2 pb-6 px-4">
          <StatementHeader
            companyName={companyName}
            statementTitle="Pro Forma Adjustment Detail"
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            granularity={granularity}
          />
          <div className="overflow-x-auto">
            <table className="stmt-table">
              <thead>
                <tr>
                  <th className="min-w-[280px]">Adjustment</th>
                  {displayPeriods.map((p) => (
                    <th key={p.key} className="min-w-[110px]">
                      {p.label}
                    </th>
                  ))}
                  {hasTotal && (
                    <th className={`min-w-[110px] ${totalBorderClass} font-bold`}>
                      Total
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Section header */}
                <tr className="stmt-section-header">
                  <td
                    colSpan={
                      1 + displayPeriods.length + (hasTotal ? 1 : 0)
                    }
                  >
                    <span className="font-bold">PRO FORMA ADJUSTMENTS</span>
                  </td>
                </tr>
                <tr className="stmt-separator">
                  <td
                    colSpan={
                      1 + displayPeriods.length + (hasTotal ? 1 : 0)
                    }
                  ></td>
                </tr>

                {groupedRows.map((row, i) => (
                  <tr
                    key={row.key}
                    className={`stmt-line-item ${i % 2 === 0 ? "stmt-row-striped" : ""}`}
                  >
                    <td>
                      <span className="text-muted-foreground">
                        {row.entityCode && `[${row.entityCode}] `}
                      </span>
                      {row.accountNumber} — {row.accountName}
                      <span className="text-muted-foreground text-[11px] ml-2">
                        {row.description}
                      </span>
                    </td>
                    {displayPeriods.map((p) => {
                      const amt = row.amountsByBucket[p.key] ?? 0;
                      return (
                        <td key={p.key}>
                          {amt !== 0 ? formatStatementAmount(amt, false) : "—"}
                        </td>
                      );
                    })}
                    {hasTotal && (
                      <td className={totalBorderClass}>
                        {row.total !== 0
                          ? formatStatementAmount(row.total, false)
                          : "—"}
                      </td>
                    )}
                  </tr>
                ))}

                {/* Separator before total */}
                <tr className="stmt-separator">
                  <td
                    colSpan={
                      1 + displayPeriods.length + (hasTotal ? 1 : 0)
                    }
                  ></td>
                </tr>

                {/* Total row */}
                <tr className="stmt-grand-total">
                  <td>Total Pro Forma Impact</td>
                  {displayPeriods.map((p) => (
                    <td key={p.key}>
                      {formatStatementAmount(periodTotals[p.key] ?? 0, true)}
                    </td>
                  ))}
                  {hasTotal && (
                    <td className={totalBorderClass}>
                      {formatStatementAmount(grandTotal, true)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
