import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/utils/audit";
import type { UserRole } from "@/lib/types/database";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can invite members" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { email, role } = body as { email: string; role: UserRole };

  if (!email || !role) {
    return NextResponse.json(
      { error: "email and role are required" },
      { status: 400 }
    );
  }

  const validRoles: UserRole[] = ["admin", "controller", "preparer", "reviewer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const admin = createAdminClient();
  const orgId = membership.organization_id;

  // Check if email is already a member
  const { data: existingMembers } = await admin
    .from("organization_members")
    .select("id, profiles(full_name)")
    .eq("organization_id", orgId);

  // Look up all auth users to check if the email is already a member
  const { data: authUsers } = await admin.auth.admin.listUsers();
  const existingAuthUser = authUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (existingAuthUser && existingMembers) {
    const alreadyMember = existingMembers.find(
      (m: { id: string }) =>
        // Check via organization_members join
        false // We need to check user_id match
    );
    // Direct check
    const { data: directCheck } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", existingAuthUser.id)
      .single();

    if (directCheck) {
      return NextResponse.json(
        { error: "This user is already a member of your organization" },
        { status: 409 }
      );
    }
  }

  // Check for existing pending invite
  const { data: existingInvite } = await admin
    .from("organization_invites")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email", email.toLowerCase())
    .eq("status", "pending")
    .single();

  if (existingInvite) {
    return NextResponse.json(
      { error: "An invite is already pending for this email" },
      { status: 409 }
    );
  }

  // If user already exists and is confirmed, add them directly
  if (existingAuthUser && existingAuthUser.email_confirmed_at) {
    // Add to organization directly
    const { error: memberError } = await admin
      .from("organization_members")
      .insert({
        organization_id: orgId,
        user_id: existingAuthUser.id,
        role,
      });

    if (memberError) {
      return NextResponse.json(
        { error: memberError.message },
        { status: 500 }
      );
    }

    // Create invite record marked as accepted
    await admin.from("organization_invites").insert({
      organization_id: orgId,
      email: email.toLowerCase(),
      role,
      invited_by: user.id,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    });

    logAuditEvent({
      organizationId: orgId,
      userId: user.id,
      action: "create",
      resourceType: "organization_member",
      newValues: { email, role, method: "direct_add" },
      request,
    });

    return NextResponse.json({
      invite: null,
      memberAdded: true,
      message: "User already has an account and was added directly.",
    });
  }

  // Create pending invite record
  const { data: invite, error: inviteError } = await admin
    .from("organization_invites")
    .insert({
      organization_id: orgId,
      email: email.toLowerCase(),
      role,
      invited_by: user.id,
      status: "pending",
    })
    .select()
    .single();

  if (inviteError) {
    return NextResponse.json(
      { error: inviteError.message },
      { status: 500 }
    );
  }

  // Send invite via Supabase Auth
  const origin = request.headers.get("origin") || "https://closebook.vercel.app";
  try {
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/dashboard`,
      data: {
        invited_org_id: orgId,
        invited_role: role,
      },
    });
  } catch (err) {
    // inviteUserByEmail may fail if user exists but unconfirmed — that's ok,
    // the invite record is still created and will be processed on auth callback
    console.warn("[invite] inviteUserByEmail warning:", err);
  }

  logAuditEvent({
    organizationId: orgId,
    userId: user.id,
    action: "create",
    resourceType: "organization_member",
    newValues: { email, role, method: "invite" },
    request,
  });

  return NextResponse.json({ invite, memberAdded: false });
}
