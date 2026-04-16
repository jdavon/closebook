import { createClient } from "@/lib/supabase/server";

export interface OrgSummary {
  entityCount: number;
  currentPeriod: { year: number; month: number } | null;
  closeStatus: {
    closed: number;
    inProgress: number;
    open: number;
    total: number;
  };
}

export async function getOrgSummary(): Promise<OrgSummary> {
  const supabase = await createClient();

  const { data: entities } = await supabase
    .from("entities")
    .select("id")
    .eq("is_active", true);

  const entityIds = entities?.map((e) => e.id) ?? [];

  if (entityIds.length === 0) {
    return {
      entityCount: 0,
      currentPeriod: null,
      closeStatus: { closed: 0, inProgress: 0, open: 0, total: 0 },
    };
  }

  const { data: periods } = await supabase
    .from("close_periods")
    .select("entity_id, status, period_year, period_month")
    .in("entity_id", entityIds)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  const latestByEntity = new Map<
    string,
    { status: string; year: number; month: number }
  >();
  for (const p of periods ?? []) {
    if (!latestByEntity.has(p.entity_id)) {
      latestByEntity.set(p.entity_id, {
        status: p.status,
        year: p.period_year,
        month: p.period_month,
      });
    }
  }

  let closed = 0;
  let inProgress = 0;
  let open = 0;
  let latestYear = 0;
  let latestMonth = 0;

  for (const entityId of entityIds) {
    const p = latestByEntity.get(entityId);
    if (!p) {
      open += 1;
      continue;
    }
    if (p.year > latestYear || (p.year === latestYear && p.month > latestMonth)) {
      latestYear = p.year;
      latestMonth = p.month;
    }
    if (p.status === "closed" || p.status === "locked" || p.status === "soft_closed") {
      closed += 1;
    } else if (p.status === "in_progress" || p.status === "review") {
      inProgress += 1;
    } else {
      open += 1;
    }
  }

  return {
    entityCount: entityIds.length,
    currentPeriod:
      latestYear > 0 ? { year: latestYear, month: latestMonth } : null,
    closeStatus: {
      closed,
      inProgress,
      open,
      total: entityIds.length,
    },
  };
}
