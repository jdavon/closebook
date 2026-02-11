import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/paylocity/connect
 * Saves Paylocity API credentials and tests them by requesting a token.
 *
 * Paylocity uses OAuth2 Client Credentials flow:
 *   POST https://api.paylocity.com/IdentityServer/connect/token
 *   (or https://apisandbox.paylocity.com/IdentityServer/connect/token for testing)
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: grant_type=client_credentials&scope=WebLinkAPI
 *   Authorization: Basic base64(clientId:clientSecret)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId, clientId, clientSecret, companyId, environment } = body;

  if (!entityId || !clientId || !clientSecret || !companyId) {
    return NextResponse.json(
      { error: "Missing required fields: entityId, clientId, clientSecret, companyId" },
      { status: 400 }
    );
  }

  const env = environment === "testing" ? "testing" : "production";
  const tokenUrl =
    env === "testing"
      ? "https://apisandbox.paylocity.com/IdentityServer/connect/token"
      : "https://api.paylocity.com/IdentityServer/connect/token";

  // Test credentials by requesting a token
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials&scope=WebLinkAPI",
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return NextResponse.json(
        { error: `Paylocity authentication failed: ${errText}` },
        { status: 400 }
      );
    }

    const tokenData = await tokenRes.json();
    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in ?? 3600) * 1000
    ).toISOString();

    // Upsert connection
    const { error } = await supabase.from("paylocity_connections").upsert(
      {
        entity_id: entityId,
        client_id: clientId,
        client_secret_encrypted: clientSecret, // TODO: encrypt with server-side key
        access_token: tokenData.access_token,
        token_expires_at: expiresAt,
        environment: env,
        company_id: companyId,
        connected_by: user.id,
        sync_status: "idle",
      },
      { onConflict: "entity_id" }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, environment: env });
  } catch (err) {
    return NextResponse.json(
      { error: `Connection failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 500 }
    );
  }
}
