import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RevenueProjectionEmbed from "./embed-client";

export default async function VersatileRevenueProjectionPage() {
  const supabase = createAdminClient();
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name")
    .ilike("name", "%versatile%")
    .eq("is_active", true)
    .limit(1);

  const versatile = entities?.[0];
  if (!versatile) {
    redirect("/login");
  }

  return <RevenueProjectionEmbed entityId={versatile.id} />;
}
