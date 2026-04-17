"use client";

import { useEffect, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const lastSegment =
    trailSegments.length > 0 ? trailSegments[trailSegments.length - 1] : null;

  // Asset detail page: /[entityId]/assets/[assetId]. Replace the UUID in the
  // breadcrumb with the asset's name.
  const assetId =
    entityId &&
    trailSegments.length === 2 &&
    trailSegments[0] === "assets" &&
    lastSegment &&
    UUID_PATTERN.test(lastSegment)
      ? lastSegment
      : null;
  const [assetName, setAssetName] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) {
      setAssetName(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("fixed_assets")
      .select("asset_name, asset_tag")
      .eq("id", assetId)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setAssetName(
          data.asset_tag
            ? `${data.asset_tag} — ${data.asset_name}`
            : data.asset_name
        );
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const pageLabel = assetId
    ? assetName ?? "Asset"
    : lastSegment
      ? labelFor(lastSegment)
      : null;

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
