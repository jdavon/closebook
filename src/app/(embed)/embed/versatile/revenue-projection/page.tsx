import { redirect } from "next/navigation";
import { getUserEntities } from "@/lib/db/queries/organizations";
import RevenueProjectionEmbed from "./embed-client";

export default async function VersatileRevenueProjectionPage() {
  const entities = await getUserEntities();
  const versatile = entities.find((e) => e.name.toLowerCase().includes("versatile"));

  if (!versatile) {
    redirect("/login");
  }

  return <RevenueProjectionEmbed entityId={versatile.id} />;
}
