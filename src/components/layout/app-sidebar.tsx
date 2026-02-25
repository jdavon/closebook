"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  CheckSquare,
  BookOpenCheck,
  TableProperties,
  Car,
  Landmark,
  Receipt,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Building2,
  LibraryBig,
  RefreshCw,
  Scale,
  AlertTriangle,
  Percent,
  FileText,
  Wallet,
  Layers,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface AppSidebarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  entityId?: string;
}

export function AppSidebar({ user, entityId: entityIdProp }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  // Auto-detect entityId from the URL path if not passed as prop
  // URL pattern: /[entityId]/dashboard, /[entityId]/close, etc.
  const detectedEntityId = (() => {
    if (entityIdProp) return entityIdProp;
    const segments = pathname.split("/").filter(Boolean);
    // Entity routes: /<uuid>/dashboard, /<uuid>/accounts, etc.
    // UUID pattern check for the first segment
    if (segments.length >= 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segments[0])) {
      return segments[0];
    }
    return undefined;
  })();

  const entityId = detectedEntityId;
  const entityPrefix = entityId ? `/${entityId}` : "";

  const toolsItems = entityId
    ? [
        {
          title: "Revenue Accruals",
          url: `${entityPrefix}/revenue`,
          icon: Receipt,
        },
        {
          title: "Payroll Accruals",
          url: `${entityPrefix}/payroll`,
          icon: Users,
        },
        {
          title: "Commissions",
          url: `${entityPrefix}/commissions`,
          icon: Percent,
        },
      ]
    : [];

  const mainNavItems = entityId
    ? [
        {
          title: "Dashboard",
          url: `${entityPrefix}/dashboard`,
          icon: LayoutDashboard,
        },
        {
          title: "Close Management",
          url: `${entityPrefix}/close`,
          icon: CheckSquare,
        },
        {
          title: "Chart of Accounts",
          url: `${entityPrefix}/accounts`,
          icon: BookOpenCheck,
        },
        {
          title: "Trial Balance",
          url: `${entityPrefix}/trial-balance`,
          icon: Scale,
        },
        {
          title: "Schedules",
          url: `${entityPrefix}/schedules`,
          icon: TableProperties,
        },
        {
          title: "Fixed Assets",
          url: `${entityPrefix}/assets`,
          icon: Car,
        },
        {
          title: "Debt Schedule",
          url: `${entityPrefix}/debt`,
          icon: Landmark,
        },
        {
          title: "Budget",
          url: `${entityPrefix}/reports/budget`,
          icon: Wallet,
        },
        {
          title: "Reports & KPIs",
          url: `${entityPrefix}/reports`,
          icon: BarChart3,
        },
      ]
    : [
        {
          title: "Dashboard",
          url: "/dashboard",
          icon: LayoutDashboard,
        },
        {
          title: "QBO Sync",
          url: "/sync",
          icon: RefreshCw,
        },
        {
          title: "TB Variance",
          url: "/tb-variance",
          icon: AlertTriangle,
        },
        {
          title: "Financial Model",
          url: "/reports/financial-model",
          icon: FileText,
        },
        {
          title: "Master GL",
          url: "/settings/master-gl",
          icon: LibraryBig,
        },
      ];

  const settingsItems = [
    ...(entityId
      ? [
          {
            title: "Entity Settings",
            url: `${entityPrefix}/settings`,
            icon: Settings,
          },
        ]
      : []),
    {
      title: "Master GL",
      url: "/settings/master-gl",
      icon: LibraryBig,
    },
    {
      title: "Reporting Entities",
      url: "/settings/reporting-entities",
      icon: Layers,
    },
    {
      title: "Organization",
      url: "/settings",
      icon: Building2,
    },
    {
      title: "Members",
      url: "/settings/members",
      icon: Settings,
    },
  ];

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <BookOpen className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">CloseBook</span>
                  <span className="text-xs text-muted-foreground">
                    Close Management
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {entityId ? "Entity" : "Overview"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {toolsItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Tools</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {toolsItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-medium">{user.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56"
                side="top"
                align="start"
              >
                <DropdownMenuItem asChild>
                  <Link href="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
