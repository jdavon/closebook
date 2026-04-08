"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RevenueProjectionPage from "@/app/(app)/[entityId]/revenue-projection/page";

function EmbedInner({ entityId }: { entityId: string }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || undefined;
  return <RevenueProjectionPage entityId={entityId} isEmbed defaultTab={tab} />;
}

export default function RevenueProjectionEmbed({ entityId }: { entityId: string }) {
  return (
    <Suspense>
      <EmbedInner entityId={entityId} />
    </Suspense>
  );
}
