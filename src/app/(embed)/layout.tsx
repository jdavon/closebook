import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/db/queries/organizations";

export default async function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getUserProfile();

  if (!profile) {
    redirect("/login");
  }

  return <main className="min-h-screen bg-background">{children}</main>;
}
