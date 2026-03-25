"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AccountCombobox,
  type AccountOption,
} from "@/components/ui/account-combobox";
import { formatStatementAmount } from "@/components/financial-statements/format-utils";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  type StatementSectionConfig,
} from "@/lib/config/statement-sections";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MasterAccountInfo {
  id: string;
  name: string;
  account_number: string;
  classification: string;
  account_type: string;
}

interface BudgetEditGridProps {
  entityId: string;
  versionId: string;
  fiscalYear: number;
  /** Initial budget data from the view API */
  sections: Array<{
    id: string;
    title: string;
    lines: Array<{
      accountId: string;
      accountName: string;
      accountNumber: string | null;
      months: Record<string, number>;
      total: number;
    }>;
    subtotal: Record<string, number>;
  }>;
  /** All P&L master accounts available for this org */
  masterAccounts: MasterAccountInfo[];
  /** Called after data changes so parent can refresh if needed */
  onDataChanged?: () => void;
}

interface EditableRow {
  accountId: string;
  accountName: string;
  accountNumber: string;
  classification: string;
  accountType: string;
  months: Record<string, number>; // "1"-"12" -> amount
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_ABBRS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------------------------------------------------------------------------
// Editable Cell
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  onSave,
  isFirstInSection,
}: {
  value: number;
  onSave: (amount: number) => void;
  isFirstInSection: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEditing() {
    setEditValue(value !== 0 ? String(value) : "");
    setEditing(true);
  }

  function commitEdit() {
    const parsed = parseFloat(editValue.replace(/[,$]/g, "")) || 0;
    // Round to 4 decimal places to match DB precision
    const rounded = Math.round(parsed * 10000) / 10000;
    if (rounded !== value) {
      onSave(rounded);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  if (editing) {
    return (
      <td className="!p-0">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
            if (e.key === "Tab") {
              commitEdit();
            }
          }}
          className="w-full h-full px-2 py-1 text-right text-xs bg-background border border-primary/50 rounded-sm outline-none focus:ring-1 focus:ring-primary/50"
          style={{ minWidth: 80 }}
        />
      </td>
    );
  }

  return (
    <td
      onClick={startEditing}
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      title="Click to edit"
    >
      {value !== 0
        ? formatStatementAmount(value, isFirstInSection)
        : "\u00A0"}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Main Grid
// ---------------------------------------------------------------------------

export function BudgetEditGrid({
  entityId,
  versionId,
  fiscalYear,
  sections: initialSections,
  masterAccounts,
  onDataChanged,
}: BudgetEditGridProps) {
  // Local editable data: accountId -> { "1": amount, ..., "12": amount }
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null); // "accountId-month" currently saving
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addAccountId, setAddAccountId] = useState("");

  // Initialize from budget view data
  useEffect(() => {
    const editableRows: EditableRow[] = [];

    for (const section of initialSections) {
      for (const line of section.lines) {
        const acct = masterAccounts.find((a) => a.id === line.accountId);
        editableRows.push({
          accountId: line.accountId,
          accountName: line.accountName,
          accountNumber: line.accountNumber ?? acct?.account_number ?? "",
          classification: acct?.classification ?? "",
          accountType: acct?.account_type ?? "",
          months: { ...line.months },
        });
      }
    }

    setRows(editableRows);
  }, [initialSections, masterAccounts]);

  // Group rows by income statement section
  const groupedSections = useGroupedSections(rows);

  // Compute section subtotals
  const sectionTotals = useSectionTotals(groupedSections);

  // Compute derived lines (Gross Margin, Operating Margin, Net Income)
  const computedLines = useComputedLines(sectionTotals);

  // Account IDs already in the budget
  const existingAccountIds = new Set(rows.map((r) => r.accountId));

  // P&L accounts available for adding (not already in budget)
  const availableAccounts: AccountOption[] = masterAccounts
    .filter(
      (a) =>
        !existingAccountIds.has(a.id) &&
        (a.classification === "Revenue" || a.classification === "Expense")
    )
    .map((a) => ({
      id: a.id,
      account_number: a.account_number,
      name: a.name,
      account_type: a.account_type,
    }));

  // Save a single cell to the API
  const saveCell = useCallback(
    async (accountId: string, month: number, amount: number) => {
      const key = `${accountId}-${month}`;
      setSaving(key);
      try {
        const res = await fetch("/api/budgets/amounts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            versionId,
            masterAccountId: accountId,
            periodYear: fiscalYear,
            periodMonth: month,
            amount,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          console.error("Save failed:", data.error);
        }
      } catch (err) {
        console.error("Save error:", err);
      } finally {
        setSaving(null);
      }
    },
    [entityId, versionId, fiscalYear]
  );

  // Handle cell edit
  function handleCellSave(accountId: string, month: number, amount: number) {
    // Update local state
    setRows((prev) =>
      prev.map((r) =>
        r.accountId === accountId
          ? { ...r, months: { ...r.months, [String(month)]: amount } }
          : r
      )
    );
    // Persist to API
    saveCell(accountId, month, amount);
  }

  // Handle adding a new account
  function handleAddAccount() {
    if (!addAccountId) return;
    const acct = masterAccounts.find((a) => a.id === addAccountId);
    if (!acct) return;

    const newRow: EditableRow = {
      accountId: acct.id,
      accountName: acct.name,
      accountNumber: acct.account_number,
      classification: acct.classification,
      accountType: acct.account_type,
      months: {},
    };
    for (let m = 1; m <= 12; m++) {
      newRow.months[String(m)] = 0;
    }

    setRows((prev) => [...prev, newRow]);
    setAddAccountId("");
    setShowAddDialog(false);
  }

  // Handle removing an account row
  async function handleRemoveAccount(accountId: string) {
    // Remove from local state
    setRows((prev) => prev.filter((r) => r.accountId !== accountId));

    // Delete all months for this account from the API
    for (let m = 1; m <= 12; m++) {
      await fetch("/api/budgets/amounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          versionId,
          masterAccountId: accountId,
          periodYear: fiscalYear,
          periodMonth: m,
          amount: 0, // 0 triggers delete
        }),
      });
    }
  }

  // Map computed lines by the section they follow
  const computedAfterSection: Record<string, string> = {
    direct_operating_costs: "gross_margin",
    other_operating_costs: "operating_margin",
    other_income: "net_income",
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          Click any amount cell to edit. Changes save automatically.
        </p>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Account
          </Button>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Add GL Account to Budget</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <AccountCombobox
                accounts={availableAccounts}
                value={addAccountId}
                onValueChange={setAddAccountId}
                placeholder="Select a P&L account..."
                searchPlaceholder="Search by number or name..."
                emptyMessage="No unbudgeted accounts found."
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddDialog(false);
                    setAddAccountId("");
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddAccount} disabled={!addAccountId}>
                  Add Account
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="stmt-table">
          <thead>
            <tr>
              <th className="min-w-[280px]"></th>
              {MONTHS.map((m) => (
                <th key={m} className="min-w-[100px]">
                  {MONTH_ABBRS[m - 1]} {fiscalYear}
                </th>
              ))}
              <th className="min-w-[110px] border-l-2 border-border font-bold">
                Total
              </th>
              <th className="w-[40px]"></th>
            </tr>
          </thead>

          {INCOME_STATEMENT_SECTIONS.map((config) => {
            const sectionRows = groupedSections[config.id] ?? [];
            const subtotal = sectionTotals[config.id];

            // Skip sections with no rows and no title to show
            if (sectionRows.length === 0 && !config.title) return null;

            const computedId = computedAfterSection[config.id];
            const comp = computedId
              ? computedLines.find((c) => c.id === computedId)
              : null;

            return (
              <tbody key={config.id}>
                {/* Section header */}
                {config.title && (
                  <>
                    <tr className="stmt-section-header">
                      <td colSpan={15}>
                        <span className="font-bold">{config.title}</span>
                      </td>
                    </tr>
                    <tr className="stmt-separator">
                      <td colSpan={15}></td>
                    </tr>
                  </>
                )}

                {/* Account rows */}
                {sectionRows.map((row, idx) => {
                  const rowTotal = MONTHS.reduce(
                    (sum, m) => sum + (row.months[String(m)] ?? 0),
                    0
                  );

                  return (
                    <tr
                      key={row.accountId}
                      className={`stmt-line-item ${idx % 2 === 0 ? "stmt-row-striped" : ""}`}
                    >
                      <td>
                        {row.accountNumber
                          ? `${row.accountNumber} - ${row.accountName}`
                          : row.accountName}
                      </td>
                      {MONTHS.map((m) => (
                        <EditableCell
                          key={m}
                          value={row.months[String(m)] ?? 0}
                          onSave={(amount) =>
                            handleCellSave(row.accountId, m, amount)
                          }
                          isFirstInSection={idx === 0}
                        />
                      ))}
                      <td className="border-l-2 border-border font-medium">
                        {formatStatementAmount(rowTotal, idx === 0)}
                      </td>
                      <td className="!px-1">
                        <button
                          onClick={() => handleRemoveAccount(row.accountId)}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-destructive/60 hover:text-destructive transition-opacity p-0.5"
                          title="Remove account from budget"
                          style={{ opacity: undefined }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.opacity = "1")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.opacity = "0.3")
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {/* Subtotal */}
                {sectionRows.length > 0 && subtotal && (
                  <tr className="stmt-subtotal">
                    <td>
                      {config.title
                        ? `Total ${config.title.charAt(0)}${config.title.slice(1).toLowerCase()}`
                        : "Subtotal"}
                    </td>
                    {MONTHS.map((m) => (
                      <td key={m}>
                        {formatStatementAmount(subtotal[String(m)] ?? 0, true)}
                      </td>
                    ))}
                    <td className="border-l-2 border-border">
                      {formatStatementAmount(subtotal.total ?? 0, true)}
                    </td>
                    <td></td>
                  </tr>
                )}

                {/* Separator after section */}
                <tr className="stmt-separator">
                  <td colSpan={15}></td>
                </tr>

                {/* Computed line (Gross Margin, Operating Margin, Net Income) */}
                {comp && (
                  <>
                    <tr
                      className={
                        comp.isGrandTotal ? "stmt-grand-total" : "stmt-subtotal"
                      }
                    >
                      <td>{comp.label}</td>
                      {MONTHS.map((m) => (
                        <td key={m}>
                          {formatStatementAmount(
                            comp.amounts[String(m)] ?? 0,
                            true
                          )}
                        </td>
                      ))}
                      <td className="border-l-2 border-border">
                        {formatStatementAmount(comp.amounts.total ?? 0, true)}
                      </td>
                      <td></td>
                    </tr>
                    <tr className="stmt-separator">
                      <td colSpan={15}></td>
                    </tr>
                  </>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks for computed data
// ---------------------------------------------------------------------------

function useGroupedSections(rows: EditableRow[]) {
  const grouped: Record<string, EditableRow[]> = {};

  for (const config of INCOME_STATEMENT_SECTIONS) {
    grouped[config.id] = rows
      .filter(
        (r) =>
          r.classification === config.classification &&
          config.accountTypes.includes(r.accountType)
      )
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  }

  return grouped;
}

function useSectionTotals(
  groupedSections: Record<string, EditableRow[]>
): Record<string, Record<string, number>> {
  const totals: Record<string, Record<string, number>> = {};

  for (const [sectionId, sectionRows] of Object.entries(groupedSections)) {
    const subtotal: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) subtotal[String(m)] = 0;
    subtotal.total = 0;

    for (const row of sectionRows) {
      for (let m = 1; m <= 12; m++) {
        const val = row.months[String(m)] ?? 0;
        subtotal[String(m)] += val;
        subtotal.total += val;
      }
    }

    totals[sectionId] = subtotal;
  }

  return totals;
}

function useComputedLines(
  sectionTotals: Record<string, Record<string, number>>
) {
  return INCOME_STATEMENT_COMPUTED.map((comp) => {
    const amounts: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      let val = 0;
      for (const { sectionId, sign } of comp.formula) {
        val += (sectionTotals[sectionId]?.[String(m)] ?? 0) * sign;
      }
      amounts[String(m)] = val;
    }
    let total = 0;
    for (const { sectionId, sign } of comp.formula) {
      total += (sectionTotals[sectionId]?.total ?? 0) * sign;
    }
    amounts.total = total;

    return {
      id: comp.id,
      label: comp.label,
      amounts,
      isGrandTotal: comp.isGrandTotal,
    };
  });
}
