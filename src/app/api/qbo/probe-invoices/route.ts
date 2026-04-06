import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/qbo/probe-invoices
 * Fetches a few recent invoices from QBO and returns the raw response
 * so we can inspect CustomField structure (especially "Rental Period").
 *
 * Body: { entityId: string, maxResults?: number }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, maxResults = 5 } = await request.json();
  if (!entityId) {
    return Response.json({ error: "entityId is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

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

  // Refresh token if needed
  const accessToken = await refreshTokenIfNeeded(connection, adminClient);

  const query = `SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS ${maxResults}`;
  const response = await fetch(
    `https://quickbooks.api.intuit.com/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return Response.json(
      { error: `QBO API error (HTTP ${response.status})`, body },
      { status: 502 }
    );
  }

  const data = await response.json();
  const invoices = data.QueryResponse?.Invoice ?? [];

  // Extract just the fields we care about for inspection
  const summary = invoices.map((inv: Record<string, unknown>) => ({
    Id: inv.Id,
    DocNumber: inv.DocNumber,
    TxnDate: inv.TxnDate,
    TotalAmt: inv.TotalAmt,
    Balance: inv.Balance,
    CustomerRef: inv.CustomerRef,
    CustomField: inv.CustomField,
    Line: inv.Line,
    PrivateNote: inv.PrivateNote,
    CustomerMemo: inv.CustomerMemo,
  }));

  return Response.json({ count: invoices.length, invoices: summary });
}

// ---- Token refresh (same pattern as qbo/sync) ----

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
    throw new Error(`Token refresh failed (HTTP ${response.status})`);
  }

  const tokens = await response.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

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
