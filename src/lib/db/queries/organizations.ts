import { createClient } from "@/lib/supabase/server";

export async function getUserOrganization() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, slug)")
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  return {
    organization: membership.organizations as unknown as {
      id: string;
      name: string;
      slug: string;
    },
    role: membership.role,
  };
}

export async function getUserEntities() {
  const supabase = await createClient();

  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code, currency, fiscal_year_end_month, is_active")
    .eq("is_active", true)
    .order("name");

  return entities ?? [];
}

export async function getUserProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile
    ? { ...profile, email: user.email ?? "" }
    : { id: user.id, full_name: user.email ?? "", email: user.email ?? "" };
}

export async function getOrganizationMembers(organizationId: string) {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, profiles(id, full_name, avatar_url)")
    .eq("organization_id", organizationId)
    .order("created_at");

  return members ?? [];
}
