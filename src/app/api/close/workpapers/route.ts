import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET /api/close/workpapers?taskId=
// POST /api/close/workpapers
// PUT /api/close/workpapers
// DELETE /api/close/workpapers?id=
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
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId is required" },
      { status: 400 }
    );
  }

  const { data: workpaper } = await supabase
    .from("reconciliation_workpapers")
    .select("*")
    .eq("close_task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ workpaper: workpaper ?? null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { closeTaskId, templateId, fieldValues, glBalance, subBalance, variance, notes } = body;

  if (!closeTaskId || !templateId) {
    return NextResponse.json(
      { error: "closeTaskId and templateId are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("reconciliation_workpapers")
    .insert({
      close_task_id: closeTaskId,
      template_id: templateId,
      submitted_by: user.id,
      workpaper_data: fieldValues ?? {},
      gl_balance: glBalance ?? null,
      subledger_balance: subBalance ?? null,
      variance: variance ?? null,
      notes: notes || null,
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ workpaper: data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (updates.fieldValues !== undefined) updateData.workpaper_data = updates.fieldValues;
  if (updates.glBalance !== undefined) updateData.gl_balance = updates.glBalance;
  if (updates.subBalance !== undefined) updateData.subledger_balance = updates.subBalance;
  if (updates.variance !== undefined) updateData.variance = updates.variance;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.status === "submitted") {
    updateData.submitted_at = new Date().toISOString();
  }
  if (updates.status === "reviewed") {
    updateData.reviewed_by = user.id;
    updateData.reviewed_at = new Date().toISOString();
  }
  if (updates.status === "approved") {
    updateData.reviewed_by = user.id;
    updateData.reviewed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("reconciliation_workpapers")
    .update(updateData)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("reconciliation_workpapers")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
