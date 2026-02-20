import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get year param (default current year)
  const url = new URL(request.url);
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));

  // Get user's organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  // Get all active entities
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .order("name");

  if (!entities || entities.length === 0) {
    return NextResponse.json({ entities: [], variances: [] });
  }

  // For each entity, get GL balances grouped by period
  // We query all gl_balances for the year and compute debits - credits per period
  const entityIds = entities.map((e) => e.id);

  const { data: balances, error } = await supabase
    .from("gl_balances")
    .select("entity_id, period_year, period_month, debit_total, credit_total")
    .in("entity_id", entityIds)
    .eq("period_year", year);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate: sum debits and credits per entity per month
  const aggregated: Record<
    string,
    Record<number, { totalDebits: number; totalCredits: number; accountCount: number }>
  > = {};

  for (const row of balances ?? []) {
    const key = row.entity_id;
    if (!aggregated[key]) aggregated[key] = {};
    if (!aggregated[key][row.period_month]) {
      aggregated[key][row.period_month] = { totalDebits: 0, totalCredits: 0, accountCount: 0 };
    }

    aggregated[key][row.period_month].totalDebits += Number(row.debit_total ?? 0);
    aggregated[key][row.period_month].totalCredits += Number(row.credit_total ?? 0);
    aggregated[key][row.period_month].accountCount += 1;
  }

  // Build variance records
  interface VarianceRecord {
    entityId: string;
    entityName: string;
    entityCode: string;
    periodYear: number;
    periodMonth: number;
    totalDebits: number;
    totalCredits: number;
    variance: number;
    accountCount: number;
    isBalanced: boolean;
  }

  const variances: VarianceRecord[] = [];

  for (const entity of entities) {
    const entityData = aggregated[entity.id];
    if (!entityData) continue;

    for (let month = 1; month <= 12; month++) {
      const monthData = entityData[month];
      if (!monthData) continue;

      const variance = Math.round((monthData.totalDebits - monthData.totalCredits) * 100) / 100;
      const isBalanced = Math.abs(variance) < 0.01;

      variances.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        periodYear: year,
        periodMonth: month,
        totalDebits: Math.round(monthData.totalDebits * 100) / 100,
        totalCredits: Math.round(monthData.totalCredits * 100) / 100,
        variance,
        accountCount: monthData.accountCount,
        isBalanced,
      });
    }
  }

  // Sort: unbalanced first, then by entity and month
  variances.sort((a, b) => {
    if (a.isBalanced !== b.isBalanced) return a.isBalanced ? 1 : -1;
    if (a.entityName !== b.entityName) return a.entityName.localeCompare(b.entityName);
    return a.periodMonth - b.periodMonth;
  });

  const unbalancedCount = variances.filter((v) => !v.isBalanced).length;

  return NextResponse.json({
    year,
    entities: entities.map((e) => ({ id: e.id, name: e.name, code: e.code })),
    variances,
    summary: {
      totalPeriods: variances.length,
      balanced: variances.length - unbalancedCount,
      unbalanced: unbalancedCount,
    },
  });
}
