import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("entity_id")
    .eq("sync_status", "idle");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: "No connections to sync" });
  }

  const results = [];

  for (const conn of connections) {
    try {
      // Call the sync endpoint internally
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const response = await fetch(`${baseUrl}/api/qbo/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: conn.entity_id,
          syncType: "incremental",
        }),
      });

      const data = await response.json();
      results.push({ entityId: conn.entity_id, ...data });
    } catch (err) {
      results.push({
        entityId: conn.entity_id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ results });
}
