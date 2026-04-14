import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/accrual/closes/[closeId]/writeoff
// Body: { lineId, notes }
// Marks a close line as written_off — the accrued amount reverses in the
// current period as a revenue reduction (no compensating invoice expected).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ closeId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { closeId } = await params;
    const body = await request.json();
    const { lineId, notes } = body as { lineId: string; notes?: string };

    if (!lineId) {
      return NextResponse.json({ error: "lineId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: line, error: fetchErr } = await admin
      .from("accrual_close_lines")
      .select("*")
      .eq("id", lineId)
      .eq("close_period_id", closeId)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    if (line.line_status !== "accrued") {
      return NextResponse.json(
        { error: `Line already resolved (${line.line_status})` },
        { status: 409 },
      );
    }

    // Variance for a write-off: -net_amount (full reversal hits current-period revenue)
    const { error: updErr } = await admin
      .from("accrual_close_lines")
      .update({
        line_status: "written_off",
        actual_invoice_subtotal: 0,
        variance_amount: -line.net_amount,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        writeoff_notes: notes ?? null,
      })
      .eq("id", lineId);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/accrual/closes/[closeId]/writeoff error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
