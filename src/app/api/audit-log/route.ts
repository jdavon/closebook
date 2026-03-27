import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasMinRole } from "@/lib/utils/permissions";
import type { UserRole } from "@/lib/types/database";

export async function GET(request: NextRequest) {
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

  if (
    !membership ||
    !hasMinRole(membership.role as UserRole, "controller")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50"))
  );
  const userId = searchParams.get("userId");
  const resourceType = searchParams.get("resourceType");
  const action = searchParams.get("action");
  const entityId = searchParams.get("entityId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const admin = createAdminClient();
  let query = admin
    .from("audit_log")
    .select("*, profiles(full_name)", { count: "exact" })
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false });

  if (userId) query = query.eq("user_id", userId);
  if (resourceType) query = query.eq("resource_type", resourceType);
  if (action) query = query.eq("action", action);
  if (entityId) query = query.eq("entity_id", entityId);
  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: {
      page,
      pageSize,
      totalCount: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    },
  });
}
