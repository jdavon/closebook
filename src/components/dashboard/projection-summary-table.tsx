"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatStatementAmount,
  formatVariance,
} from "@/components/financial-statements/format-utils";

export interface SummaryRow {
  id: string;
  label: string;
  actual: number;
  budget: number | null;
  isComputed?: boolean;
  /** For expense rows, positive variance (over budget) is unfavorable */
  isExpense?: boolean;
}

interface ProjectionSummaryTableProps {
  rows: SummaryRow[];
  actualLabel?: string;
  budgetLabel?: string;
  showVariance?: boolean;
}

export function ProjectionSummaryTable({
  rows,
  actualLabel = "Actual",
  budgetLabel = "Budget",
  showVariance = true,
}: ProjectionSummaryTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40%]" />
          <TableHead className="text-right tabular-nums">{actualLabel}</TableHead>
          {showVariance && (
            <>
              <TableHead className="text-right tabular-nums">
                {budgetLabel}
              </TableHead>
              <TableHead className="text-right tabular-nums">Var ($)</TableHead>
              <TableHead className="text-right tabular-nums">Var (%)</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const variance =
            row.budget !== null ? formatVariance(row.actual, row.budget) : null;

          // For expense rows, a positive dollar variance (spent more than budget)
          // is unfavorable. For revenue rows, positive variance is favorable.
          const isFavorable = variance
            ? row.isExpense
              ? variance.dollarValue <= 0
              : variance.dollarValue >= 0
            : true;

          return (
            <TableRow
              key={row.id}
              className={row.isComputed ? "font-semibold border-t" : ""}
            >
              <TableCell
                className={row.isComputed ? "font-semibold" : "text-muted-foreground"}
              >
                {row.label}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatStatementAmount(row.actual, true)}
              </TableCell>
              {showVariance && (
                <>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.budget !== null
                      ? formatStatementAmount(row.budget, true)
                      : "\u2014"}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      variance && !isFavorable
                        ? "text-red-600"
                        : variance && isFavorable && variance.dollarValue !== 0
                        ? "text-green-600"
                        : ""
                    }`}
                  >
                    {variance ? variance.dollarVariance : "\u2014"}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      variance && !isFavorable
                        ? "text-red-600"
                        : variance && isFavorable && variance.dollarValue !== 0
                        ? "text-green-600"
                        : ""
                    }`}
                  >
                    {variance ? variance.percentVariance : "\u2014"}
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
