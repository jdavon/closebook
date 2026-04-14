import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRentalWorksRevenueData } from "@/lib/rentalworks/fetch-revenue-data";

export const maxDuration = 60;

// POST /api/accrual/closes/[closeId]/match
// Fetches current RW invoices and matches them against unresolved close lines.
// Updates line_status, actual_invoice_subtotal, variance_amount.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ closeId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { closeId } = await params;
    const admin = createAdminClient();

    const { data: period, error: periodErr } = await admin
      .from("accrual_close_periods")
      .select("*")
      .eq("id", closeId)
      .maybeSingle();

    if (periodErr) return NextResponse.json({ error: periodErr.message }, { status: 500 });
    if (!period) return NextResponse.json({ error: "Close not found" }, { status: 404 });

    // Fetch unresolved lines (status = 'accrued' only — written_off/invoiced are final)
    const { data: lines, error: linesErr } = await admin
      .from("accrual_close_lines")
      .select("*")
      .eq("close_period_id", closeId)
      .eq("line_status", "accrued");

    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });

    if (!lines || lines.length === 0) {
      return NextResponse.json({ matched: 0, checked: 0, period });
    }

    // Pull current RW data
    const { invoices } = await fetchRentalWorksRevenueData();

    // Index closed invoices by order number
    const CLOSED = new Set(["CLOSED", "PROCESSED"]);
    const invoicesByOrder = new Map<string, Array<{ number: string; date: string; subTotal: number }>>();
    for (const inv of invoices) {
      const status = (inv.Status || "").toUpperCase();
      if (!CLOSED.has(status)) continue;
      if (!inv.OrderNumber) continue;
      if (!invoicesByOrder.has(inv.OrderNumber)) {
        invoicesByOrder.set(inv.OrderNumber, []);
      }
      invoicesByOrder.get(inv.OrderNumber)!.push({
        number: inv.InvoiceNumber,
        date: inv.InvoiceDate,
        subTotal: Number(inv.InvoiceSubTotal) || 0,
      });
    }

    // For each unresolved line, check if we now have a matching closed invoice
    // issued ON OR AFTER the close_as_of_date (anything before was already in the snapshot).
    const closeAsOfMs = new Date(period.close_as_of_date).getTime();
    let matchedCount = 0;
    const updates: Array<{
      id: string;
      matched_invoice_number: string;
      matched_invoice_date: string;
      actual_invoice_subtotal: number;
      variance_amount: number;
      line_status: string;
      resolved_at: string;
    }> = [];

    for (const line of lines) {
      if (!line.order_number) continue;
      const matches = invoicesByOrder.get(line.order_number);
      if (!matches || matches.length === 0) continue;

      // Only match invoices dated on or after the close date (subsequent to close)
      const newMatches = matches.filter((inv) => {
        const t = new Date(inv.date).getTime();
        return !isNaN(t) && t >= closeAsOfMs;
      });
      if (newMatches.length === 0) continue;

      // Use the sum of new matches' subtotals — one order can have multiple invoices
      const actualTotal = newMatches.reduce((s, m) => s + m.subTotal, 0);
      const variance = Math.round((actualTotal - line.net_amount) * 100) / 100;

      // Pick the earliest invoice for display
      const earliest = newMatches.sort((a, b) => a.date.localeCompare(b.date))[0];

      updates.push({
        id: line.id,
        matched_invoice_number: newMatches.map((m) => m.number).join(", "),
        matched_invoice_date: earliest.date.slice(0, 10),
        actual_invoice_subtotal: Math.round(actualTotal * 100) / 100,
        variance_amount: variance,
        line_status: "invoiced",
        resolved_at: new Date().toISOString(),
      });
      matchedCount += 1;
    }

    // Batch-apply updates
    for (const upd of updates) {
      await admin
        .from("accrual_close_lines")
        .update({
          matched_invoice_number: upd.matched_invoice_number,
          matched_invoice_date: upd.matched_invoice_date,
          actual_invoice_subtotal: upd.actual_invoice_subtotal,
          variance_amount: upd.variance_amount,
          line_status: upd.line_status,
          resolved_at: upd.resolved_at,
          resolved_by: user.id,
        })
        .eq("id", upd.id);
    }

    return NextResponse.json({
      matched: matchedCount,
      checked: lines.length,
      period,
    });
  } catch (err) {
    console.error("POST /api/accrual/closes/[closeId]/match error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
