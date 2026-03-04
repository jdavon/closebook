"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building,
  Building2,
  Search,
  ArrowRight,
  Calendar,
  DollarSign,
  TrendingUp,
  PieChart as PieChartIcon,
  BarChart3,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, getCurrentPeriod } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import {
  calculateLeaseLiability,
  calculateROUAsset,
  generateASC842Schedule,
} from "@/lib/utils/lease-calculations";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import type { LeaseStatus, LeaseType, MaintenanceType, PropertyType } from "@/lib/types/database";

// --- Types ---

interface LeaseRow {
  id: string;
  entity_id: string;
  lease_name: string;
  lease_type: LeaseType;
  status: LeaseStatus;
  lessor_name: string | null;
  commencement_date: string;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  base_rent_annual: number;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  utilities_monthly: number;
  other_monthly_costs: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  maintenance_type: MaintenanceType | null;
  properties: {
    property_name: string;
    property_type: PropertyType | null;
    city: string | null;
    state: string | null;
    rentable_square_footage: number | null;
  } | null;
}

interface EntityRow {
  id: string;
  name: string;
  code: string;
}

// --- Constants ---

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const ENTITY_COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#ea580c", // orange
  "#9333ea", // purple
  "#dc2626", // red
  "#0891b2", // cyan
  "#ca8a04", // yellow
  "#be185d", // pink
];

const STATUS_VARIANT: Record<LeaseStatus, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  draft: "secondary",
  expired: "outline",
  terminated: "destructive",
};

// --- Helpers ---

function getMonthlyOccupancyCost(lease: LeaseRow): number {
  return (
    lease.base_rent_monthly +
    lease.cam_monthly +
    lease.insurance_monthly +
    lease.property_tax_annual / 12 +
    lease.utilities_monthly +
    lease.other_monthly_costs
  );
}

function getAnnualOccupancyCost(lease: LeaseRow): number {
  return getMonthlyOccupancyCost(lease) * 12;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getMonthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// --- Page ---

export default function OrgRealEstatePage() {
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());

  // --- Data Fetching ---

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [{ data: entData }, { data: leaseData }] = await Promise.all([
        supabase
          .from("entities")
          .select("id, name, code")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("leases")
          .select(
            `id, entity_id, lease_name, lease_type, status, lessor_name,
             commencement_date, expiration_date, lease_term_months,
             base_rent_monthly, base_rent_annual, cam_monthly, insurance_monthly,
             property_tax_annual, utilities_monthly, other_monthly_costs,
             discount_rate, initial_direct_costs, lease_incentives_received,
             prepaid_rent, maintenance_type,
             properties(property_name, property_type, city, state, rentable_square_footage)`
          )
          .order("lease_name"),
      ]);

      setEntities(entData ?? []);
      setLeases((leaseData as unknown as LeaseRow[]) ?? []);
      // Auto-expand all entities that have leases
      if (entData) {
        const idsWithLeases = new Set(
          (leaseData ?? []).map((l) => l.entity_id)
        );
        setExpandedEntities(idsWithLeases);
      }
      setLoading(false);
    }
    load();
  }, []);

  // --- Filtered data ---

  const filteredLeases = useMemo(() => {
    return leases.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          l.lease_name.toLowerCase().includes(q) ||
          (l.lessor_name && l.lessor_name.toLowerCase().includes(q)) ||
          (l.properties?.property_name?.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [leases, statusFilter, search]);

  const activeLeases = useMemo(
    () => leases.filter((l) => l.status === "active"),
    [leases]
  );

  // --- Computed KPIs ---

  const kpis = useMemo(() => {
    const totalMonthly = activeLeases.reduce(
      (sum, l) => sum + getMonthlyOccupancyCost(l),
      0
    );
    const totalAnnual = totalMonthly * 12;
    const totalLiability = activeLeases.reduce((sum, l) => {
      return (
        sum +
        calculateLeaseLiability({
          lease_type: l.lease_type,
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        })
      );
    }, 0);
    const totalROU = activeLeases.reduce((sum, l) => {
      return (
        sum +
        calculateROUAsset({
          lease_type: l.lease_type,
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        })
      );
    }, 0);
    const totalSqFt = activeLeases.reduce(
      (sum, l) => sum + (l.properties?.rentable_square_footage ?? 0),
      0
    );

    return { totalMonthly, totalAnnual, totalLiability, totalROU, totalSqFt };
  }, [activeLeases]);

  // --- Cost Timeline (next 24 months by entity) ---

  const costTimeline = useMemo(() => {
    const { year, month } = getCurrentPeriod();
    const months: { label: string; year: number; month: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(year, month - 1 + i, 1);
      months.push({
        label: getMonthLabel(d.getFullYear(), d.getMonth() + 1),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }

    const entityMap = new Map(entities.map((e) => [e.id, e]));

    return months.map((m) => {
      const row: Record<string, string | number> = { name: m.label };
      let total = 0;

      for (const entity of entities) {
        const entityLeases = activeLeases.filter(
          (l) => l.entity_id === entity.id
        );
        let entityTotal = 0;
        for (const l of entityLeases) {
          const start = new Date(l.commencement_date);
          const end = new Date(l.expiration_date);
          const periodDate = new Date(m.year, m.month - 1, 15);
          if (periodDate >= start && periodDate <= end) {
            entityTotal += getMonthlyOccupancyCost(l);
          }
        }
        if (entityTotal > 0) {
          row[entity.code] = Math.round(entityTotal);
          total += entityTotal;
        }
      }
      row.total = Math.round(total);
      return row;
    });
  }, [activeLeases, entities]);

  // --- Entity cost breakdown (pie) ---

  const entityCostPie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const entity = entities.find((e) => e.id === l.entity_id);
      if (!entity) continue;
      const key = entity.code;
      map.set(key, (map.get(key) ?? 0) + getAnnualOccupancyCost(l));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  }, [activeLeases, entities]);

  // --- Cost category breakdown (pie) ---

  const costCategoryPie = useMemo(() => {
    let baseRent = 0,
      cam = 0,
      insurance = 0,
      propTax = 0,
      utilities = 0,
      other = 0;

    for (const l of activeLeases) {
      baseRent += l.base_rent_monthly * 12;
      cam += l.cam_monthly * 12;
      insurance += l.insurance_monthly * 12;
      propTax += l.property_tax_annual;
      utilities += l.utilities_monthly * 12;
      other += l.other_monthly_costs * 12;
    }

    return [
      { name: "Base Rent", value: Math.round(baseRent) },
      { name: "CAM", value: Math.round(cam) },
      { name: "Insurance", value: Math.round(insurance) },
      { name: "Property Tax", value: Math.round(propTax) },
      { name: "Utilities", value: Math.round(utilities) },
      { name: "Other", value: Math.round(other) },
    ].filter((d) => d.value > 0);
  }, [activeLeases]);

  // --- Lease type breakdown (pie) ---

  const leaseTypePie = useMemo(() => {
    const operating = activeLeases.filter(
      (l) => l.lease_type === "operating"
    ).length;
    const finance = activeLeases.filter(
      (l) => l.lease_type === "finance"
    ).length;
    return [
      { name: "Operating", value: operating },
      { name: "Finance", value: finance },
    ].filter((d) => d.value > 0);
  }, [activeLeases]);

  // --- Lease expiration timeline (bar) ---

  const expirationTimeline = useMemo(() => {
    const { year } = getCurrentPeriod();
    const buckets: Record<string, number> = {};

    for (const l of activeLeases) {
      const expYear = new Date(l.expiration_date).getFullYear();
      const label =
        expYear <= year
          ? `${year}`
          : expYear > year + 5
            ? `${year + 6}+`
            : `${expYear}`;
      buckets[label] = (buckets[label] ?? 0) + 1;
    }

    // Generate sorted labels
    const labels: string[] = [];
    for (let y = year; y <= year + 5; y++) labels.push(`${y}`);
    labels.push(`${year + 6}+`);

    return labels
      .filter((label) => buckets[label])
      .map((label) => ({
        name: label,
        leases: buckets[label],
      }));
  }, [activeLeases]);

  // --- Maintenance type breakdown (pie) ---

  const maintenancePie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const mt = l.maintenance_type ?? "unknown";
      const label =
        mt === "triple_net"
          ? "Triple Net (NNN)"
          : mt === "gross"
            ? "Gross"
            : mt === "modified_gross"
              ? "Modified Gross"
              : "Unknown";
      map.set(label, (map.get(label) ?? 0) + getAnnualOccupancyCost(l));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  }, [activeLeases]);

  // --- Property type breakdown (pie) ---

  const propertyTypePie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of activeLeases) {
      const pt = l.properties?.property_type ?? "other";
      const label = pt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeLeases]);

  // --- Entity toggle ---

  function toggleEntity(entityId: string) {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  // --- Grouped leases ---

  const groupedLeases = useMemo(() => {
    const map = new Map<string, LeaseRow[]>();
    for (const l of filteredLeases) {
      const arr = map.get(l.entity_id) ?? [];
      arr.push(l);
      map.set(l.entity_id, arr);
    }
    return map;
  }, [filteredLeases]);

  // --- Upcoming expirations (within 12 months) ---

  const upcomingExpirations = useMemo(() => {
    const now = new Date();
    const in12Months = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate());
    return activeLeases
      .filter((l) => {
        const exp = new Date(l.expiration_date);
        return exp <= in12Months && exp >= now;
      })
      .sort(
        (a, b) =>
          new Date(a.expiration_date).getTime() -
          new Date(b.expiration_date).getTime()
      );
  }, [activeLeases]);

  // --- Render ---

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Real Estate Portfolio
          </h1>
          <p className="text-muted-foreground">
            Loading lease data across all entities...
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-7 w-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const entitiesWithCodes = entities.filter((e) =>
    activeLeases.some((l) => l.entity_id === e.id)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Real Estate Portfolio
        </h1>
        <p className="text-muted-foreground">
          Consolidated view of {activeLeases.length} active lease
          {activeLeases.length !== 1 ? "s" : ""} across{" "}
          {entitiesWithCodes.length} entit
          {entitiesWithCodes.length !== 1 ? "ies" : "y"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Annual Occupancy Cost
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(kpis.totalAnnual)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(kpis.totalMonthly)}/month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Lease Liability
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(kpis.totalLiability)}
            </div>
            <p className="text-xs text-muted-foreground">ASC 842 balance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ROU Asset</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(kpis.totalROU)}
            </div>
            <p className="text-xs text-muted-foreground">
              Right-of-use assets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Square Footage
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.totalSqFt > 0
                ? new Intl.NumberFormat("en-US").format(kpis.totalSqFt)
                : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">
              {kpis.totalSqFt > 0 && kpis.totalAnnual > 0
                ? `${formatCurrency(kpis.totalAnnual / kpis.totalSqFt)}/SF/yr`
                : "Rentable area"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Cost Timeline + Entity Breakdown */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Monthly Occupancy Cost Forecast
            </CardTitle>
            <CardDescription>
              Projected costs by entity over the next 24 months
            </CardDescription>
          </CardHeader>
          <CardContent>
            {costTimeline.length > 0 && entitiesWithCodes.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart
                  data={costTimeline}
                  margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    interval={2}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tickFormatter={formatCompact}
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    width={55}
                  />
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  {entitiesWithCodes.map((entity, i) => (
                    <Area
                      key={entity.id}
                      type="monotone"
                      dataKey={entity.code}
                      stackId="1"
                      fill={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      stroke={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[320px] text-muted-foreground">
                No active leases to chart
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by Entity</CardTitle>
            <CardDescription>Annual occupancy cost distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {entityCostPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={entityCostPie}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {entityCostPie.map((_, i) => (
                      <Cell
                        key={i}
                        fill={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[320px] text-muted-foreground">
                No data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Cost Categories + Lease Expirations + Lease Types */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost Breakdown</CardTitle>
            <CardDescription>Annual cost by category</CardDescription>
          </CardHeader>
          <CardContent>
            {costCategoryPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={costCategoryPie}
                    cx="50%"
                    cy="45%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {costCategoryPie.map((_, i) => (
                      <Cell
                        key={i}
                        fill={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconSize={10}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <RechartsTooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground">
                No data
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lease Expirations</CardTitle>
            <CardDescription>Active leases expiring by year</CardDescription>
          </CardHeader>
          <CardContent>
            {expirationTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={expirationTimeline}
                  margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="leases"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                    name="Leases"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground">
                No expirations
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lease Structure</CardTitle>
            <CardDescription>By type and maintenance responsibility</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Lease type mini chart */}
              {leaseTypePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Classification
                  </p>
                  <div className="flex gap-4">
                    {leaseTypePie.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{
                            backgroundColor:
                              ENTITY_COLORS[i % ENTITY_COLORS.length],
                          }}
                        />
                        <span className="text-sm">
                          {d.name}{" "}
                          <span className="font-semibold">{d.value}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Maintenance type */}
              {maintenancePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Maintenance Responsibility
                  </p>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie
                        data={maintenancePie}
                        cx="50%"
                        cy="50%"
                        innerRadius={30}
                        outerRadius={55}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {maintenancePie.map((_, i) => (
                          <Cell
                            key={i}
                            fill={ENTITY_COLORS[i % ENTITY_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Legend
                        verticalAlign="bottom"
                        height={30}
                        iconSize={8}
                        wrapperStyle={{ fontSize: 10 }}
                      />
                      <RechartsTooltip
                        formatter={(value) => formatCurrency(Number(value))}
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Property types */}
              {propertyTypePie.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Property Types
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {propertyTypePie.map((d, i) => (
                      <Badge
                        key={d.name}
                        variant="outline"
                        className="text-xs"
                      >
                        {d.name} ({d.value})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Expirations Alert */}
      {upcomingExpirations.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Upcoming Lease Expirations
            </CardTitle>
            <CardDescription>
              {upcomingExpirations.length} lease
              {upcomingExpirations.length !== 1 ? "s" : ""} expiring within 12
              months
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingExpirations.map((l) => {
                const entity = entities.find((e) => e.id === l.entity_id);
                const daysLeft = Math.ceil(
                  (new Date(l.expiration_date).getTime() - Date.now()) /
                    (1000 * 60 * 60 * 24)
                );
                return (
                  <Link
                    key={l.id}
                    href={`/${l.entity_id}/real-estate/${l.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {l.lease_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entity?.code} &middot;{" "}
                        {new Date(l.expiration_date).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge
                      variant={daysLeft <= 90 ? "destructive" : "secondary"}
                      className="ml-2 shrink-0"
                    >
                      {daysLeft}d
                    </Badge>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lease List by Entity */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base">All Leases</CardTitle>
              <CardDescription>
                {filteredLeases.length} lease
                {filteredLeases.length !== 1 ? "s" : ""} across all entities
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search leases..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mb-3" />
              <p>No entities found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {entities.map((entity) => {
                const entityLeases = groupedLeases.get(entity.id) ?? [];
                const isExpanded = expandedEntities.has(entity.id);
                const entityAnnualCost = entityLeases
                  .filter((l) => l.status === "active")
                  .reduce((s, l) => s + getAnnualOccupancyCost(l), 0);

                if (entityLeases.length === 0 && statusFilter !== "all")
                  return null;

                return (
                  <div key={entity.id} className="border rounded-lg">
                    {/* Entity Header */}
                    <button
                      onClick={() => toggleEntity(entity.id)}
                      className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <span className="font-medium">{entity.name}</span>
                          <span className="text-muted-foreground ml-2 text-sm">
                            ({entity.code})
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                          {entityLeases.length} lease
                          {entityLeases.length !== 1 ? "s" : ""}
                        </span>
                        {entityAnnualCost > 0 && (
                          <span className="text-sm font-medium">
                            {formatCurrency(entityAnnualCost)}/yr
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Lease Table */}
                    {isExpanded && entityLeases.length > 0 && (
                      <div className="border-t">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-11">Lease</TableHead>
                              <TableHead>Property</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">
                                Monthly Cost
                              </TableHead>
                              <TableHead className="text-right">
                                Annual Cost
                              </TableHead>
                              <TableHead>Expiration</TableHead>
                              <TableHead className="w-8" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {entityLeases.map((lease) => {
                              const monthly = getMonthlyOccupancyCost(lease);
                              const annual = monthly * 12;
                              const daysToExpiry = Math.ceil(
                                (new Date(lease.expiration_date).getTime() -
                                  Date.now()) /
                                  (1000 * 60 * 60 * 24)
                              );
                              const isExpiringSoon =
                                lease.status === "active" &&
                                daysToExpiry <= 180 &&
                                daysToExpiry > 0;

                              return (
                                <TableRow
                                  key={lease.id}
                                  className="cursor-pointer hover:bg-accent/50"
                                >
                                  <TableCell className="pl-11">
                                    <Link
                                      href={`/${lease.entity_id}/real-estate/${lease.id}`}
                                      className="hover:underline"
                                    >
                                      <div className="font-medium">
                                        {lease.lease_name}
                                      </div>
                                    </Link>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {lease.properties?.property_name ?? "—"}
                                    </div>
                                    {lease.properties?.city && (
                                      <div className="text-xs text-muted-foreground">
                                        {lease.properties.city}
                                        {lease.properties.state
                                          ? `, ${lease.properties.state}`
                                          : ""}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs capitalize">
                                      {lease.lease_type}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={STATUS_VARIANT[lease.status]}
                                      className="text-xs capitalize"
                                    >
                                      {lease.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(monthly)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(annual)}
                                  </TableCell>
                                  <TableCell>
                                    <div
                                      className={cn(
                                        "text-sm",
                                        isExpiringSoon && "text-amber-600 font-medium"
                                      )}
                                    >
                                      {new Date(
                                        lease.expiration_date
                                      ).toLocaleDateString()}
                                    </div>
                                    {isExpiringSoon && (
                                      <div className="text-xs text-amber-600">
                                        {daysToExpiry}d remaining
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Link
                                      href={`/${lease.entity_id}/real-estate/${lease.id}`}
                                    >
                                      <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                    </Link>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {isExpanded && entityLeases.length === 0 && (
                      <div className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
                        No leases match the current filters
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
