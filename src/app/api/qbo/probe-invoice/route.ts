import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function refreshTokenIfNeeded(
  connection: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
  },
  adminClient: ReturnType<typeof createAdminClient>
) {
  const expiresAt = new Date(connection.access_token_expires_at);
  const now = new Date();
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return connection.access_token;
  }

  const basicAuth = Buffer.from(
    `${process.env.QBO_CLIENT_ID!}:${process.env.QBO_CLIENT_SECRET!}`
  ).toString("base64");

  const res = await fetch(
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

  const tokens = await res.json();
  await adminClient
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000
      ).toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token as string;
}

export async function GET(request: NextRequest) {
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("qbo_connections")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (!connection) {
    return NextResponse.json(
      { error: "No QBO connection for this entity" },
      { status: 404 }
    );
  }

  const accessToken = await refreshTokenIfNeeded(connection, admin);
  const baseUrl = "https://quickbooks.api.intuit.com";

  // Fetch 3 recent invoices with all fields
  const query = `SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 3`;
  const res = await fetch(
    `${baseUrl}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: `QBO API error: ${res.status}`, body },
      { status: 500 }
    );
  }

  const data = await res.json();
  const invoices = data.QueryResponse?.Invoice ?? [];

  // Extract all unique field names across invoices
  const allFields = new Set<string>();
  for (const inv of invoices) {
    for (const key of Object.keys(inv)) {
      allFields.add(key);
    }
  }

  // Look specifically for custom fields
  const customFieldSamples: Record<string, unknown>[] = [];
  for (const inv of invoices) {
    if (inv.CustomField) {
      customFieldSamples.push({
        invoiceNumber: inv.DocNumber,
        customFields: inv.CustomField,
      });
    }
  }

  return NextResponse.json({
    connectionCompany: connection.company_name,
    realmId: connection.realm_id,
    invoiceCount: invoices.length,
    allFieldNames: Array.from(allFields).sort(),
    customFieldSamples,
    sampleInvoice: invoices[0] ?? null,
  });
}
