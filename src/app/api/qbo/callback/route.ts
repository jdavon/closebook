import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  // In production, use the request origin (real domain). For local dev
  // behind a tunnel, use NEXT_PUBLIC_APP_URL to redirect back to localhost.
  const appUrl = process.env.NODE_ENV === "production"
    ? origin
    : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const realmId = searchParams.get("realmId");

  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      `${appUrl}/dashboard?error=qbo_callback_missing_params`
    );
  }

  // Decode state to get entityId
  let entityId: string;
  let userId: string;
  try {
    const statePayload = JSON.parse(
      Buffer.from(state, "base64url").toString()
    );
    entityId = statePayload.entityId;
    userId = statePayload.userId;
  } catch {
    return NextResponse.redirect(
      `${appUrl}/dashboard?error=qbo_callback_invalid_state`
    );
  }

  const clientId = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const redirectUri = process.env.QBO_REDIRECT_URI!;

  // Exchange code for tokens
  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("QBO token exchange failed:", errorText);
      console.error("QBO token exchange redirect_uri used:", redirectUri);
      console.error("QBO token exchange status:", tokenResponse.status);
      const errorDetail = encodeURIComponent(errorText.slice(0, 200));
      return NextResponse.redirect(
        `${appUrl}/${entityId}/settings?error=qbo_token_exchange_failed&detail=${errorDetail}`
      );
    }

    const tokens = await tokenResponse.json();

    const supabase = createAdminClient();

    // Get company info — always use production API URL
    const apiBaseUrl = "https://quickbooks.api.intuit.com";

    let companyName = null;
    try {
      const companyResponse = await fetch(
        `${apiBaseUrl}/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/json",
          },
        }
      );
      if (companyResponse.ok) {
        const companyData = await companyResponse.json();
        companyName = companyData.CompanyInfo?.CompanyName ?? null;
      }
    } catch {
      // Non-critical - continue without company name
    }

    // Upsert connection (replace if exists)
    const now = new Date();
    const accessTokenExpiry = new Date(
      now.getTime() + tokens.expires_in * 1000
    );
    const refreshTokenExpiry = new Date(
      now.getTime() + (tokens.x_refresh_token_expires_in ?? 157680000) * 1000
    );

    const { error } = await supabase.from("qbo_connections").upsert(
      {
        entity_id: entityId,
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_token_expires_at: accessTokenExpiry.toISOString(),
        refresh_token_expires_at: refreshTokenExpiry.toISOString(),
        company_name: companyName,
        sync_status: "idle",
        sync_error: null,
        connected_by: userId,
      },
      { onConflict: "entity_id" }
    );

    if (error) {
      console.error("Failed to save QBO connection:", error);
      return NextResponse.redirect(
        `${appUrl}/${entityId}/settings?error=qbo_save_failed`
      );
    }

    return NextResponse.redirect(
      `${appUrl}/${entityId}/settings?qbo_connected=true`
    );
  } catch (err) {
    console.error("QBO callback error:", err);
    return NextResponse.redirect(
      `${appUrl}/${entityId}/settings?error=qbo_callback_error`
    );
  }
}
