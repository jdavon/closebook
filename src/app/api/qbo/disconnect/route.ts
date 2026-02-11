import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId } = await request.json();

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Get the full connection so we can revoke the token with Intuit
  const { data: connection } = await adminClient
    .from("qbo_connections")
    .select("id, access_token, refresh_token")
    .eq("entity_id", entityId)
    .single();

  if (connection) {
    // Revoke the token with Intuit so the next connect flow forces
    // a fresh company selection instead of auto-reconnecting.
    const clientId = process.env.QBO_CLIENT_ID!;
    const clientSecret = process.env.QBO_CLIENT_SECRET!;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );

    try {
      await fetch(
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            token: connection.refresh_token || connection.access_token,
          }),
        }
      );
    } catch (err) {
      // Log but don't block — we still want to remove from our DB
      console.error("Failed to revoke Intuit token:", err);
    }

    // Delete sync logs first (in case CASCADE isn't working)
    await adminClient
      .from("qbo_sync_logs")
      .delete()
      .eq("qbo_connection_id", connection.id);
  }

  // Delete the connection from our DB
  const { error } = await adminClient
    .from("qbo_connections")
    .delete()
    .eq("entity_id", entityId);

  if (error) {
    console.error("Failed to disconnect QBO:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
