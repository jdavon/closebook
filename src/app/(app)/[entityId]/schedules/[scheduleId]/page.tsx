"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Lock,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";

interface ColumnDef {
  key: string;
  name: string;
  type: string;
  width: number;
}

interface LineItem {
  id?: string;
  row_order: number;
  is_header: boolean;
  is_total: boolean;
  cell_data: Record<string, string | number>;
  amount: number;
}

interface ScheduleData {
  id: string;
  name: string;
  schedule_type: string;
  status: string;
  column_definitions: ColumnDef[];
  total_amount: number;
  gl_balance: number | null;
  variance: number | null;
  accounts?: { name: string; account_number: string | null } | null;
}

export default function ScheduleEditorPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const scheduleId = params.scheduleId as string;
  const router = useRouter();
  const supabase = createClient();

  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving">("saved");

  const loadSchedule = useCallback(async () => {
    const [schedResult, itemsResult] = await Promise.all([
      supabase
        .from("schedules")
        .select("*, accounts(name, account_number)")
        .eq("id", scheduleId)
        .single(),
      supabase
        .from("schedule_line_items")
        .select("*")
        .eq("schedule_id", scheduleId)
        .order("row_order"),
    ]);

    setSchedule(schedResult.data as unknown as ScheduleData);
    setLineItems(
      ((itemsResult.data as LineItem[]) ?? []).map((item) => ({
        ...item,
        cell_data: (item.cell_data as Record<string, string | number>) ?? {},
      }))
    );
    setLoading(false);
  }, [supabase, scheduleId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  function handleCellChange(
    rowIndex: number,
    colKey: string,
    value: string
  ) {
    setSaveStatus("unsaved");
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== rowIndex) return item;
        const newCellData = { ...item.cell_data, [colKey]: value };
        // If this is a currency/number column, update the amount field
        const col = schedule?.column_definitions.find((c) => c.key === colKey);
        let newAmount = item.amount;
        if (col && (col.type === "currency" || col.type === "number")) {
          // Use the last currency column's value as the primary amount
          const currencyCols = schedule!.column_definitions.filter(
            (c) => c.type === "currency"
          );
          const lastCurrencyCol = currencyCols[currencyCols.length - 1];
          if (lastCurrencyCol && lastCurrencyCol.key === colKey) {
            newAmount = parseFloat(value) || 0;
          }
        }
        return { ...item, cell_data: newCellData, amount: newAmount };
      })
    );
  }

  function addRow() {
    setSaveStatus("unsaved");
    const newRow: LineItem = {
      row_order: lineItems.length,
      is_header: false,
      is_total: false,
      cell_data: {},
      amount: 0,
    };
    setLineItems((prev) => [...prev, newRow]);
  }

  function removeRow(index: number) {
    setSaveStatus("unsaved");
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("saving");

    // Delete existing line items and re-insert
    await supabase
      .from("schedule_line_items")
      .delete()
      .eq("schedule_id", scheduleId);

    if (lineItems.length > 0) {
      const itemsToInsert = lineItems.map((item, i) => ({
        schedule_id: scheduleId,
        row_order: i,
        is_header: item.is_header,
        is_total: item.is_total,
        cell_data: item.cell_data,
        amount: item.amount,
      }));

      const { error } = await supabase
        .from("schedule_line_items")
        .insert(itemsToInsert);

      if (error) {
        toast.error(error.message);
        setSaving(false);
        setSaveStatus("unsaved");
        return;
      }
    }

    // Update schedule total
    const total = lineItems
      .filter((item) => !item.is_header && !item.is_total)
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    const variance =
      schedule?.gl_balance !== null && schedule?.gl_balance !== undefined
        ? total - schedule.gl_balance
        : null;

    await supabase
      .from("schedules")
      .update({ total_amount: total, variance })
      .eq("id", scheduleId);

    setSchedule((prev) =>
      prev ? { ...prev, total_amount: total, variance } : null
    );

    toast.success("Schedule saved");
    setSaving(false);
    setSaveStatus("saved");
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!schedule)
    return <p className="text-muted-foreground">Schedule not found</p>;

  const isLocked = schedule.status === "finalized";
  const total = lineItems
    .filter((item) => !item.is_header && !item.is_total)
    .reduce((sum, item) => sum + (item.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/schedules`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {schedule.name}
          </h1>
          {schedule.accounts && (
            <p className="text-muted-foreground">
              {schedule.accounts.account_number} - {schedule.accounts.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "unsaved"
              ? "Unsaved changes"
              : "Saved"}
          </span>
          {isLocked ? (
            <Badge>
              <Lock className="mr-1 h-3 w-3" />
              Finalized
            </Badge>
          ) : (
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      {/* Tie-Out Bar */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40">
        <div>
          <span className="text-sm text-muted-foreground">Schedule Total</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(total)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">GL Balance</span>
          <p className="text-lg font-semibold tabular-nums">
            {schedule.gl_balance !== null
              ? formatCurrency(schedule.gl_balance)
              : "---"}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Variance</span>
          <p
            className={`text-lg font-semibold tabular-nums flex items-center gap-1 ${
              schedule.gl_balance !== null
                ? Math.abs(total - schedule.gl_balance) < 0.01
                  ? "text-green-600"
                  : "text-red-600"
                : ""
            }`}
          >
            {schedule.gl_balance !== null ? (
              <>
                {formatCurrency(total - schedule.gl_balance)}
                {Math.abs(total - schedule.gl_balance) < 0.01 ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
              </>
            ) : (
              "---"
            )}
          </p>
        </div>
      </div>

      {/* Schedule Grid */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Line Items</CardTitle>
            {!isLocked && (
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                Add Row
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  {schedule.column_definitions.map((col) => (
                    <TableHead
                      key={col.key}
                      style={{ minWidth: col.width }}
                      className={
                        col.type === "currency" || col.type === "number"
                          ? "text-right"
                          : ""
                      }
                    >
                      {col.name}
                    </TableHead>
                  ))}
                  {!isLocked && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={
                        schedule.column_definitions.length + 2
                      }
                      className="text-center text-muted-foreground py-8"
                    >
                      No line items yet. Click &quot;Add Row&quot; to start.
                    </TableCell>
                  </TableRow>
                ) : (
                  lineItems.map((item, rowIndex) => (
                    <TableRow key={rowIndex}>
                      <TableCell className="text-muted-foreground text-xs">
                        {rowIndex + 1}
                      </TableCell>
                      {schedule.column_definitions.map((col) => (
                        <TableCell key={col.key} className="p-1">
                          <Input
                            value={
                              (item.cell_data[col.key] as string) ?? ""
                            }
                            onChange={(e) =>
                              handleCellChange(
                                rowIndex,
                                col.key,
                                e.target.value
                              )
                            }
                            disabled={isLocked}
                            className={`h-8 ${
                              col.type === "currency" ||
                              col.type === "number"
                                ? "text-right tabular-nums"
                                : ""
                            }`}
                            type={
                              col.type === "currency" ||
                              col.type === "number"
                                ? "number"
                                : col.type === "date"
                                ? "date"
                                : "text"
                            }
                            step={
                              col.type === "currency" ? "0.01" : undefined
                            }
                          />
                        </TableCell>
                      ))}
                      {!isLocked && (
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRow(rowIndex)}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
                {/* Total Row */}
                {lineItems.length > 0 && (
                  <TableRow className="font-semibold bg-muted/40">
                    <TableCell></TableCell>
                    <TableCell>Total</TableCell>
                    {schedule.column_definitions.slice(1).map((col) => (
                      <TableCell
                        key={col.key}
                        className={
                          col.type === "currency" || col.type === "number"
                            ? "text-right tabular-nums"
                            : ""
                        }
                      >
                        {col.type === "currency" || col.type === "number"
                          ? formatCurrency(
                              lineItems.reduce(
                                (sum, item) =>
                                  sum +
                                  (parseFloat(
                                    item.cell_data[col.key] as string
                                  ) || 0),
                                0
                              )
                            )
                          : ""}
                      </TableCell>
                    ))}
                    {!isLocked && <TableCell></TableCell>}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
