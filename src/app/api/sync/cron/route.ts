import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300; // Syncing multiple entities × months needs extended timeout

const DELAY_BETWEEN_SYNCS_MS = 2000; // 2s stagger between sync calls to avoid rate limits

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads an SSE stream from the sync endpoint and returns the final event.
 */
async function readSyncStream(
  response: Response
): Promise<Record<string, unknown>> {
  let lastEvent: Record<string, unknown> = {};
  if (!response.body) return lastEvent;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          lastEvent = JSON.parse(line.slice(6));
        } catch {
          /* skip malformed events */
        }
      }
    }
  }

  return lastEvent;
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all active connections
  const { data: connections } = await supabase
    .from("qbo_connections")
    .select("entity_id, company_name")
    .eq("sync_status", "idle");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: "No connections to sync" });
  }

  // Determine months to sync: January through current month of current year
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const monthsToSync = Array.from({ length: currentMonth }, (_, i) => i + 1);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET!;

  const results: {
    entityId: string;
    companyName: string | null;
    months: {
      month: number;
      success: boolean;
      recordsSynced: number;
      dataChanged: boolean;
      error?: string;
    }[];
  }[] = [];

  // Process each entity sequentially (avoids token refresh race conditions
  // within a single QBO realm). Months within an entity are also sequential
  // since they share the same access token.
  for (const conn of connections) {
    const entityResult: (typeof results)[0] = {
      entityId: conn.entity_id,
      companyName: conn.company_name,
      months: [],
    };

    for (const month of monthsToSync) {
      try {
        const response = await fetch(`${baseUrl}/api/qbo/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({
            entityId: conn.entity_id,
            syncType: "incremental",
            periodYear: currentYear,
            periodMonth: month,
          }),
        });

        const lastEvent = await readSyncStream(response);

        entityResult.months.push({
          month,
          success: !lastEvent.error,
          recordsSynced: (lastEvent.recordsSynced as number) ?? 0,
          dataChanged: (lastEvent.dataChanged as boolean) ?? false,
          error: lastEvent.error ? String(lastEvent.error) : undefined,
        });
      } catch (err) {
        entityResult.months.push({
          month,
          success: false,
          recordsSynced: 0,
          dataChanged: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }

      // Stagger between syncs to stay well within QBO rate limits (100 req/min/realm)
      await delay(DELAY_BETWEEN_SYNCS_MS);
    }

    results.push(entityResult);
  }

  // Summary stats
  const totalSyncs = results.reduce((sum, r) => sum + r.months.length, 0);
  const successfulSyncs = results.reduce(
    (sum, r) => sum + r.months.filter((m) => m.success).length,
    0
  );
  const changedPeriods = results.reduce(
    (sum, r) => sum + r.months.filter((m) => m.dataChanged).length,
    0
  );
  const totalRecords = results.reduce(
    (sum, r) => sum + r.months.reduce((ms, m) => ms + m.recordsSynced, 0),
    0
  );

  return NextResponse.json({
    year: currentYear,
    monthsSynced: monthsToSync.length,
    entities: connections.length,
    totalSyncs,
    successfulSyncs,
    changedPeriods,
    totalRecords,
    results,
  });
}
