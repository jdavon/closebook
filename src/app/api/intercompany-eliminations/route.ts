import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllMappings } from "@/lib/utils/paginated-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  ending_balance: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGLBalance(row: any): RawGLBalance {
  return {
    account_id: row.account_id,
    entity_id: row.entity_id,
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    ending_balance: Number(row.ending_balance),
  };
}

// ---------------------------------------------------------------------------
// Paginated GL balance fetcher
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

async function fetchGLBalancesForAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  accountIds: string[],
  entityIds: string[],
  year: number,
  month: number
): Promise<RawGLBalance[]> {
  if (accountIds.length === 0 || entityIds.length === 0) return [];

  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin
      .from("gl_balances")
      .select("account_id, entity_id, period_year, period_month, ending_balance")
      .in("account_id", accountIds)
      .in("entity_id", entityIds)
      .eq("period_year", year)
      .eq("period_month", month)
      .range(offset, offset + GL_PAGE_SIZE - 1);

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(parseGLBalance);
    allRows.push(...rows);

    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Counterparty name extraction
// ---------------------------------------------------------------------------

function extractCounterparty(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("due from ")) return name.slice(9);
  if (lower.startsWith("due to ")) return name.slice(7);
  return name;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const organizationId = searchParams.get("organizationId");
  const endYear = parseInt(searchParams.get("endYear") ?? "0");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "0");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  if (!endYear || !endMonth) {
    return NextResponse.json(
      { error: "endYear and endMonth are required" },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get org info
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  // Get all entities
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  const entities = orgEntities ?? [];

  if (entities.length === 0) {
    return NextResponse.json({
      pairs: [],
      entities: [],
      unmatchedDueTo: [],
      unmatchedDueFrom: [],
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        periodLabel: `${endMonth}/${endYear}`,
      },
    });
  }

  // Fetch Due From and Due To master accounts by name pattern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dueAccounts } = await (admin as any)
    .from("master_accounts")
    .select("id, account_number, name, classification, is_intercompany")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .or("name.ilike.Due from%,name.ilike.Due to%")
    .order("account_number");

  if (!dueAccounts || dueAccounts.length === 0) {
    return NextResponse.json({
      pairs: [],
      entities: entities.map((e) => ({ id: e.id, code: e.code, name: e.name })),
      unmatchedDueTo: [],
      unmatchedDueFrom: [],
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        periodLabel: `${endMonth}/${endYear}`,
      },
    });
  }

  // Separate into Due From and Due To groups
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dueFromAccounts = dueAccounts.filter((a: any) =>
    a.name.toLowerCase().startsWith("due from")
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dueToAccounts = dueAccounts.filter((a: any) =>
    a.name.toLowerCase().startsWith("due to")
  );

  // Get mappings for all Due From / Due To master accounts
  const allICMasterIds = dueAccounts.map((a: { id: string }) => a.id);
  const mappings = await fetchAllMappings(admin, allICMasterIds);

  // Build mapping: master_account_id -> list of { entity_id, account_id }
  const masterToMappings = new Map<
    string,
    Array<{ entity_id: string; account_id: string }>
  >();
  const allMappedAccountIds = new Set<string>();
  for (const m of mappings ?? []) {
    const list = masterToMappings.get(m.master_account_id) ?? [];
    list.push({ entity_id: m.entity_id, account_id: m.account_id });
    masterToMappings.set(m.master_account_id, list);
    allMappedAccountIds.add(m.account_id);
  }

  // Fetch GL balances for mapped entity accounts at the target period
  const entityIds = entities.map((e) => e.id);
  const glBalances = await fetchGLBalancesForAccounts(
    admin,
    [...allMappedAccountIds],
    entityIds,
    endYear,
    endMonth
  );

  // Index GL balances by (account_id, entity_id)
  const glIndex = new Map<string, number>();
  for (const gl of glBalances) {
    const key = `${gl.account_id}::${gl.entity_id}`;
    glIndex.set(key, (glIndex.get(key) ?? 0) + gl.ending_balance);
  }

  // Aggregate ending_balance per master account per entity
  function aggregateForMaster(masterAccountId: string): Record<string, number> {
    const result: Record<string, number> = {};
    const acctMappings = masterToMappings.get(masterAccountId) ?? [];
    for (const m of acctMappings) {
      const key = `${m.account_id}::${m.entity_id}`;
      const balance = glIndex.get(key) ?? 0;
      if (balance !== 0) {
        result[m.entity_id] = (result[m.entity_id] ?? 0) + balance;
      }
    }
    return result;
  }

  // Build pairs by matching Due From ↔ Due To on counterparty name
  const matchedDueToIds = new Set<string>();
  const matchedDueFromIds = new Set<string>();

  interface AccountInfo {
    id: string;
    account_number: string;
    name: string;
  }

  const pairs: Array<{
    counterpartyName: string;
    dueFromAccount: { id: string; accountNumber: string; name: string };
    dueToAccount: { id: string; accountNumber: string; name: string } | null;
    dueFromByEntity: Record<string, number>;
    dueToByEntity: Record<string, number>;
    dueFromTotal: number;
    dueToTotal: number;
    variance: number;
  }> = [];

  for (const df of dueFromAccounts as AccountInfo[]) {
    const counterparty = extractCounterparty(df.name);

    // Find matching Due To by counterparty name
    const matchingDt = (dueToAccounts as AccountInfo[]).find(
      (dt) =>
        extractCounterparty(dt.name).toLowerCase() ===
        counterparty.toLowerCase()
    );

    if (matchingDt) {
      matchedDueToIds.add(matchingDt.id);
      matchedDueFromIds.add(df.id);
    }

    // Aggregate balances
    const dueFromByEntity = aggregateForMaster(df.id);

    // Due To balances: sign-flip because liability ending_balance is stored
    // as positive (credit balance), but for the elimination grid we want to
    // show the payable amount as positive so it can be compared directly to
    // the receivable (Due From) amount.
    const rawDueTo = matchingDt ? aggregateForMaster(matchingDt.id) : {};
    const dueToByEntity: Record<string, number> = {};
    for (const [entityId, val] of Object.entries(rawDueTo)) {
      dueToByEntity[entityId] = val;
    }

    const dueFromTotal = Object.values(dueFromByEntity).reduce(
      (s, v) => s + v,
      0
    );
    const dueToTotal = Object.values(dueToByEntity).reduce(
      (s, v) => s + v,
      0
    );

    pairs.push({
      counterpartyName: counterparty,
      dueFromAccount: {
        id: df.id,
        accountNumber: df.account_number,
        name: df.name,
      },
      dueToAccount: matchingDt
        ? {
            id: matchingDt.id,
            accountNumber: matchingDt.account_number,
            name: matchingDt.name,
          }
        : null,
      dueFromByEntity,
      dueToByEntity,
      dueFromTotal,
      dueToTotal,
      variance: dueFromTotal - dueToTotal,
    });
  }

  // Unmatched Due To accounts (no corresponding Due From)
  const unmatchedDueTo = (dueToAccounts as AccountInfo[])
    .filter((dt) => !matchedDueToIds.has(dt.id))
    .map((dt) => {
      const totalByEntity = aggregateForMaster(dt.id);
      return {
        id: dt.id,
        accountNumber: dt.account_number,
        name: dt.name,
        totalByEntity,
        total: Object.values(totalByEntity).reduce((s, v) => s + v, 0),
      };
    });

  // Unmatched Due From accounts (no corresponding Due To)
  const unmatchedDueFrom = (dueFromAccounts as AccountInfo[])
    .filter((df) => !matchedDueFromIds.has(df.id))
    .map((df) => {
      const totalByEntity = aggregateForMaster(df.id);
      return {
        id: df.id,
        accountNumber: df.account_number,
        name: df.name,
        totalByEntity,
        total: Object.values(totalByEntity).reduce((s, v) => s + v, 0),
      };
    });

  // Build month label
  const monthNames = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const periodLabel = `${monthNames[endMonth]} ${endYear}`;

  return NextResponse.json({
    pairs,
    entities: entities.map((e) => ({ id: e.id, code: e.code, name: e.name })),
    unmatchedDueTo,
    unmatchedDueFrom,
    metadata: {
      organizationName: org?.name,
      generatedAt: new Date().toISOString(),
      periodLabel,
    },
  });
}
