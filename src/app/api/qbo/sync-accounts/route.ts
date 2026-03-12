import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/qbo/sync-accounts
 *
 * Sync chart of accounts (GL accounts) for ALL entities with active QBO connections.
 * Returns which entities had new accounts added so the caller can decide whether
 * to re-sync existing trial balance months.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // Get user's organization
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

  // Get all active entities
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

  // Get all QBO connections
  const entityIds = entities.map((e) => e.id);
  const { data: connections } = await adminClient
    .from("qbo_connections")
    .select(
      "id, entity_id, access_token, refresh_token, access_token_expires_at, realm_id, company_name"
    )
    .in("entity_id", entityIds);

  if (!connections || connections.length === 0) {
    return NextResponse.json(
      { error: "No QuickBooks connections found for any entity" },
      { status: 404 }
    );
  }

  const connByEntity = new Map(connections.map((c) => [c.entity_id, c]));
  const apiBaseUrl = "https://quickbooks.api.intuit.com";

  const results: {
    entityId: string;
    entityName: string;
    entityCode: string;
    success: boolean;
    accountsBefore: number;
    accountsAfter: number;
    newAccounts: { name: string; accountNumber: string | null; classification: string; accountType: string }[];
    syncedMonths: number[];
    error?: string;
  }[] = [];

  // Process each entity sequentially to avoid token refresh race conditions
  for (const entity of entities) {
    const conn = connByEntity.get(entity.id);
    if (!conn) {
      results.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        success: false,
        accountsBefore: 0,
        accountsAfter: 0,
        newAccounts: [],
        syncedMonths: [],
        error: "No QBO connection",
      });
      continue;
    }

    try {
      // Refresh token if needed
      const accessToken = await refreshTokenIfNeeded(conn, adminClient);

      // Get existing account qbo_ids for this entity BEFORE sync
      const { data: existingAccounts } = await adminClient
        .from("accounts")
        .select("qbo_id")
        .eq("entity_id", entity.id);

      const existingQboIds = new Set(
        (existingAccounts ?? []).map((a) => a.qbo_id)
      );
      const accountsBefore = existingQboIds.size;

      // Fetch chart of accounts from QBO (paginated)
      const PAGE_SIZE = 1000;
      let startPosition = 1;
      let hasMore = true;
      const newAccounts: {
        name: string;
        accountNumber: string | null;
        classification: string;
        accountType: string;
      }[] = [];

      while (hasMore) {
        const accountsResponse = await fetch(
          `${apiBaseUrl}/v3/company/${conn.realm_id}/query?query=${encodeURIComponent(
            `SELECT * FROM Account STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
          )}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }
        );

        if (!accountsResponse.ok) {
          throw new Error(
            `Failed to fetch accounts (HTTP ${accountsResponse.status})`
          );
        }

        const accountsData = await accountsResponse.json();
        const qboAccounts = accountsData.QueryResponse?.Account ?? [];

        for (const qboAccount of qboAccounts) {
          const qboId = String(qboAccount.Id);
          const isNew = !existingQboIds.has(qboId);

          await adminClient.from("accounts").upsert(
            {
              entity_id: entity.id,
              qbo_id: qboId,
              account_number: qboAccount.AcctNum ?? null,
              name: qboAccount.Name,
              fully_qualified_name: qboAccount.FullyQualifiedName ?? null,
              classification: qboAccount.Classification,
              account_type: qboAccount.AccountType,
              account_sub_type: qboAccount.AccountSubType ?? null,
              is_active: qboAccount.Active,
              currency: qboAccount.CurrencyRef?.value ?? "USD",
              current_balance: qboAccount.CurrentBalance ?? 0,
            },
            { onConflict: "entity_id,qbo_id" }
          );

          if (isNew) {
            newAccounts.push({
              name: qboAccount.Name,
              accountNumber: qboAccount.AcctNum ?? null,
              classification: qboAccount.Classification,
              accountType: qboAccount.AccountType,
            });
          }
        }

        if (qboAccounts.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          startPosition += PAGE_SIZE;
        }
      }

      // Get total accounts after sync
      const { count: accountsAfter } = await adminClient
        .from("accounts")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", entity.id);

      // If there are new accounts, find which months have been synced
      // so the user can decide to re-sync them
      let syncedMonths: number[] = [];
      if (newAccounts.length > 0) {
        const { data: glMonths } = await adminClient
          .from("gl_balances")
          .select("period_year, period_month")
          .eq("entity_id", entity.id);

        if (glMonths) {
          // Get unique year:month combos, encoded as year*100+month for sorting
          const uniqueMonths = new Set(
            glMonths.map(
              (r) => (r.period_year as number) * 100 + (r.period_month as number)
            )
          );
          syncedMonths = Array.from(uniqueMonths).sort();
        }
      }

      results.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        success: true,
        accountsBefore,
        accountsAfter: accountsAfter ?? accountsBefore + newAccounts.length,
        newAccounts,
        syncedMonths,
      });
    } catch (err) {
      results.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        success: false,
        accountsBefore: 0,
        accountsAfter: 0,
        newAccounts: [],
        syncedMonths: [],
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const totalNewAccounts = results.reduce(
    (sum, r) => sum + r.newAccounts.length,
    0
  );
  const entitiesWithNewAccounts = results.filter(
    (r) => r.newAccounts.length > 0
  );

  return NextResponse.json({
    success: true,
    entitiesSynced: successCount,
    entitiesTotal: entities.length,
    totalNewAccounts,
    entitiesWithNewAccounts: entitiesWithNewAccounts.length,
    results,
  });
}

async function refreshTokenIfNeeded(
  connection: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    realm_id: string;
  },
  adminClient: ReturnType<typeof createAdminClient>
) {
  const expiresAt = new Date(connection.access_token_expires_at);
  const now = new Date();
  const fiveMinBuffer = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > fiveMinBuffer) {
    return connection.access_token;
  }

  const clientId = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Token refresh failed");
  }

  const tokens = await response.json();
  const newExpiry = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  await adminClient
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: newExpiry,
    })
    .eq("id", connection.id);

  return tokens.access_token as string;
}
