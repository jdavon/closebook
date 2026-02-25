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
              progress: 30,
            });
          } else {
            send({
              step: "accounts",
              detail: `Failed to fetch accounts (HTTP ${accountsResponse.status})`,
              progress: 30,
            });
          }

          // Step 2b: Fetch QBO Classes
          send({
            step: "classes",
            detail: "Fetching classes from QuickBooks...",
            progress: 32,
          });

          const classesResponse = await fetch(
            `${apiBaseUrl}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(
              "SELECT * FROM Class MAXRESULTS 1000"
            )}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );

          let classesSynced = 0;

          if (classesResponse.ok) {
            const classesData = await classesResponse.json();
            const qboClasses =
              classesData.QueryResponse?.Class ?? [];

            // First pass: upsert all classes
            for (const qboClass of qboClasses) {
              await adminClient.from("qbo_classes").upsert(
                {
                  entity_id: entityId,
                  qbo_id: String(qboClass.Id),
                  name: qboClass.Name,
                  fully_qualified_name:
                    qboClass.FullyQualifiedName ?? null,
                  is_active: qboClass.Active ?? true,
                },
                { onConflict: "entity_id,qbo_id" }
              );
              classesSynced++;
              recordsSynced++;
            }

            // Second pass: set parent_class_id for sub-classes
            for (const qboClass of qboClasses) {
              if (qboClass.ParentRef?.value) {
                const { data: parentClass } = await adminClient
                  .from("qbo_classes")
                  .select("id")
                  .eq("entity_id", entityId)
                  .eq("qbo_id", String(qboClass.ParentRef.value))
                  .maybeSingle();

                if (parentClass) {
                  await adminClient
                    .from("qbo_classes")
                    .update({ parent_class_id: parentClass.id })
                    .eq("entity_id", entityId)
                    .eq("qbo_id", String(qboClass.Id));
                }
              }
            }

            send({
              step: "classes",
              detail: classesSynced > 0
                ? `${classesSynced} classes saved`
                : "No classes found in QuickBooks",
              progress: 40,
            });
          } else {
            // Classes are optional — entity may not use them
            send({
              step: "classes",
              detail: "No classes found or fetch skipped",
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
        const unmatchedRows: Array<{ name: string; qboId: string | null; debit: number; credit: number }> = [];
        const matchedNames: string[] = [];
        const matchedAccountIds: string[] = [];

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
              matchedNames.push(accountName);
              matchedAccountIds.push(account.id);
            } else {
              tbAccountsUnmatched++;
              unmatchedRows.push({ name: accountName, qboId, debit, credit });
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

          // Step 4b: Persist unmatched rows to database
          if (unmatchedRows.length > 0) {
            send({
              step: "matching",
              detail: `Saving ${unmatchedRows.length} unmatched account rows...`,
              progress: 92,
            });

            for (const row of unmatchedRows) {
              await adminClient.from("tb_unmatched_rows").upsert(
                {
                  entity_id: entityId,
                  period_year: targetYear,
                  period_month: targetMonth,
                  qbo_account_name: row.name,
                  qbo_account_id: row.qboId,
                  debit: row.debit,
                  credit: row.credit,
                },
                {
                  onConflict: "entity_id,period_year,period_month,qbo_account_name",
                }
              );
            }
          }

          // Clean up: remove previously-unmatched rows that are now matched
          if (matchedNames.length > 0) {
            await adminClient
              .from("tb_unmatched_rows")
              .delete()
              .eq("entity_id", entityId)
              .eq("period_year", targetYear)
              .eq("period_month", targetMonth)
              .in("qbo_account_name", matchedNames)
              .is("resolved_account_id", null);
          }

          // Step 4c: Remove stale GL balance rows from prior syncs
          // If an account was in a previous TB but no longer appears, its
          // GL balance row would persist and throw off the debit/credit totals.
          if (matchedAccountIds.length > 0) {
            const { data: staleRows } = await adminClient
              .from("gl_balances")
              .select("id, account_id")
              .eq("entity_id", entityId)
              .eq("period_year", targetYear)
              .eq("period_month", targetMonth)
              .not(
                "account_id",
                "in",
                `(${matchedAccountIds.join(",")})`
              );

            if (staleRows && staleRows.length > 0) {
              await adminClient
                .from("gl_balances")
                .delete()
                .in(
                  "id",
                  staleRows.map((r: { id: string }) => r.id)
                );

              send({
                step: "matching",
                detail: `Removed ${staleRows.length} stale GL balance rows from prior syncs`,
                progress: 93,
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

        // Step 4d: Fetch P&L by Class (only if entity has classes)
        const { data: entityClasses } = await adminClient
          .from("qbo_classes")
          .select("id, qbo_id, name, fully_qualified_name")
          .eq("entity_id", entityId)
          .eq("is_active", true);

        if (entityClasses && entityClasses.length > 0) {
          send({
            step: "pl_by_class",
            detail: "Fetching P&L by Class report...",
            progress: 91,
          });

          const plResponse = await fetch(
            `${apiBaseUrl}/v3/company/${connection.realm_id}/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Class`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );

          if (plResponse.ok) {
            const plData = await plResponse.json();

            // Parse columns to build class index map
            const columns = plData?.Columns?.Column ?? [];
            const classColumns: Array<{
              index: number;
              classDbId: string | null;
            }> = [];

            // Build lookup from class name/FQN to DB record
            // Map both short name and fully_qualified_name so we match
            // regardless of how QBO formats the P&L report column titles
            const classNameMap = new Map<string, string>();
            for (const c of entityClasses as Array<{
              id: string;
              name: string;
              fully_qualified_name?: string | null;
            }>) {
              classNameMap.set(c.name, c.id);
              if (c.fully_qualified_name) {
                classNameMap.set(c.fully_qualified_name, c.id);
              }
            }

            let unmatchedClassColumns: string[] = [];

            for (let i = 1; i < columns.length; i++) {
              const col = columns[i];
              const colTitle =
                col.ColTitle ??
                (col.MetaData ?? []).find(
                  (m: { Name: string }) => m.Name === "ColTitle"
                )?.Value;

              if (colTitle && colTitle !== "TOTAL" && colTitle !== "Total") {
                const matchedId = classNameMap.get(colTitle) ?? null;
                if (!matchedId) {
                  unmatchedClassColumns.push(colTitle);
                }
                classColumns.push({
                  index: i,
                  classDbId: matchedId,
                });
              }
            }

            if (unmatchedClassColumns.length > 0) {
              send({
                step: "pl_by_class",
                detail: `Warning: ${unmatchedClassColumns.length} P&L class column(s) not matched to DB: ${unmatchedClassColumns.join(", ")}`,
                progress: 92,
              });
            }

            // Recursively extract P&L account rows with section tracking
            function extractPLRows(
              rows: Array<Record<string, unknown>>,
              currentSection: string
            ): Array<{
              accountName: string;
              qboId: string | null;
              values: (number | null)[];
              section: string;
            }> {
              const result: Array<{
                accountName: string;
                qboId: string | null;
                values: (number | null)[];
                section: string;
              }> = [];

              for (const row of rows) {
                // Track section from Header
                let section = currentSection;
                const header = row.Header as
                  | { ColData?: Array<{ value?: string }> }
                  | undefined;
                if (header?.ColData?.[0]?.value) {
                  section = header.ColData[0].value;
                }

                // Recurse into nested rows
                const nested = row.Rows as
                  | { Row?: Array<Record<string, unknown>> }
                  | undefined;
                if (nested?.Row) {
                  result.push(...extractPLRows(nested.Row, section));
                  continue;
                }

                // Skip Summary rows
                if (row.Summary !== undefined || row.group !== undefined) continue;

                const colData = row.ColData as
                  | Array<{ value?: string; id?: string }>
                  | undefined;
                if (colData && colData.length > 1) {
                  const accountName = colData[0]?.value ?? "";
                  const qboId = colData[0]?.id ?? null;
                  if (accountName) {
                    const values = colData
                      .slice(1)
                      .map((c) => {
                        const v = parseFloat(c.value ?? "");
                        return isNaN(v) ? null : v;
                      });
                    result.push({ accountName, qboId, values, section });
                  }
                }
              }
              return result;
            }

            const plRows = plData?.Rows?.Row ?? [];
            const plAccountRows = extractPLRows(plRows, "");
            const matchedClassBalanceIds: string[] = [];
            let classBalancesUpserted = 0;

            for (const row of plAccountRows) {
              // Match account using 3-tier strategy
              let account: { id: string } | null = null;

              if (row.qboId) {
                const { data: qboMatch } = await adminClient
                  .from("accounts")
                  .select("id")
                  .eq("entity_id", entityId)
                  .eq("qbo_id", row.qboId)
                  .maybeSingle();
                account = qboMatch;
              }
              if (!account) {
                const { data: fqnMatch } = await adminClient
                  .from("accounts")
                  .select("id")
                  .eq("entity_id", entityId)
                  .eq("fully_qualified_name", row.accountName)
                  .maybeSingle();
                account = fqnMatch;
              }
              if (!account) {
                const { data: nameMatch } = await adminClient
                  .from("accounts")
                  .select("id")
                  .eq("entity_id", entityId)
                  .eq("name", row.accountName)
                  .maybeSingle();
                account = nameMatch;
              }
              if (!account) continue;

              // Determine if this is an income section (needs sign flip to match GL convention)
              const isIncomeSection =
                row.section.toLowerCase().includes("income") ||
                row.section.toLowerCase().includes("revenue");

              for (const classCol of classColumns) {
                if (!classCol.classDbId) continue;

                const rawValue = row.values[classCol.index - 1];
                if (rawValue === null || rawValue === undefined) continue;

                // P&L shows income as positive. GL stores revenue as negative (credit convention).
                // Negate income rows to match gl_balances sign convention.
                const netChange = isIncomeSection ? rawValue * -1 : rawValue;

                const { data: upsertedRow } = await adminClient
                  .from("gl_class_balances")
                  .upsert(
                    {
                      entity_id: entityId,
                      account_id: account.id,
                      qbo_class_id: classCol.classDbId,
                      period_year: targetYear,
                      period_month: targetMonth,
                      net_change: netChange,
                      synced_at: new Date().toISOString(),
                    },
                    {
                      onConflict:
                        "entity_id,account_id,qbo_class_id,period_year,period_month",
                    }
                  )
                  .select("id")
                  .maybeSingle();

                if (upsertedRow) {
                  matchedClassBalanceIds.push(upsertedRow.id);
                }
                classBalancesUpserted++;
              }
            }

            // Clean up stale class balance rows
            if (matchedClassBalanceIds.length > 0) {
              const { data: staleClassRows } = await adminClient
                .from("gl_class_balances")
                .select("id")
                .eq("entity_id", entityId)
                .eq("period_year", targetYear)
                .eq("period_month", targetMonth)
                .not(
                  "id",
                  "in",
                  `(${matchedClassBalanceIds.join(",")})`
                );

              if (staleClassRows && staleClassRows.length > 0) {
                await adminClient
                  .from("gl_class_balances")
                  .delete()
                  .in(
                    "id",
                    staleClassRows.map((r: { id: string }) => r.id)
                  );
              }
            }

            recordsSynced += classBalancesUpserted;

            send({
              step: "pl_by_class",
              detail: `${classBalancesUpserted} class-level balances saved`,
              progress: 94,
            });
          } else {
            send({
              step: "pl_by_class",
              detail: `P&L by Class fetch failed (HTTP ${plResponse.status})`,
              progress: 94,
            });
          }
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
            unmatchedRows.length > 0 ? unmatchedRows.map((r) => r.name) : undefined,
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
