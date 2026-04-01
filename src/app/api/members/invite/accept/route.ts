import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const { token } = await request.json();

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: invite, error } = await admin
    .from("organization_invites")
    .select("id, organization_id, role, status, expires_at, organizations(name)")
    .eq("token", token)
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: "invalid" }, { status: 404 });
  }

  const org = invite.organizations as unknown as { name: string } | null;

  if (invite.status === "accepted") {
    return NextResponse.json({
      status: "success",
      orgName: org?.name ?? "the organization",
      role: invite.role,
    });
  }

  if (invite.status !== "pending") {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const expiresAt = new Date(invite.expires_at);
  if (expiresAt < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Mark invite as accepted
  await admin
    .from("organization_invites")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invite.id);

  return NextResponse.json({
    status: "success",
    orgName: org?.name ?? "the organization",
    role: invite.role,
  });
}
