"use client";

import { usePathname } from "next/navigation";
import { OrgSidebar } from "./org-sidebar";
import { EntitySidebar } from "./entity-sidebar";
import { detectEntityId } from "@/lib/utils/entity-context";
import type { OrgSummary } from "@/lib/db/queries/org-summary";

interface Entity {
  id: string;
  name: string;
  code: string;
  currency?: string;
  fiscal_year_end_month?: number;
}

interface AppSidebarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  entities: Entity[];
  orgSummary: OrgSummary;
}

export function AppSidebar({ user, entities, orgSummary }: AppSidebarProps) {
  const pathname = usePathname();
  const entityId = detectEntityId(pathname);

  if (entityId) {
    return <EntitySidebar user={user} entities={entities} entityId={entityId} />;
  }

  return <OrgSidebar user={user} entities={entities} orgSummary={orgSummary} />;
}
