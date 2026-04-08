"use client";

import { useSearchParams } from "next/navigation";
import RevenueProjectionPage from "@/app/(app)/[entityId]/revenue-projection/page";

export default function RevenueProjectionEmbed({ entityId }: { entityId: string }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || undefined;
  return <RevenueProjectionPage entityId={entityId} isEmbed defaultTab={tab} />;
}
