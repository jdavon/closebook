import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");

  // Get user's organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  // Get entities for validation
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true);

  if (!entities || entities.length === 0) {
    return NextResponse.json({ unmatchedRows: [], summary: { total: 0, unresolved: 0, resolved: 0 } });
  }

  const entityIds = entities.map((e) => e.id);
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Validate entityId belongs to org if provided
  if (entityId && !entityIds.includes(entityId)) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  // Build query with pagination to avoid PostgREST row-limit truncation
  const rows = await fetchAllPaginated<any>((offset, limit) => {
    let query = supabase
      .from("tb_unmatched_rows")
      .select("id, entity_id, period_year, period_month, qbo_account_name, qbo_account_id, debit, credit, resolved_account_id, resolved_at, resolved_by, created_at")
      .order("period_month", { ascending: true })
      .order("qbo_account_name", { ascending: true });

    if (entityId) {
      query = query.eq("entity_id", entityId);
    } else {
      query = query.in("entity_id", entityIds);
    }

    if (year) {
      query = query.eq("period_year", parseInt(year));
    }

    if (month) {
      query = query.eq("period_month", parseInt(month));
    }

    return query.range(offset, offset + limit - 1);
  });

  const unmatchedRows = rows.map((row) => {
    const entity = entityMap.get(row.entity_id);
    return {
      id: row.id,
      entityId: row.entity_id,
      entityName: entity?.name ?? "Unknown",
      entityCode: entity?.code ?? "???",
      periodYear: row.period_year,
      periodMonth: row.period_month,
      qboAccountName: row.qbo_account_name,
      qboAccountId: row.qbo_account_id,
      debit: Number(row.debit ?? 0),
      credit: Number(row.credit ?? 0),
      resolvedAccountId: row.resolved_account_id,
      resolvedAt: row.resolved_at,
    };
  });

  const unresolved = unmatchedRows.filter((r) => !r.resolvedAccountId).length;

  return NextResponse.json({
    unmatchedRows,
    summary: {
      total: unmatchedRows.length,
      unresolved,
      resolved: unmatchedRows.length - unresolved,
    },
  });
}
