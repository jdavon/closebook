"use client";

import { Card, CardContent } from "@/components/ui/card";
import { StatementHeader } from "./statement-header";
import { formatStatementAmount } from "./format-utils";
import type { ProFormaAdjustmentDetail, Granularity } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ProFormaDetailScheduleProps {
  companyName: string;
  adjustments: ProFormaAdjustmentDetail[];
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  /** When true, renders as a print-only page with full detail listing */
  printMode?: boolean;
}

/** A monthly column in the detail schedule */
interface MonthColumn {
  key: string;   // "2026-01"
  label: string; // "Jan-26"
  year: number;
  month: number;
}

/** A single adjustment line within an account group */
interface AdjustmentLine {
  key: string;
  entityCode: string;
  description: string;
  notes: string | null;
  amountsByMonth: Record<string, number>;
  total: number;
}

/** A group of adjustments sharing the same account */
interface AccountGroup {
  accountName: string;
  lines: AdjustmentLine[];
  subtotalByMonth: Record<string, number>;
  subtotal: number;
}

/**
 * Generate monthly columns for the date range.
 * Always monthly regardless of the main statement granularity.
 */
function buildMonthColumns(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): MonthColumn[] {
  const cols: MonthColumn[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const label = `${MONTHS[m - 1]?.slice(0, 3)}-${String(y).slice(2)}`;
    cols.push({ key, label, year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return cols;
}

/** Month key from a year/month pair */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function ProFormaDetailSchedule({
  companyName,
  adjustments,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  printMode = false,
}: ProFormaDetailScheduleProps) {
  if (adjustments.length === 0) return null;

  // Always build monthly columns from the date range
  const monthColumns = buildMonthColumns(startYear, startMonth, endYear, endMonth);
  const showTotal = monthColumns.length > 1;

  // ---- Group adjustments by account name ----
  const accountGroupMap = new Map<string, AccountGroup>();
  const accountGroups: AccountGroup[] = [];

  for (const adj of adjustments) {
    let group = accountGroupMap.get(adj.accountName);
    if (!group) {
      group = {
        accountName: adj.accountName,
        lines: [],
        subtotalByMonth: {},
        subtotal: 0,
      };
      accountGroupMap.set(adj.accountName, group);
      accountGroups.push(group);
    }

    // Find or create a line within this group (keyed by entity + description)
    const lineKey = `${adj.entityCode}|${adj.description}`;
    let line = group.lines.find((l) => l.key === lineKey);
    if (!line) {
      line = {
        key: lineKey,
        entityCode: adj.entityCode,
        description: adj.description,
        notes: adj.notes,
        amountsByMonth: {},
        total: 0,
      };
      group.lines.push(line);
    }

    // Map using periodYear/periodMonth — NOT bucketKey
    const mk = monthKey(adj.periodYear, adj.periodMonth);
    line.amountsByMonth[mk] = (line.amountsByMonth[mk] ?? 0) + adj.amount;
    line.total += adj.amount;

    group.subtotalByMonth[mk] = (group.subtotalByMonth[mk] ?? 0) + adj.amount;
    group.subtotal += adj.amount;
  }

  // Sort groups alphabetically by account name, lines by entity then description
  accountGroups.sort((a, b) => a.accountName.localeCompare(b.accountName));
  for (const group of accountGroups) {
    group.lines.sort((a, b) =>
      a.entityCode.localeCompare(b.entityCode) ||
      a.description.localeCompare(b.description)
    );
  }

  // Compute grand totals per month
  const monthTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const col of monthColumns) {
    let sum = 0;
    for (const group of accountGroups) {
      sum += group.subtotalByMonth[col.key] ?? 0;
    }
    monthTotals[col.key] = sum;
    grandTotal += sum;
  }

  const totalBorderClass = "border-l-2 border-border";
  const totalColSpan = 1 + monthColumns.length + (showTotal ? 1 : 0);

  // --- Print-only detailed listing (grouped by account) ---
  if (printMode) {
    return (
      <div className="stmt-pf-print-schedule">
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
                  <th className="text-left min-w-[70px]">Period</th>
                  <th className="text-right min-w-[90px]">Amount</th>
                  <th className="text-left min-w-[250px]">Description</th>
                </tr>
              </thead>
              {accountGroups.map((group) => {
                let stripeIdx = 0;
                return (
                  <tbody key={group.accountName}>
                    {/* Account section header */}
                    <tr className="stmt-section-header">
                      <td colSpan={4}>
                        <span className="font-bold">{group.accountName}</span>
                      </td>
                    </tr>
                    {/* Individual adjustments — one row per month per line */}
                    {group.lines.map((line) => {
                      const monthKeys = Object.keys(line.amountsByMonth).sort();
                      return monthKeys.map((mk) => {
                        const amt = line.amountsByMonth[mk];
                        const isStriped = stripeIdx % 2 === 0;
                        stripeIdx++;
                        const [y, m] = mk.split("-").map(Number);
                        const periodLabel = `${MONTHS[m - 1]?.slice(0, 3)} ${y}`;
                        return (
                          <tr
                            key={`${line.key}-${mk}`}
                            className={isStriped ? "stmt-row-striped" : ""}
                          >
                            <td>{line.entityCode}</td>
                            <td>{periodLabel}</td>
                            <td className="text-right">
                              {formatStatementAmount(amt, true)}
                            </td>
                            <td>{line.description}</td>
                          </tr>
                        );
                      });
                    })}
                    {/* Account subtotal */}
                    <tr className="stmt-subtotal">
                      <td colSpan={2} className="font-semibold">
                        Total {group.accountName}
                      </td>
                      <td className="text-right font-semibold">
                        {formatStatementAmount(group.subtotal, true)}
                      </td>
                      <td></td>
                    </tr>
                    {/* Spacing */}
                    <tr className="stmt-separator">
                      <td colSpan={4}></td>
                    </tr>
                  </tbody>
                );
              })}
              <tfoot>
                <tr className="stmt-grand-total">
                  <td colSpan={2} className="font-bold">
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

  // --- On-screen columnar view (always monthly columns + total) ---
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
                  {monthColumns.map((col) => (
                    <th key={col.key} className="min-w-[100px]">
                      {col.label}
                    </th>
                  ))}
                  {showTotal && (
                    <th className={`min-w-[110px] ${totalBorderClass} font-bold`}>
                      Total
                    </th>
                  )}
                </tr>
              </thead>
              {accountGroups.map((group) => {
                let stripeIdx = 0;
                return (
                  <tbody key={group.accountName}>
                    {/* Account section header */}
                    <tr className="stmt-section-header">
                      <td colSpan={totalColSpan}>
                        <span className="font-bold">{group.accountName}</span>
                      </td>
                    </tr>
                    <tr className="stmt-separator">
                      <td colSpan={totalColSpan}></td>
                    </tr>

                    {/* Individual adjustment lines */}
                    {group.lines.map((line) => {
                      const isStriped = stripeIdx % 2 === 0;
                      stripeIdx++;
                      return (
                        <tr
                          key={line.key}
                          className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                        >
                          <td>
                            <span className="text-muted-foreground">
                              {line.entityCode && `[${line.entityCode}] `}
                            </span>
                            {line.description}
                          </td>
                          {monthColumns.map((col) => {
                            const amt = line.amountsByMonth[col.key] ?? 0;
                            return (
                              <td key={col.key}>
                                {amt !== 0
                                  ? formatStatementAmount(amt, false)
                                  : "—"}
                              </td>
                            );
                          })}
                          {showTotal && (
                            <td className={totalBorderClass}>
                              {line.total !== 0
                                ? formatStatementAmount(line.total, false)
                                : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}

                    {/* Account subtotal */}
                    <tr className="stmt-subtotal">
                      <td>Total {group.accountName}</td>
                      {monthColumns.map((col) => (
                        <td key={col.key}>
                          {formatStatementAmount(
                            group.subtotalByMonth[col.key] ?? 0,
                            true
                          )}
                        </td>
                      ))}
                      {showTotal && (
                        <td className={totalBorderClass}>
                          {formatStatementAmount(group.subtotal, true)}
                        </td>
                      )}
                    </tr>

                    {/* Spacing */}
                    <tr className="stmt-separator">
                      <td colSpan={totalColSpan}></td>
                    </tr>
                  </tbody>
                );
              })}

              {/* Grand total */}
              <tbody>
                <tr className="stmt-grand-total">
                  <td>Total Pro Forma Impact</td>
                  {monthColumns.map((col) => (
                    <td key={col.key}>
                      {formatStatementAmount(monthTotals[col.key] ?? 0, true)}
                    </td>
                  ))}
                  {showTotal && (
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
