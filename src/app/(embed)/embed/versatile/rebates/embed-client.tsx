"use client";

import RebateTrackerPage from "@/app/(app)/[entityId]/rebates/page";

export default function RebatesEmbed({ entityId, embedKey }: { entityId: string; embedKey: string }) {
  return <RebateTrackerPage entityId={entityId} isEmbed embedKey={embedKey} />;
}
