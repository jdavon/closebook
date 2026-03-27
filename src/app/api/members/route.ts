import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/utils/audit";
import type { UserRole } from "@/lib/types/database";

/**
 * PATCH /api/members
 * Change a member's role.
 * Body: { memberId: string, role: UserRole }
 */
export async function PATCH(request: Request) {
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
      { error: "Only admins can change member roles" },
      { status: 403 }
    );
  }

  const { memberId, role } = (await request.json()) as {
    memberId: string;
    role: UserRole;
  };

  if (!memberId || !role) {
    return NextResponse.json(
      { error: "memberId and role are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const orgId = membership.organization_id;

  // Fetch the target member
  const { data: target } = await admin
    .from("organization_members")
    .select("id, user_id, role, profiles(full_name)")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .single();

  if (!target) {
    return NextResponse.json(
      { error: "Member not found" },
      { status: 404 }
    );
  }

  // Prevent demoting the last admin
  if (target.role === "admin" && role !== "admin") {
    const { count } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("role", "admin");

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot change the role of the only admin" },
        { status: 400 }
      );
    }
  }

  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("id", memberId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAuditEvent({
    organizationId: orgId,
    userId: user.id,
    action: "update",
    resourceType: "organization_member",
    resourceId: memberId,
    oldValues: { role: target.role },
    newValues: { role },
    request,
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/members
 * Remove a member from the organization.
 * Body: { memberId: string }
 */
export async function DELETE(request: Request) {
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
      { error: "Only admins can remove members" },
      { status: 403 }
    );
  }

  const { memberId } = (await request.json()) as { memberId: string };

  if (!memberId) {
    return NextResponse.json(
      { error: "memberId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const orgId = membership.organization_id;

  // Fetch the target member
  const { data: target } = await admin
    .from("organization_members")
    .select("id, user_id, role, profiles(full_name)")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .single();

  if (!target) {
    return NextResponse.json(
      { error: "Member not found" },
      { status: 404 }
    );
  }

  // Prevent removing the last admin
  if (target.role === "admin") {
    const { count } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("role", "admin");

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the only admin" },
        { status: 400 }
      );
    }
  }

  // Remove entity_access overrides for this user in this org's entities
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id")
    .eq("organization_id", orgId);

  if (orgEntities && orgEntities.length > 0) {
    const entityIds = orgEntities.map((e) => e.id);
    await admin
      .from("entity_access")
      .delete()
      .eq("user_id", target.user_id)
      .in("entity_id", entityIds);
  }

  // Remove the member
  const { error } = await admin
    .from("organization_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profileData = target.profiles as unknown as { full_name: string } | null;

  logAuditEvent({
    organizationId: orgId,
    userId: user.id,
    action: "delete",
    resourceType: "organization_member",
    resourceId: memberId,
    oldValues: {
      name: profileData?.full_name,
      role: target.role,
    },
    request,
  });

  return NextResponse.json({ success: true });
}
