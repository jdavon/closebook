import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllMappings, fetchAllAccounts } from "@/lib/utils/paginated-fetch";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const year = searchParams.get("year");

  if (!organizationId || !year) {
    return NextResponse.json(
      { error: "organizationId and year are required" },
      { status: 400 }
    );
  }

  const periodYear = parseInt(year);

  // Verify user has access to this organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const adminClient = createAdminClient();

  // Get all entities for this organization
  const { data: entities } = await adminClient
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(5000);

  if (!entities || entities.length === 0) {
    return NextResponse.json({ unmappedAccounts: [] });
  }

  const entityIds = entities.map((e) => e.id);
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Get all master accounts for the org to find mappings
  const { data: masterAccounts } = await adminClient
    .from("master_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(5000);

  const masterAccountIds = (masterAccounts ?? []).map((ma) => ma.id);

  // Get all mapped account IDs (paginated to avoid PostgREST max_rows truncation)
  let mappedAccountIds = new Set<string>();
  if (masterAccountIds.length > 0) {
    const mappings = await fetchAllMappings(
      adminClient,
      masterAccountIds,
      "account_id, master_account_id, entity_id"
    );
    mappedAccountIds = new Set(mappings.map((m) => m.account_id));
  }

  // Get all active entity accounts (paginated)
  const allAccounts = await fetchAllAccounts(
    adminClient,
    entityIds,
    "id, entity_id, name, account_number, classification, account_type"
  );

  // Filter to unmapped accounts
  const unmapped = (allAccounts ?? []).filter(
    (a) => !mappedAccountIds.has(a.id)
  );

  if (unmapped.length === 0) {
    return NextResponse.json({ unmappedAccounts: [] });
  }

  // Fetch GL balances for all unmapped accounts for the given year (all 12 months)
  const unmappedIds = unmapped.map((a) => a.id);

  // Batch in chunks to avoid URL length issues
  const CHUNK_SIZE = 500;
  const allBalances: Array<{
    account_id: string;
    period_month: number;
    ending_balance: number;
  }> = [];

  for (let i = 0; i < unmappedIds.length; i += CHUNK_SIZE) {
    const chunk = unmappedIds.slice(i, i + CHUNK_SIZE);
    const { data: balances } = await adminClient
      .from("gl_balances")
      .select("account_id, period_month, ending_balance")
      .in("account_id", chunk)
      .eq("period_year", periodYear)
      .limit(10000);

    for (const b of balances ?? []) {
      allBalances.push({
        account_id: b.account_id,
        period_month: b.period_month,
        ending_balance: Number(b.ending_balance),
      });
    }
  }

  // Index balances by account_id → month → ending_balance
  const balanceMap = new Map<string, Record<number, number>>();
  for (const b of allBalances) {
    let monthMap = balanceMap.get(b.account_id);
    if (!monthMap) {
      monthMap = {};
      balanceMap.set(b.account_id, monthMap);
    }
    monthMap[b.period_month] = b.ending_balance;
  }

  // Build response
  const unmappedAccounts = unmapped.map((a) => {
    const entity = entityMap.get(a.entity_id);
    const monthlyBalances = balanceMap.get(a.id) ?? {};

    return {
      id: a.id,
      entityId: a.entity_id,
      entityName: entity?.name ?? "Unknown",
      entityCode: entity?.code ?? "???",
      name: a.name,
      accountNumber: a.account_number,
      classification: a.classification,
      monthlyBalances,
    };
  });

  return NextResponse.json({ unmappedAccounts });
}
