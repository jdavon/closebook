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

  // Determine stripe index for alternating row colors
  let stripeIndex = 0;

  return (
    <div className="overflow-x-auto">
      <table className="stmt-table">
        <thead>
          <tr>
            <th className="min-w-[280px]"></th>
            {periods.map((period) => (
              <th key={period.key} className="min-w-[120px]">
                {period.label}
              </th>
            ))}
            {showBudget && (
              <>
                <th className="min-w-[120px]">Budget</th>
                <th className="min-w-[120px]">Variance</th>
              </>
            )}
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
                  {periods.map((period) => (
                    <td key={period.key}>{renderAmount(line, period.key)}</td>
                  ))}
                  {showBudget && (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  )}
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
                    <td
                      colSpan={
                        periods.length +
                        1 +
                        (showBudget ? 2 : 0) +
                        (showYoY ? 2 : 0)
                      }
                    >
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
                    <td
                      colSpan={
                        periods.length +
                        1 +
                        (showBudget ? 2 : 0) +
                        (showYoY ? 2 : 0)
                      }
                    ></td>
                  </tr>
                )}

                {/* Line items (collapsible) */}
                {!isCollapsed &&
                  section.lines.map((line) => {
                    if (line.isHeader) {
                      return (
                        <tr key={line.id} className="stmt-section-header">
                          <td
                            colSpan={
                              periods.length +
                              1 +
                              (showBudget ? 2 : 0) +
                              (showYoY ? 2 : 0)
                            }
                            style={{ paddingLeft: "2rem", fontSize: "0.8125rem" }}
                          >
                            <em>{line.label}</em>
                          </td>
                        </tr>
                      );
                    }

                    if (line.isSeparator) {
                      return (
                        <tr key={line.id} className="stmt-separator">
                          <td
                            colSpan={
                              periods.length +
                              1 +
                              (showBudget ? 2 : 0) +
                              (showYoY ? 2 : 0)
                            }
                          ></td>
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
                        {periods.map((period) => (
                          <td key={period.key}>
                            {renderAmount(line, period.key)}
                          </td>
                        ))}
                        {showBudget && (
                          <>
                            <td>
                              {line.budgetAmounts
                                ? renderAmount(
                                    { ...line, amounts: line.budgetAmounts },
                                    periods[periods.length - 1]?.key ?? ""
                                  )
                                : null}
                            </td>
                            <td></td>
                          </>
                        )}
                        {showYoY && (
                          <>
                            <td>
                              {line.priorYearAmounts
                                ? renderAmount(
                                    { ...line, amounts: line.priorYearAmounts },
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
                    {periods.map((period) => (
                      <td key={period.key}>
                        {renderAmount(section.subtotalLine!, period.key)}
                      </td>
                    ))}
                    {showBudget && (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    )}
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
                  <td
                    colSpan={
                      periods.length +
                      1 +
                      (showBudget ? 2 : 0) +
                      (showYoY ? 2 : 0)
                    }
                  ></td>
                </tr>
              </tbody>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
