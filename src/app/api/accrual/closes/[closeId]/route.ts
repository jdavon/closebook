import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/accrual/closes/[closeId] — fetch close period + its lines
export async function GET(
  request: Request,
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

    if (periodErr) {
      return NextResponse.json({ error: periodErr.message }, { status: 500 });
    }
    if (!period) {
      return NextResponse.json({ error: "Close not found" }, { status: 404 });
    }

    const { data: lines, error: linesErr } = await admin
      .from("accrual_close_lines")
      .select("*")
      .eq("close_period_id", closeId)
      .order("line_type", { ascending: true })
      .order("net_amount", { ascending: false });

    if (linesErr) {
      return NextResponse.json({ error: linesErr.message }, { status: 500 });
    }

    return NextResponse.json({ period, lines: lines ?? [] });
  } catch (err) {
    console.error("GET /api/accrual/closes/[closeId] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
