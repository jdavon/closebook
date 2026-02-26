import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/qbo/sync-year
 *
 * Sync trial balance data for a SINGLE entity across all 12 months of a year.
 * Calls the single-entity sync endpoint sequentially for each month to avoid
 * token refresh race conditions.
 *
 * Body: { entityId: string, year: number }
 *
 * Returns a streaming JSON response with per-month progress events.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, year } = await request.json();

  if (!entityId || !year) {
    return NextResponse.json(
      { error: "entityId and year are required" },
      { status: 400 }
    );
  }

  // Verify entity belongs to user's org
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

  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("id", entityId)
    .eq("organization_id", membershipData.organization_id)
    .eq("is_active", true)
    .single();

  if (!entity) {
    return NextResponse.json(
      { error: "Entity not found" },
      { status: 404 }
    );
  }

  // Verify QBO connection exists
  const adminClient = createAdminClient();
  const { data: conn } = await adminClient
    .from("qbo_connections")
    .select("id")
    .eq("entity_id", entityId)
    .single();

  if (!conn) {
    return NextResponse.json(
      { error: "No QuickBooks connection for this entity" },
      { status: 404 }
    );
  }

  // Build base URL for internal fetch
  const origin =
    request.headers.get("origin") ||
    request.headers.get("host") ||
    "";
  const protocol = origin.startsWith("http") ? "" : "https://";
  const baseUrl = origin.startsWith("http")
    ? origin
    : `${protocol}${origin}`;
  const cookie = request.headers.get("cookie") || "";

  // Stream progress back to the client
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      }

      const monthResults: {
        month: number;
        success: boolean;
        recordsSynced: number;
        error?: string;
      }[] = [];

      for (let month = 1; month <= 12; month++) {
        send({
          step: "syncing",
          month,
          detail: `Syncing month ${month} of 12...`,
          progress: Math.round(((month - 1) / 12) * 100),
        });

        try {
          const syncResponse = await fetch(`${baseUrl}/api/qbo/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookie,
            },
            body: JSON.stringify({
              entityId,
              syncType: "trial_balance",
              periodYear: year,
              periodMonth: month,
            }),
          });

          // Read SSE stream to get the final event
          let lastEvent: Record<string, unknown> = {};
          if (syncResponse.body) {
            const reader = syncResponse.body.getReader();
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
                    /* skip */
                  }
                }
              }
            }
          }

          if (lastEvent.error) {
            monthResults.push({
              month,
              success: false,
              recordsSynced: 0,
              error: String(lastEvent.error),
            });
            send({
              step: "month_error",
              month,
              detail: `Month ${month} failed: ${lastEvent.error}`,
              progress: Math.round((month / 12) * 100),
            });
          } else {
            monthResults.push({
              month,
              success: true,
              recordsSynced: (lastEvent.recordsSynced as number) ?? 0,
            });
            send({
              step: "month_complete",
              month,
              recordsSynced: (lastEvent.recordsSynced as number) ?? 0,
              detail: `Month ${month} complete — ${(lastEvent.recordsSynced as number) ?? 0} records`,
              progress: Math.round((month / 12) * 100),
            });
          }
        } catch (err) {
          monthResults.push({
            month,
            success: false,
            recordsSynced: 0,
            error: err instanceof Error ? err.message : "Unknown error",
          });
          send({
            step: "month_error",
            month,
            detail: `Month ${month} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            progress: Math.round((month / 12) * 100),
          });
        }
      }

      const successCount = monthResults.filter((r) => r.success).length;
      const totalRecords = monthResults.reduce(
        (sum, r) => sum + r.recordsSynced,
        0
      );

      send({
        step: "complete",
        done: true,
        progress: 100,
        detail: `Full year sync complete — ${successCount}/12 months synced, ${totalRecords} total records`,
        monthsSynced: successCount,
        totalRecordsSynced: totalRecords,
        results: monthResults,
      });

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
