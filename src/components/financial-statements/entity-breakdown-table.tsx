"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import type { StatementData, LineItem, EntityColumn } from "./types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EntityBreakdownTableProps {
  data: StatementData;
  columns: EntityColumn[];
  showPctOfTotal?: boolean;
}

export function EntityBreakdownTable({
  data,
  columns,
  showPctOfTotal = false,
}: EntityBreakdownTableProps) {
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

  // Separate entity columns from consolidated
  const entityColumns = columns.filter((c) => c.key !== "consolidated");
  const consolidatedColumn = columns.find((c) => c.key === "consolidated");

  function renderAmount(line: LineItem, columnKey: string) {
    const amount = line.amounts[columnKey];
    if (amount === undefined || amount === null) return null;

    const isMargin = line.id.endsWith("_margin");
    if (isMargin) {
      const pct = amount * 100;
      return (
        <span className="italic text-muted-foreground">
          {pct < 0
            ? `(${Math.abs(pct).toFixed(1)}%)`
            : `${pct.toFixed(1)}%`}
        </span>
      );
    }

    return formatStatementAmount(amount, line.showDollarSign);
  }

  function renderPctOfTotal(line: LineItem, entityKey: string) {
    const entityAmt = line.amounts[entityKey];
    const totalAmt = line.amounts["consolidated"];
    if (
      entityAmt === undefined ||
      totalAmt === undefined ||
      totalAmt === 0 ||
      line.id.endsWith("_margin")
    )
      return null;

    const pct = (entityAmt / totalAmt) * 100;
    return (
      <span className="text-muted-foreground text-[10px] ml-1">
        {pct < 0 ? `(${Math.abs(pct).toFixed(0)}%)` : `${pct.toFixed(0)}%`}
      </span>
    );
  }

  // Column calculations
  const totalCols = 1 + entityColumns.length + (consolidatedColumn ? 1 : 0);
  const numericColCount = entityColumns.length + (consolidatedColumn ? 1 : 0);
  const labelWidthPct =
    numericColCount <= 3 ? 35 : numericColCount <= 6 ? 28 : 22;
  const numericWidthPct = (100 - labelWidthPct) / numericColCount;
  const tableMinWidth = 280 + numericColCount * 120;

  let stripeIndex = 0;

  function renderEntityCells(line: LineItem) {
    return (
      <>
        {entityColumns.map((col) => (
          <td key={col.key}>
            {renderAmount(line, col.key)}
            {showPctOfTotal && renderPctOfTotal(line, col.key)}
          </td>
        ))}
        {consolidatedColumn && (
          <td key="consolidated" className="font-semibold border-l border-border/50">
            {renderAmount(line, "consolidated")}
          </td>
        )}
      </>
    );
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table
          className="stmt-table stmt-table-fixed"
          style={{ minWidth: `${tableMinWidth}px` }}
        >
          <colgroup>
            <col style={{ width: `${labelWidthPct}%` }} />
            {entityColumns.map((col) => (
              <col key={col.key} style={{ width: `${numericWidthPct}%` }} />
            ))}
            {consolidatedColumn && (
              <col style={{ width: `${numericWidthPct}%` }} />
            )}
          </colgroup>
          <thead>
            <tr>
              <th></th>
              {entityColumns.map((col) => (
                <th key={col.key}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">{col.label}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{col.fullName}</p>
                    </TooltipContent>
                  </Tooltip>
                </th>
              ))}
              {consolidatedColumn && (
                <th className="border-l border-border/50">
                  {consolidatedColumn.label}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.sections.map((section) => {
              const isCollapsed = collapsedSections.has(section.id);
              const hasLines = section.lines.length > 0;
              const hasTitle = section.title.length > 0;

              // Computed-only section (no title, no lines, just subtotalLine)
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
                    {entityColumns.map((col) => (
                      <td key={col.key}>{renderAmount(line, col.key)}</td>
                    ))}
                    {consolidatedColumn && (
                      <td
                        className={
                          !isMargin
                            ? "font-semibold border-l border-border/50"
                            : "border-l border-border/50"
                        }
                      >
                        {renderAmount(line, "consolidated")}
                      </td>
                    )}
                  </tr>
                );
              }

              // Headerless section with lines
              if (!hasTitle && hasLines) {
                return (
                  <tbody key={section.id}>
                    {section.lines.map((line) => {
                      const isStriped = stripeIndex % 2 === 0;
                      stripeIndex++;
                      return (
                        <tr
                          key={line.id}
                          className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                        >
                          <td style={{ paddingLeft: "2rem" }}>{line.label}</td>
                          {renderEntityCells(line)}
                        </tr>
                      );
                    })}
                  </tbody>
                );
              }

              // Standard section with title and lines
              return (
                <tbody key={section.id}>
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

                  {hasTitle && (
                    <tr className="stmt-separator">
                      <td colSpan={totalCols}></td>
                    </tr>
                  )}

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
                          {renderEntityCells(line)}
                        </tr>
                      );
                    })}

                  {section.subtotalLine && (
                    <tr
                      className={
                        section.subtotalLine.isGrandTotal
                          ? "stmt-grand-total"
                          : "stmt-subtotal"
                      }
                    >
                      <td>{section.subtotalLine.label}</td>
                      {entityColumns.map((col) => (
                        <td key={col.key}>
                          {renderAmount(section.subtotalLine!, col.key)}
                        </td>
                      ))}
                      {consolidatedColumn && (
                        <td className="font-semibold border-l border-border/50">
                          {renderAmount(
                            section.subtotalLine,
                            "consolidated"
                          )}
                        </td>
                      )}
                    </tr>
                  )}

                  <tr className="stmt-separator">
                    <td colSpan={totalCols}></td>
                  </tr>
                </tbody>
              );
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
