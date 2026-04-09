"use client";

import RebateTrackerPage from "@/app/(app)/[entityId]/rebates/page";

export default function RebatesEmbed({ entityId }: { entityId: string }) {
  return <RebateTrackerPage entityId={entityId} isEmbed />;
}
