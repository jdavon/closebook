import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computePhaseProgress } from "@/lib/utils/close-management";

// ---------------------------------------------------------------------------
// GET /api/close/phase-status?closePeriodId=
// Returns phase completion summary and blocking state
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const closePeriodId = url.searchParams.get("closePeriodId");

  if (!closePeriodId) {
    return NextResponse.json(
      { error: "closePeriodId is required" },
      { status: 400 }
    );
  }

  const { data: tasks } = await supabase
    .from("close_tasks")
    .select("phase, status")
    .eq("close_period_id", closePeriodId);

  if (!tasks) {
    return NextResponse.json({ phases: [] });
  }

  const phases = computePhaseProgress(tasks);

  return NextResponse.json({ phases });
}
