"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import type { StatementData, Period, LineItem } from "./types";

interface StatementTableProps {
  data: StatementData;
  periods: Period[];
  showBudget?: boolean;
  showYoY?: boolean;
}

export function StatementTable({
  data,
  periods,
  showBudget = false,
  showYoY = false,
}: StatementTableProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set()
  );

  function toggleSection(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  function renderAmount(line: LineItem, periodKey: string) {
    const amount = line.amounts[periodKey];
    if (amount === undefined || amount === null) return null;

    // Check if this is a margin % row
    const isMargin = line.id.endsWith("_margin");
    if (isMargin) {
      const pct = amount * 100;
      return (
        <span className="italic text-muted-foreground">
          {pct < 0 ? `(${Math.abs(pct).toFixed(1)}%)` : `${pct.toFixed(1)}%`}
        </span>
      );
    }

    return formatStatementAmount(amount, line.showDollarSign);
  }

  function renderBudgetAmount(line: LineItem, periodKey: string) {
    const budget = line.budgetAmounts?.[periodKey];
    if (budget === undefined || budget === null) return null;
    return formatStatementAmount(budget, false);
  }

  function renderVariance(line: LineItem, periodKey: string) {
    const actual = line.amounts[periodKey];
    const budget = line.budgetAmounts?.[periodKey];
    if (
      actual === undefined ||
      actual === null ||
      budget === undefined ||
      budget === null
    )
      return null;

    const variance = actual - budget;
    if (variance === 0) return "\u2014";

    const formatted = formatStatementAmount(variance, false);
    // Green if favorable (positive for revenue, negative for expense)
    const favorable = variance >= 0;
    return (
      <span className={favorable ? "text-green-600" : "text-red-600"}>
        {formatted}
      </span>
    );
  }

  // Total columns per period: 1 for actual, +1 for budget, +1 for variance
  const colsPerPeriod = 1 + (showBudget ? 2 : 0);
  const totalCols =
    1 + periods.length * colsPerPeriod + (showYoY ? 2 : 0);

  // Determine stripe index for alternating row colors
  let stripeIndex = 0;

  function renderPeriodCells(
    line: LineItem,
    renderFn: "amount" | "budget-row" | "subtotal" | "computed"
  ) {
    return periods.map((period) => (
      <>
        <td key={period.key}>{renderAmount(line, period.key)}</td>
        {showBudget && (
          <>
            <td key={`${period.key}-budget`}>
              {renderBudgetAmount(line, period.key)}
            </td>
            <td key={`${period.key}-var`}>
              {renderVariance(line, period.key)}
            </td>
          </>
        )}
      </>
    ));
  }

  return (
    <div className="overflow-x-auto">
      <table className="stmt-table">
        <thead>
          <tr>
            <th className="min-w-[280px]"></th>
            {periods.map((period) => (
              <>
                <th key={period.key} className="min-w-[110px]">
                  {period.label}
                </th>
                {showBudget && (
                  <>
                    <th
                      key={`${period.key}-budget`}
                      className="min-w-[100px] text-muted-foreground"
                    >
                      Budget
                    </th>
                    <th
                      key={`${period.key}-var`}
                      className="min-w-[90px] text-muted-foreground"
                    >
                      Var $
                    </th>
                  </>
                )}
              </>
            ))}
            {showYoY && (
              <>
                <th className="min-w-[120px]">Prior Year</th>
                <th className="min-w-[120px]">YoY Change</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.sections.map((section) => {
            const isCollapsed = collapsedSections.has(section.id);
            const hasLines = section.lines.length > 0;
            const hasTitle = section.title.length > 0;

            // If this is a pure computed-line section (no title, no lines, just subtotalLine)
            if (!hasTitle && !hasLines && section.subtotalLine) {
              const line = section.subtotalLine;
              const isMargin = line.id.endsWith("_margin");
              const rowClass = line.isGrandTotal
                ? "stmt-grand-total"
                : line.isTotal
                  ? "stmt-subtotal"
                  : isMargin
                    ? "stmt-margin-row"
                    : "";

              return (
                <tr key={section.id} className={rowClass}>
                  <td
                    style={{
                      paddingLeft: isMargin ? "2rem" : undefined,
                    }}
                  >
                    {line.label}
                  </td>
                  {!isMargin
                    ? renderPeriodCells(line, "computed")
                    : periods.map((period) => (
                        <>
                          <td key={period.key}>
                            {renderAmount(line, period.key)}
                          </td>
                          {showBudget && (
                            <>
                              <td key={`${period.key}-budget`}></td>
                              <td key={`${period.key}-var`}></td>
                            </>
                          )}
                        </>
                      ))}
                  {showYoY && (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  )}
                </tr>
              );
            }

            // Section with title and lines
            return (
              <tbody key={section.id}>
                {/* Section header */}
                {hasTitle && (
                  <tr className="stmt-section-header">
                    <td colSpan={totalCols}>
                      {hasLines ? (
                        <button
                          onClick={() => toggleSection(section.id)}
                          className="flex items-center gap-1 hover:text-primary transition-colors w-full text-left font-bold"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {section.title}
                        </button>
                      ) : (
                        section.title
                      )}
                    </td>
                  </tr>
                )}

                {/* Separator row */}
                {hasTitle && (
                  <tr className="stmt-separator">
                    <td colSpan={totalCols}></td>
                  </tr>
                )}

                {/* Line items (collapsible) */}
                {!isCollapsed &&
                  section.lines.map((line) => {
                    if (line.isHeader) {
                      return (
                        <tr key={line.id} className="stmt-section-header">
                          <td
                            colSpan={totalCols}
                            style={{
                              paddingLeft: "2rem",
                              fontSize: "0.8125rem",
                            }}
                          >
                            <em>{line.label}</em>
                          </td>
                        </tr>
                      );
                    }

                    if (line.isSeparator) {
                      return (
                        <tr key={line.id} className="stmt-separator">
                          <td colSpan={totalCols}></td>
                        </tr>
                      );
                    }

                    const isStriped = stripeIndex % 2 === 0;
                    stripeIndex++;

                    return (
                      <tr
                        key={line.id}
                        className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                      >
                        <td>{line.label}</td>
                        {renderPeriodCells(line, "budget-row")}
                        {showYoY && (
                          <>
                            <td>
                              {line.priorYearAmounts
                                ? renderAmount(
                                    {
                                      ...line,
                                      amounts: line.priorYearAmounts,
                                    },
                                    periods[periods.length - 1]?.key ?? ""
                                  )
                                : null}
                            </td>
                            <td></td>
                          </>
                        )}
                      </tr>
                    );
                  })}

                {/* Subtotal line */}
                {section.subtotalLine && (
                  <tr
                    className={
                      section.subtotalLine.isGrandTotal
                        ? "stmt-grand-total"
                        : "stmt-subtotal"
                    }
                  >
                    <td>{section.subtotalLine.label}</td>
                    {renderPeriodCells(section.subtotalLine, "subtotal")}
                    {showYoY && (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    )}
                  </tr>
                )}

                {/* Add spacing after section */}
                <tr className="stmt-separator">
                  <td colSpan={totalCols}></td>
                </tr>
              </tbody>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
