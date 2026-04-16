"use client";

import Link from "next/link";
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
import { detectEntityId } from "@/lib/utils/entity-context";

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface HeaderProps {
  entities: Entity[];
}

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  close: "Close Management",
  "close-dashboard": "Close Dashboard",
  accounts: "Chart of Accounts",
  "trial-balance": "Trial Balance",
  schedules: "Schedules",
  assets: "Rental Assets",
  debt: "Debt Schedule",
  revenue: "Revenue Accruals",
  "revenue-projection": "Revenue Projection",
  payroll: "Payroll",
  employees: "Employees",
  accruals: "Payroll Accruals",
  details: "Details",
  commissions: "Commissions",
  rebates: "Rebate Tracker",
  insurance: "Insurance",
  "real-estate": "Real Estate",
  "ic-eliminations": "IC Eliminations",
  "financial-model": "Financial Model",
  budget: "Budget",
  reports: "Reports & KPIs",
  settings: "Settings",
  sync: "QBO Sync",
  "tb-variance": "TB Variance",
  "master-gl": "Master GL",
  "reporting-entities": "Reporting Entities",
  members: "Members",
  "audit-log": "Audit Log",
  templates: "Templates",
  tasks: "Close Tasks",
  reconciliations: "Reconciliations",
  materiality: "Materiality",
};

function labelFor(segment: string): string {
  return routeLabels[segment] ?? segment.replace(/-/g, " ");
}

export function Header({ entities }: HeaderProps) {
  const pathname = usePathname();
  const entityId = detectEntityId(pathname);
  const segments = pathname.split("/").filter(Boolean);

  const currentEntity = entityId
    ? entities.find((e) => e.id === entityId)
    : null;

  const trailSegments = entityId ? segments.slice(1) : segments;

  const contextRoot = entityId
    ? {
        label: currentEntity?.name ?? "Entity",
        href: `/${entityId}/dashboard`,
      }
    : { label: "Organization", href: "/dashboard" };

  const pageLabel =
    trailSegments.length > 0 ? labelFor(trailSegments[trailSegments.length - 1]) : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {pageLabel ? (
              <BreadcrumbLink asChild>
                <Link href={contextRoot.href}>{contextRoot.label}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{contextRoot.label}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {pageLabel && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="capitalize">{pageLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
