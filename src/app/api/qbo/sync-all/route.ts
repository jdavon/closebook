import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/qbo/sync-all
 *
 * Sync trial balance data for ALL entities (with active QBO connections)
 * for a specified period. This enables month-by-month financial data
 * across the entire organization from a single action.
 *
 * Body: { periodYear: number, periodMonth: number }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { periodYear, periodMonth } = await request.json();

  if (!periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "periodYear and periodMonth are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Get all entities the user has access to
  const { data: membershipData } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membershipData) {
    return NextResponse.json(
      { error: "No organization found" },
      { status: 404 }
    );
  }

  // Get all entities in the organization
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", membershipData.organization_id)
    .eq("is_active", true)
    .order("name");

  if (!entities || entities.length === 0) {
    return NextResponse.json(
      { error: "No entities found" },
      { status: 404 }
    );
  }

  // Get all QBO connections for these entities
  const entityIds = entities.map((e) => e.id);
  const { data: connections } = await adminClient
    .from("qbo_connections")
    .select("id, entity_id, access_token, refresh_token, access_token_expires_at, realm_id, company_name")
    .in("entity_id", entityIds);

  if (!connections || connections.length === 0) {
    return NextResponse.json(
      { error: "No QuickBooks connections found for any entity" },
      { status: 404 }
    );
  }

  // Build a map of entity_id -> connection
  const connByEntity = new Map(connections.map((c) => [c.entity_id, c]));

  const results: {
    entityId: string;
    entityName: string;
    entityCode: string;
    success: boolean;
    recordsSynced: number;
    error?: string;
  }[] = [];

  // Sync each entity sequentially (to avoid token refresh race conditions)
  for (const entity of entities) {
    const conn = connByEntity.get(entity.id);
    if (!conn) {
      results.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        success: false,
        recordsSynced: 0,
        error: "No QBO connection",
      });
      continue;
    }

    try {
      // Call the single-entity sync endpoint internally
      const origin = request.headers.get("origin") || request.headers.get("host") || "";
      const protocol = origin.startsWith("http") ? "" : "https://";
      const baseUrl = origin.startsWith("http") ? origin : `${protocol}${origin}`;

      const syncResponse = await fetch(`${baseUrl}/api/qbo/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: request.headers.get("cookie") || "",
        },
        body: JSON.stringify({
          entityId: entity.id,
          syncType: "trial_balance",
          periodYear,
          periodMonth,
        }),
      });

      const syncData = await syncResponse.json();

      if (syncResponse.ok) {
        results.push({
          entityId: entity.id,
          entityName: entity.name,
          entityCode: entity.code,
          success: true,
          recordsSynced: syncData.recordsSynced ?? 0,
        });
      } else {
        results.push({
          entityId: entity.id,
          entityName: entity.name,
          entityCode: entity.code,
          success: false,
          recordsSynced: 0,
          error: syncData.error ?? "Unknown error",
        });
      }
    } catch (err) {
      results.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        success: false,
        recordsSynced: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const totalRecords = results.reduce((sum, r) => sum + r.recordsSynced, 0);

  return NextResponse.json({
    success: true,
    entitiesSynced: successCount,
    entitiesTotal: entities.length,
    entitiesWithConnection: connections.length,
    totalRecordsSynced: totalRecords,
    periodYear,
    periodMonth,
    results,
  });
}
