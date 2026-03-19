import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// POST /api/close/materiality-override
// Waive a task variance as immaterial
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { taskId, thresholdId, varianceAmount, justification } = body;

  if (!taskId || !justification) {
    return NextResponse.json(
      { error: "taskId and justification are required" },
      { status: 400 }
    );
  }

  // Create the override record
  const { error: overrideError } = await supabase
    .from("materiality_overrides")
    .insert({
      close_task_id: taskId,
      threshold_id: thresholdId || null,
      variance_amount: varianceAmount ?? null,
      justification,
      waived_by: user.id,
    });

  if (overrideError) {
    return NextResponse.json({ error: overrideError.message }, { status: 400 });
  }

  // Mark the task as immaterial
  const { error: taskError } = await supabase
    .from("close_tasks")
    .update({
      is_immaterial: true,
      immaterial_reason: justification,
    })
    .eq("id", taskId);

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
