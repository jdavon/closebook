"use client";

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatStatementAmount } from "./format-utils";
import type { DrillDownResponse } from "./types";
import type { DrillDownCellInfo } from "./use-drill-down";

interface DrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  data: DrillDownResponse | null;
  error: string | null;
  cellInfo: DrillDownCellInfo | null;
}

export function DrillDownDialog({
  open,
  onOpenChange,
  loading,
  data,
  error,
  cellInfo,
}: DrillDownDialogProps) {
  if (!cellInfo) return null;

  const columnLabel = cellInfo.columnType === "budget" ? "Budget" : "Actual";
  const hasMultipleGroups = (data?.groups.length ?? 0) > 1;
  const hasAdjustments = (data?.adjustments.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{cellInfo.lineLabel}</DialogTitle>
          <DialogDescription>
            {cellInfo.periodLabel} &middot; {columnLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading breakdown...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-destructive">
              {error}
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              {data.groups.length === 0 && !hasAdjustments && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No detail data available for this cell.
                </p>
              )}

              {data.groups.map((group, gi) => (
                <div key={`${group.masterAccountId}-${gi}`}>
                  {/* Group header for computed lines with multiple sections */}
                  {hasMultipleGroups && group.sectionLabel && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {group.sign === -1 ? "Less: " : ""}{group.sectionLabel}
                      </span>
                    </div>
                  )}

                  {/* Account header when there are multiple master accounts in a group or multiple groups */}
                  {(hasMultipleGroups || data.groups.some((g) => g.masterAccountId !== data.groups[0].masterAccountId)) && (
                    <div className="text-sm font-medium mb-1 text-foreground/80">
                      {group.masterAccountNumber ? `${group.masterAccountNumber} — ` : ""}
                      {group.masterAccountName}
                    </div>
                  )}

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-1.5 font-medium">Entity</th>
                        <th className="text-left py-1.5 font-medium">Account</th>
                        <th className="text-left py-1.5 font-medium">Acct #</th>
                        <th className="text-right py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, ri) => (
                        <tr
                          key={`${row.entityId}-${row.accountId}-${ri}`}
                          className="border-b border-border/50 last:border-b-0"
                        >
                          <td className="py-1.5 text-muted-foreground">{row.entityCode}</td>
                          <td className="py-1.5">{row.accountName}</td>
                          <td className="py-1.5 text-muted-foreground font-mono text-xs">
                            {row.accountNumber ?? "—"}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {formatStatementAmount(row.amount, false)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {(group.rows.length > 1 || hasMultipleGroups) && (
                      <tfoot>
                        <tr className="border-t font-medium">
                          <td colSpan={3} className="py-1.5 text-right text-xs text-muted-foreground">
                            {hasMultipleGroups ? "Section subtotal" : "Subtotal"}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {formatStatementAmount(group.subtotal, false)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              ))}

              {/* Adjustments */}
              {hasAdjustments && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    Adjustments
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-1.5 font-medium">Type</th>
                        <th className="text-left py-1.5 font-medium">Entity</th>
                        <th className="text-left py-1.5 font-medium">Description</th>
                        <th className="text-right py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.adjustments.map((adj, ai) => (
                        <tr
                          key={ai}
                          className="border-b border-border/50 last:border-b-0"
                        >
                          <td className="py-1.5 text-muted-foreground text-xs">
                            {adj.type === "pro_forma" ? "Pro Forma" : "Allocation"}
                          </td>
                          <td className="py-1.5 text-muted-foreground">{adj.entityCode}</td>
                          <td className="py-1.5">{adj.description}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {formatStatementAmount(adj.amount, false)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Grand total */}
              {(data.groups.length > 0 || hasAdjustments) && (
                <div className="border-t-2 border-foreground pt-2 flex justify-between items-center">
                  <span className="font-semibold text-sm">Total</span>
                  <span className="font-semibold font-mono tabular-nums">
                    {formatStatementAmount(data.total, true)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
