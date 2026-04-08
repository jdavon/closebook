"use client";

import RevenueProjectionPage from "@/app/(app)/[entityId]/revenue-projection/page";

export default function RevenueProjectionEmbed({ entityId }: { entityId: string }) {
  return <RevenueProjectionPage entityId={entityId} isEmbed />;
}
