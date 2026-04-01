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
  const { email, firstName, lastName, password, role } = body as {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    role: UserRole;
  };

  if (!email || !firstName || !lastName || !password || !role) {
    return NextResponse.json(
      { error: "All fields are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const validRoles: UserRole[] = ["admin", "controller", "preparer", "reviewer", "viewer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const admin = createAdminClient();
  const orgId = membership.organization_id;
  const fullName = `${firstName} ${lastName}`;

  // Check if email is already a member
  const { data: authUsers } = await admin.auth.admin.listUsers();
  const existingAuthUser = authUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (existingAuthUser) {
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

  let userId: string;

  if (existingAuthUser) {
    // User exists — update their password and name
    await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password,
      user_metadata: { full_name: fullName },
      email_confirm: true,
    });
    userId = existingAuthUser.id;

    // Update profile
    await admin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
    }, { onConflict: "id" });
  } else {
    // Create new auth user with password
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        invited_org_id: orgId,
        invited_role: role,
        onboarding_complete: true,
      },
    });

    if (createError || !newUser.user) {
      return NextResponse.json(
        { error: createError?.message || "Failed to create user" },
        { status: 500 }
      );
    }

    userId = newUser.user.id;

    // Create profile
    await admin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
    }, { onConflict: "id" });
  }

  // Add to organization
  const { error: memberError } = await admin
    .from("organization_members")
    .insert({
      organization_id: orgId,
      user_id: userId,
      role,
    });

  if (memberError) {
    return NextResponse.json(
      { error: memberError.message },
      { status: 500 }
    );
  }

  // Create invite record marked as pending (accepted when user clicks link)
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

  logAuditEvent({
    organizationId: orgId,
    userId: user.id,
    action: "create",
    resourceType: "organization_member",
    newValues: { email, role, fullName, method: "direct_create" },
    request,
  });

  const origin = request.headers.get("origin") || "https://closebook.vercel.app";
  const inviteLink = `${origin}/invite/${invite.token}`;

  return NextResponse.json({ invite, inviteLink });
}
