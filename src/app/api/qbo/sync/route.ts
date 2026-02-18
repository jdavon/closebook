import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Token expired or expiring soon - refresh
  const clientId = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, syncType = "full", periodYear, periodMonth } = await request.json();

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  // Use specified period or default to current month
  const now = new Date();
  const targetYear = periodYear ?? now.getFullYear();
  const targetMonth = periodMonth ?? now.getMonth() + 1; // 1-indexed

  const adminClient = createAdminClient();

  // Get connection
  const { data: connection, error: connError } = await adminClient
    .from("qbo_connections")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (connError || !connection) {
    return NextResponse.json(
      { error: "No QuickBooks connection found" },
      { status: 404 }
    );
  }

  // Create sync log
  const { data: syncLog } = await adminClient
    .from("qbo_sync_logs")
    .insert({
      qbo_connection_id: connection.id,
      sync_type: syncType,
      status: "started",
    })
    .select()
    .single();

  // Update connection status
  await adminClient
    .from("qbo_connections")
    .update({ sync_status: "syncing" })
    .eq("id", connection.id);

  try {
    const accessToken = await refreshTokenIfNeeded(connection, adminClient);

    // Always use production API URL — sandbox URL only works with Intuit's
    // test companies. Development keys can access real companies via the
    // production API URL.
    const apiBaseUrl = "https://quickbooks.api.intuit.com";

    let recordsSynced = 0;

    // Sync accounts
    const accountsResponse = await fetch(
      `${apiBaseUrl}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(
        "SELECT * FROM Account MAXRESULTS 1000"
      )}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (accountsResponse.ok) {
      const accountsData = await accountsResponse.json();
      const qboAccounts =
        accountsData.QueryResponse?.Account ?? [];

      for (const qboAccount of qboAccounts) {
        await adminClient.from("accounts").upsert(
          {
            entity_id: entityId,
            qbo_id: String(qboAccount.Id),
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
        recordsSynced++;
      }
    }

    // Sync trial balance for specified period (or current month)
    const periodStart = new Date(targetYear, targetMonth - 1, 1);
    const periodEnd = new Date(targetYear, targetMonth, 0); // last day of month

    const startDate = periodStart.toISOString().split("T")[0];
    const endDate = periodEnd.toISOString().split("T")[0];

    const tbResponse = await fetch(
      `${apiBaseUrl}/v3/company/${connection.realm_id}/reports/TrialBalance?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (tbResponse.ok) {
      const tbData = await tbResponse.json();

      // Store the raw trial balance
      await adminClient.from("trial_balances").upsert(
        {
          entity_id: entityId,
          period_year: targetYear,
          period_month: targetMonth,
          report_data: tbData,
          synced_at: new Date().toISOString(),
        },
        {
          onConflict: "entity_id,period_year,period_month,status",
        }
      );

      // Parse trial balance rows into gl_balances
      const rows = tbData?.Rows?.Row ?? [];
      for (const row of rows) {
        if (row.ColData && row.ColData.length >= 3) {
          const accountName = row.ColData[0]?.value;
          const debit = parseFloat(row.ColData[1]?.value) || 0;
          const credit = parseFloat(row.ColData[2]?.value) || 0;

          // Find matching account
          const { data: account } = await adminClient
            .from("accounts")
            .select("id")
            .eq("entity_id", entityId)
            .eq("name", accountName)
            .single();

          if (account) {
            await adminClient.from("gl_balances").upsert(
              {
                entity_id: entityId,
                account_id: account.id,
                period_year: targetYear,
                period_month: targetMonth,
                debit_total: debit,
                credit_total: credit,
                ending_balance: debit - credit,
                net_change: debit - credit,
                synced_at: new Date().toISOString(),
              },
              {
                onConflict:
                  "entity_id,account_id,period_year,period_month",
              }
            );
            recordsSynced++;
          }
        }
      }
    }

    // Update sync status
    await adminClient
      .from("qbo_connections")
      .update({
        sync_status: "idle",
        last_sync_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("id", connection.id);

    if (syncLog) {
      await adminClient
        .from("qbo_sync_logs")
        .update({
          status: "completed",
          records_synced: recordsSynced,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLog.id);
    }

    return NextResponse.json({
      success: true,
      recordsSynced,
      periodYear: targetYear,
      periodMonth: targetMonth,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";

    await adminClient
      .from("qbo_connections")
      .update({
        sync_status: "error",
        sync_error: errorMessage,
      })
      .eq("id", connection.id);

    if (syncLog) {
      await adminClient
        .from("qbo_sync_logs")
        .update({
          status: "failed",
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLog.id);
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
