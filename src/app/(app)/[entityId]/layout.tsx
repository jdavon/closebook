import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const supabase = await createClient();

  // Verify entity exists and user has access (RLS handles authorization)
  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("id", entityId)
    .single();

  if (!entity) {
    notFound();
  }

  return <>{children}</>;
}
