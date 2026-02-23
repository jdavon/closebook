"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { EntitySelector } from "./entity-selector";

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface HeaderProps {
  entities: Entity[];
  currentEntityId?: string;
}

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  close: "Close Management",
  accounts: "Chart of Accounts",
  "trial-balance": "Trial Balance",
  schedules: "Schedules",
  assets: "Fixed Assets",
  debt: "Debt Schedule",
  revenue: "Revenue Accruals",
  payroll: "Payroll Accruals",
  commissions: "Commissions",
  reports: "Reports & KPIs",
  settings: "Settings",
  sync: "QBO Sync",
  "tb-variance": "TB Variance",
  "master-gl": "Master GL",
  members: "Members",
};

export function Header({ entities, currentEntityId }: HeaderProps) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Detect if we're inside an entity route (first segment is a UUID)
  const isEntityRoute =
    segments.length >= 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      segments[0]
    );

  const currentEntity = entities.find((e) =>
    isEntityRoute ? e.id === segments[0] : e.id === currentEntityId
  );

  // Build page label from remaining segments after entity ID (or all segments if no entity)
  const pageSegments = isEntityRoute ? segments.slice(1) : segments;
  const pageLabel =
    pageSegments.length > 0
      ? routeLabels[pageSegments[pageSegments.length - 1]] ??
        pageSegments[pageSegments.length - 1]
      : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {isEntityRoute && currentEntity ? (
            <>
              <BreadcrumbItem>
                <EntitySelector
                  entities={entities}
                  currentEntityId={currentEntity.id}
                />
              </BreadcrumbItem>
              {pageLabel && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </>
          ) : (
            <>
              <BreadcrumbItem>
                <EntitySelector
                  entities={entities}
                  currentEntityId={currentEntityId}
                />
              </BreadcrumbItem>
              {pageLabel && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
