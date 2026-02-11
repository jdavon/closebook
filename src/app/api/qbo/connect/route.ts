import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

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

  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment = process.env.QBO_ENVIRONMENT || "sandbox";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "QBO configuration missing. Set QBO_CLIENT_ID and QBO_REDIRECT_URI environment variables." },
      { status: 500 }
    );
  }

  // Create a signed state parameter containing the entityId
  const statePayload = JSON.stringify({ entityId, userId: user.id, nonce: crypto.randomBytes(16).toString("hex") });
  const state = Buffer.from(statePayload).toString("base64url");

  const baseUrl =
    environment === "production"
      ? "https://appcenter.intuit.com/connect/oauth2"
      : "https://appcenter.intuit.com/connect/oauth2";

  const authUrl = new URL(baseUrl);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return NextResponse.json({ authUrl: authUrl.toString() });
}
