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

/** A single adjustment line within an account group */
interface AdjustmentLine {
  key: string;
  entityCode: string;
  description: string;
  notes: string | null;
  periodYear: number;
  periodMonth: number;
  amountsByBucket: Record<string, number>;
  total: number;
}

/** A group of adjustments sharing the same account */
interface AccountGroup {
  accountName: string;
  lines: AdjustmentLine[];
  subtotalByBucket: Record<string, number>;
  subtotal: number;
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

  // ---- Group adjustments by account name ----
  const accountGroupMap = new Map<string, AccountGroup>();
  const accountGroups: AccountGroup[] = [];

  for (const adj of adjustments) {
    let group = accountGroupMap.get(adj.accountName);
    if (!group) {
      group = {
        accountName: adj.accountName,
        lines: [],
        subtotalByBucket: {},
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
        periodYear: adj.periodYear,
        periodMonth: adj.periodMonth,
        amountsByBucket: {},
        total: 0,
      };
      group.lines.push(line);
    }

    line.amountsByBucket[adj.bucketKey] =
      (line.amountsByBucket[adj.bucketKey] ?? 0) + adj.amount;
    line.total += adj.amount;

    group.subtotalByBucket[adj.bucketKey] =
      (group.subtotalByBucket[adj.bucketKey] ?? 0) + adj.amount;
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

  // Compute grand totals
  const periodTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const period of displayPeriods) {
    let sum = 0;
    for (const group of accountGroups) {
      sum += group.subtotalByBucket[period.key] ?? 0;
    }
    periodTotals[period.key] = sum;
    grandTotal += sum;
  }

  const totalBorderClass = "border-l-2 border-border";
  const totalColSpan = 1 + displayPeriods.length + (hasTotal ? 1 : 0);

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
                    {/* Individual adjustments */}
                    {group.lines.map((line) => {
                      // For lines spanning multiple months, render one row per bucket
                      const bucketKeys = Object.keys(line.amountsByBucket).sort();
                      return bucketKeys.map((bk) => {
                        const amt = line.amountsByBucket[bk];
                        const isStriped = stripeIdx % 2 === 0;
                        stripeIdx++;
                        // Find month/year from bucket key for display
                        const adj = adjustments.find(
                          (a) =>
                            a.bucketKey === bk &&
                            a.entityCode === line.entityCode &&
                            a.description === line.description
                        );
                        const periodLabel = adj
                          ? `${MONTHS[adj.periodMonth - 1]?.slice(0, 3)} ${adj.periodYear}`
                          : bk;
                        return (
                          <tr
                            key={`${line.key}-${bk}`}
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

  // --- On-screen columnar view (grouped by account, matches period columns) ---
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
                          {displayPeriods.map((p) => {
                            const amt = line.amountsByBucket[p.key] ?? 0;
                            return (
                              <td key={p.key}>
                                {amt !== 0
                                  ? formatStatementAmount(amt, false)
                                  : "—"}
                              </td>
                            );
                          })}
                          {hasTotal && (
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
                      {displayPeriods.map((p) => (
                        <td key={p.key}>
                          {formatStatementAmount(
                            group.subtotalByBucket[p.key] ?? 0,
                            true
                          )}
                        </td>
                      ))}
                      {hasTotal && (
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
