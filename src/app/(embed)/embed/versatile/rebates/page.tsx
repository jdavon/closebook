import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RebatesEmbed from "./embed-client";

export default async function VersatileRebatesPage() {
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

  return <RebatesEmbed entityId={versatile.id} embedKey={process.env.EMBED_API_KEY || ""} />;
}
