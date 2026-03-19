import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// GET /api/close/dashboard?periodYear=&periodMonth=
// Returns cross-entity close status for the org dashboard
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
  const periodYear = url.searchParams.get("periodYear")
    ? Number(url.searchParams.get("periodYear"))
    : null;
  const periodMonth = url.searchParams.get("periodMonth")
    ? Number(url.searchParams.get("periodMonth"))
    : null;

  // Get user's org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Get all active entities
  const { data: entities } = await admin
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .order("name");

  if (!entities || entities.length === 0) {
    return NextResponse.json({ entities: [], periods: [] });
  }

  const entityIds = entities.map((e: { id: string }) => e.id);

  // Get close periods — optionally filtered by year/month
  let periodsQuery = admin
    .from("close_periods")
    .select("*")
    .in("entity_id", entityIds)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  if (periodYear && periodMonth) {
    periodsQuery = periodsQuery
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);
  }

  const { data: periods } = await periodsQuery;

  if (!periods || periods.length === 0) {
    return NextResponse.json({
      entities: entities.map((e: { id: string; name: string; code: string }) => ({
        id: e.id,
        name: e.name,
        code: e.code,
        period: null,
      })),
      periods: [],
      availablePeriods: [],
    });
  }

  // Get all unique periods for the period selector
  const { data: allPeriods } = await admin
    .from("close_periods")
    .select("period_year, period_month")
    .in("entity_id", entityIds)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  const uniquePeriods = new Map<string, { year: number; month: number }>();
  for (const p of allPeriods ?? []) {
    const key = `${p.period_year}-${p.period_month}`;
    if (!uniquePeriods.has(key)) {
      uniquePeriods.set(key, { year: p.period_year, month: p.period_month });
    }
  }

  // Get task counts for each period
  const periodIds = periods.map((p: { id: string }) => p.id);

  const { data: tasks } = await admin
    .from("close_tasks")
    .select("close_period_id, status, phase")
    .in("close_period_id", periodIds);

  // Get gate checks for each period
  const { data: gateChecks } = await admin
    .from("close_gate_checks")
    .select("close_period_id, check_type, status, is_critical")
    .in("close_period_id", periodIds);

  // Build per-period task stats
  const periodTaskStats: Record<
    string,
    {
      total: number;
      completed: number;
      byPhase: Record<number, { total: number; completed: number }>;
    }
  > = {};

  for (const task of tasks ?? []) {
    const pid = task.close_period_id;
    if (!periodTaskStats[pid]) {
      periodTaskStats[pid] = { total: 0, completed: 0, byPhase: {} };
    }
    periodTaskStats[pid].total++;
    const isComplete = task.status === "approved" || task.status === "na";
    if (isComplete) periodTaskStats[pid].completed++;

    const phase = task.phase ?? 3;
    if (!periodTaskStats[pid].byPhase[phase]) {
      periodTaskStats[pid].byPhase[phase] = { total: 0, completed: 0 };
    }
    periodTaskStats[pid].byPhase[phase].total++;
    if (isComplete) periodTaskStats[pid].byPhase[phase].completed++;
  }

  // Build per-period gate check stats
  const periodGateStats: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      criticalFailed: number;
      checks: { checkType: string; status: string; isCritical: boolean }[];
    }
  > = {};

  for (const gc of gateChecks ?? []) {
    const pid = gc.close_period_id;
    if (!periodGateStats[pid]) {
      periodGateStats[pid] = { total: 0, passed: 0, failed: 0, criticalFailed: 0, checks: [] };
    }
    periodGateStats[pid].total++;
    if (gc.status === "passed") periodGateStats[pid].passed++;
    if (gc.status === "failed") {
      periodGateStats[pid].failed++;
      if (gc.is_critical) periodGateStats[pid].criticalFailed++;
    }
    periodGateStats[pid].checks.push({
      checkType: gc.check_type,
      status: gc.status,
      isCritical: gc.is_critical,
    });
  }

  // Build entity summaries
  const entitySummaries = entities.map(
    (entity: { id: string; name: string; code: string }) => {
      const entityPeriod = periods.find(
        (p: { entity_id: string }) => p.entity_id === entity.id
      );

      if (!entityPeriod) {
        return {
          id: entity.id,
          name: entity.name,
          code: entity.code,
          period: null,
        };
      }

      const taskStats = periodTaskStats[entityPeriod.id] ?? {
        total: 0,
        completed: 0,
        byPhase: {},
      };
      const gateStats = periodGateStats[entityPeriod.id] ?? {
        total: 0,
        passed: 0,
        failed: 0,
        criticalFailed: 0,
        checks: [],
      };

      return {
        id: entity.id,
        name: entity.name,
        code: entity.code,
        period: {
          id: entityPeriod.id,
          year: entityPeriod.period_year,
          month: entityPeriod.period_month,
          status: entityPeriod.status,
          openedAt: entityPeriod.opened_at,
          closedAt: entityPeriod.closed_at,
          tasks: taskStats,
          gateChecks: gateStats,
          completionPct:
            taskStats.total > 0
              ? Math.round((taskStats.completed / taskStats.total) * 100)
              : 0,
        },
      };
    }
  );

  return NextResponse.json({
    entities: entitySummaries,
    availablePeriods: Array.from(uniquePeriods.values()),
  });
}
