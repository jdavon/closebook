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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, syncType = "full", periodYear, periodMonth } =
    await request.json();

  if (!entityId) {
    return Response.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  // Use specified period or default to current month
  const now = new Date();
  const targetYear = periodYear ?? now.getFullYear();
  const targetMonth = periodMonth ?? now.getMonth() + 1;

  const adminClient = createAdminClient();

  // Get connection
  const { data: connection, error: connError } = await adminClient
    .from("qbo_connections")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (connError || !connection) {
    return Response.json(
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

  // ---- Stream progress events to the client ----
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // stream already closed
        }
      }

      try {
        // Step 1: Refresh token
        send({
          step: "auth",
          detail: "Authenticating with QuickBooks...",
          progress: 5,
        });

        const accessToken = await refreshTokenIfNeeded(
          connection,
          adminClient
        );

        send({
          step: "auth",
          detail: "Authenticated",
          progress: 10,
        });

        const apiBaseUrl = "https://quickbooks.api.intuit.com";
        let recordsSynced = 0;
        let accountsSynced = 0;

        // Step 2: Fetch chart of accounts (skip for trial_balance-only syncs)
        if (syncType === "full") {
          send({
            step: "accounts",
            detail: "Fetching chart of accounts from QuickBooks...",
            progress: 15,
          });

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

            send({
              step: "accounts",
              detail: `Saving ${qboAccounts.length} accounts to database...`,
              progress: 25,
            });

            for (const qboAccount of qboAccounts) {
              await adminClient.from("accounts").upsert(
                {
                  entity_id: entityId,
                  qbo_id: String(qboAccount.Id),
                  account_number: qboAccount.AcctNum ?? null,
                  name: qboAccount.Name,
                  fully_qualified_name:
                    qboAccount.FullyQualifiedName ?? null,
                  classification: qboAccount.Classification,
                  account_type: qboAccount.AccountType,
                  account_sub_type: qboAccount.AccountSubType ?? null,
                  is_active: qboAccount.Active,
                  currency: qboAccount.CurrencyRef?.value ?? "USD",
                  current_balance: qboAccount.CurrentBalance ?? 0,
                },
                { onConflict: "entity_id,qbo_id" }
              );
              accountsSynced++;
              recordsSynced++;
            }

            send({
              step: "accounts",
              detail: `${accountsSynced} accounts saved`,
              progress: 40,
            });
          } else {
            send({
              step: "accounts",
              detail: `Failed to fetch accounts (HTTP ${accountsResponse.status})`,
              progress: 40,
            });
          }
        } else {
          send({
            step: "accounts",
            detail: "Skipped — using existing chart of accounts",
            progress: 40,
          });
        }

        // Step 3: Fetch trial balance
        const periodStart = new Date(targetYear, targetMonth - 1, 1);
        const periodEnd = new Date(targetYear, targetMonth, 0);
        const startDate = periodStart.toISOString().split("T")[0];
        const endDate = periodEnd.toISOString().split("T")[0];

        send({
          step: "trial_balance",
          detail: `Fetching trial balance for ${startDate} to ${endDate}...`,
          progress: 45,
        });

        const tbResponse = await fetch(
          `${apiBaseUrl}/v3/company/${connection.realm_id}/reports/TrialBalance?start_date=${startDate}&end_date=${endDate}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }
        );

        let tbAccountsFound = 0;
        let tbAccountsMatched = 0;
        let tbAccountsUnmatched = 0;
        const unmatchedNames: string[] = [];

        if (tbResponse.ok) {
          const tbData = await tbResponse.json();

          // Store raw trial balance
          send({
            step: "trial_balance",
            detail: "Saving raw trial balance report...",
            progress: 55,
          });

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

          // Parse trial balance rows — QBO nests inside sections
          function extractAccountRows(
            rows: Array<Record<string, unknown>>
          ): Array<{ name: string; qboId: string | null; debit: number; credit: number }> {
            const result: Array<{
              name: string;
              qboId: string | null;
              debit: number;
              credit: number;
            }> = [];

            for (const row of rows) {
              const nested = row.Rows as
                | { Row?: Array<Record<string, unknown>> }
                | undefined;
              if (nested?.Row) {
                result.push(...extractAccountRows(nested.Row));
                continue;
              }

              const colData = row.ColData as
                | Array<{ value?: string; id?: string }>
                | undefined;
              const rowType = row.type as string | undefined;
              if (
                colData &&
                colData.length >= 3 &&
                rowType !== "Section" &&
                row.Summary === undefined
              ) {
                const name = colData[0]?.value ?? "";
                const qboId = colData[0]?.id ?? null;
                const debit =
                  parseFloat(colData[1]?.value ?? "") || 0;
                const credit =
                  parseFloat(colData[2]?.value ?? "") || 0;
                if (name) {
                  result.push({ name, qboId, debit, credit });
                }
              }
            }

            return result;
          }

          const topRows = tbData?.Rows?.Row ?? [];
          const accountRows = extractAccountRows(topRows);
          tbAccountsFound = accountRows.length;

          send({
            step: "matching",
            detail: `Matching ${tbAccountsFound} trial balance rows to accounts...`,
            progress: 60,
          });

          // Step 4: Match and upsert GL balances
          for (let i = 0; i < accountRows.length; i++) {
            const { name: accountName, qboId, debit, credit } = accountRows[i];

            let account: { id: string } | null = null;

            // Primary match: QBO account ID (most reliable)
            if (qboId) {
              const { data: qboMatch } = await adminClient
                .from("accounts")
                .select("id")
                .eq("entity_id", entityId)
                .eq("qbo_id", qboId)
                .maybeSingle();

              account = qboMatch;
            }

            // Fallback 1: fully_qualified_name
            if (!account) {
              const { data: fqnMatch } = await adminClient
                .from("accounts")
                .select("id")
                .eq("entity_id", entityId)
                .eq("fully_qualified_name", accountName)
                .maybeSingle();

              account = fqnMatch;
            }

            // Fallback 2: name
            if (!account) {
              const { data: nameMatch } = await adminClient
                .from("accounts")
                .select("id")
                .eq("entity_id", entityId)
                .eq("name", accountName)
                .maybeSingle();

              account = nameMatch;
            }

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
              tbAccountsMatched++;
              recordsSynced++;
            } else {
              tbAccountsUnmatched++;
              unmatchedNames.push(accountName);
            }

            // Send progress every 5 accounts
            if (i % 5 === 0 || i === accountRows.length - 1) {
              const matchProgress =
                60 + Math.round(((i + 1) / accountRows.length) * 30);
              send({
                step: "matching",
                detail: `Processed ${i + 1}/${tbAccountsFound} — ${tbAccountsMatched} matched, ${tbAccountsUnmatched} unmatched`,
                progress: matchProgress,
              });
            }
          }
        } else {
          send({
            step: "trial_balance",
            detail: `Failed to fetch trial balance (HTTP ${tbResponse.status})`,
            progress: 90,
          });
        }

        // Step 5: Finalize
        send({
          step: "finalizing",
          detail: "Updating sync status...",
          progress: 95,
        });

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

        // Final event
        send({
          step: "complete",
          detail: "Sync complete",
          progress: 100,
          done: true,
          recordsSynced,
          accountsSynced,
          tbAccountsFound,
          tbAccountsMatched,
          tbAccountsUnmatched,
          unmatchedNames:
            unmatchedNames.length > 0 ? unmatchedNames : undefined,
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

        send({
          step: "error",
          detail: errorMessage,
          progress: 100,
          done: true,
          error: errorMessage,
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
