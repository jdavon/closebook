"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  ArrowRight,
  Building,
  Search,
  Upload,
  AlertTriangle,
  Calendar,
  Check,
} from "lucide-react";
import { formatCurrency, formatPercentage } from "@/lib/utils/dates";
import {
  calculateLeaseLiability,
  calculateROUAsset,
} from "@/lib/utils/lease-calculations";
import type { LeaseStatus, LeaseType, CriticalDateType, SubleaseStatus } from "@/lib/types/database";

// --- Interfaces ---

interface LeaseListItem {
  id: string;
  lease_name: string;
  status: LeaseStatus;
  lease_type: LeaseType;
  lessor_name: string | null;
  commencement_date: string;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  utilities_monthly: number;
  other_monthly_costs: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  properties: {
    property_name: string;
    rentable_square_footage: number | null;
  } | null;
}

interface CriticalDateItem {
  id: string;
  date_type: CriticalDateType;
  critical_date: string;
  description: string | null;
  alert_days_before: number;
  is_resolved: boolean;
  lease_id: string;
  leases: {
    lease_name: string;
  } | null;
}

interface SubleaseListItem {
  id: string;
  lease_id: string;
  sublease_name: string;
  subtenant_name: string;
  status: SubleaseStatus;
  commencement_date: string;
  expiration_date: string;
  sublease_term_months: number;
  base_rent_monthly: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
  subleased_square_footage: number | null;
  leases: { lease_name: string } | null;
}

// --- Constants ---

const STATUS_LABELS: Record<LeaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

const STATUS_VARIANTS: Record<
  LeaseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  expired: "secondary",
  terminated: "destructive",
};

const TYPE_LABELS: Record<LeaseType, string> = {
  operating: "Operating",
  finance: "Finance",
};

const DATE_TYPE_LABELS: Record<CriticalDateType, string> = {
  lease_expiration: "Lease Expiration",
  renewal_deadline: "Renewal Deadline",
  termination_notice: "Termination Notice",
  rent_escalation: "Rent Escalation",
  rent_review: "Rent Review",
  cam_reconciliation: "CAM Reconciliation",
  insurance_renewal: "Insurance Renewal",
  custom: "Custom",
};

function totalMonthlyCost(lease: LeaseListItem): number {
  return (
    lease.base_rent_monthly +
    lease.cam_monthly +
    lease.insurance_monthly +
    lease.property_tax_annual / 12 +
    lease.utilities_monthly +
    lease.other_monthly_costs
  );
}

function totalLifetimeCost(lease: LeaseListItem): number {
  return totalMonthlyCost(lease) * lease.lease_term_months;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyColor(days: number): string {
  if (days < 0) return "text-red-600 font-semibold";
  if (days <= 30) return "text-red-500";
  if (days <= 90) return "text-yellow-600";
  return "text-muted-foreground";
}

function subleaseMonthlyIncome(s: SubleaseListItem): number {
  return (
    s.base_rent_monthly +
    s.cam_recovery_monthly +
    s.insurance_recovery_monthly +
    s.property_tax_recovery_monthly +
    s.utilities_recovery_monthly +
    s.other_recovery_monthly
  );
}

function urgencyBadge(days: number) {
  if (days < 0)
    return <Badge variant="destructive">Overdue</Badge>;
  if (days <= 30)
    return <Badge variant="destructive">{days}d</Badge>;
  if (days <= 90)
    return (
      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
        {days}d
      </Badge>
    );
  return <Badge variant="outline">{days}d</Badge>;
}

// --- Component ---

export default function RealEstatePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [leases, setLeases] = useState<LeaseListItem[]>([]);
  const [subleases, setSubleases] = useState<SubleaseListItem[]>([]);
  const [criticalDates, setCriticalDates] = useState<CriticalDateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    const leasesQuery = supabase
      .from("leases")
      .select(
        `id, lease_name, status, lease_type, lessor_name,
        commencement_date, expiration_date, lease_term_months,
        base_rent_monthly, cam_monthly, insurance_monthly,
        property_tax_annual, utilities_monthly, other_monthly_costs,
        discount_rate, initial_direct_costs, lease_incentives_received, prepaid_rent,
        properties(property_name, rentable_square_footage)`
      )
      .eq("entity_id", entityId)
      .order("lease_name");

    const datesQuery = supabase
      .from("lease_critical_dates")
      .select(
        `id, date_type, critical_date, description, alert_days_before, is_resolved, lease_id,
        leases(lease_name)`
      )
      .eq("is_resolved", false)
      .order("critical_date");

    const subleasesQuery = supabase
      .from("subleases")
      .select(
        `id, lease_id, sublease_name, subtenant_name, status,
        commencement_date, expiration_date, sublease_term_months,
        base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly,
        property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly,
        subleased_square_footage,
        leases(lease_name)`
      )
      .eq("entity_id", entityId)
      .order("sublease_name");

    const leasesResult = await leasesQuery;
    const datesResult = await datesQuery;
    const subleasesResult = await subleasesQuery;

    setLeases((leasesResult.data as unknown as LeaseListItem[]) ?? []);
    setSubleases((subleasesResult.data as unknown as SubleaseListItem[]) ?? []);
    setCriticalDates((datesResult.data as unknown as CriticalDateItem[]) ?? []);
    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered leases
  const filteredLeases = leases.filter((l) => {
    if (statusFilter && statusFilter !== "all" && l.status !== statusFilter)
      return false;
    if (typeFilter && typeFilter !== "all" && l.lease_type !== typeFilter)
      return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = l.lease_name.toLowerCase();
    const lessor = (l.lessor_name ?? "").toLowerCase();
    const property = (l.properties?.property_name ?? "").toLowerCase();
    return name.includes(q) || lessor.includes(q) || property.includes(q);
  });

  const activeLeases = leases.filter((l) => l.status === "active");
  const totalMonthly = activeLeases.reduce((s, l) => s + totalMonthlyCost(l), 0);
  const totalAnnual = totalMonthly * 12;
  const totalSF = activeLeases.reduce(
    (s, l) => s + (l.properties?.rentable_square_footage ?? 0),
    0
  );
  const avgCostPerSF = totalSF > 0 ? totalAnnual / totalSF : 0;

  // Sublease income totals
  const activeSubleases = subleases.filter((s) => s.status === "active");
  const totalSubleaseMonthlyIncome = activeSubleases.reduce(
    (s, sub) => s + subleaseMonthlyIncome(sub),
    0
  );
  const totalSubleaseAnnualIncome = totalSubleaseMonthlyIncome * 12;
  const netMonthly = totalMonthly - totalSubleaseMonthlyIncome;

  // Critical dates within alertable range
  const upcomingDates = criticalDates.filter((cd) => {
    const days = daysUntil(cd.critical_date);
    return days <= cd.alert_days_before;
  });

  // ASC 842 portfolio summary (active leases with discount rate)
  const asc842Summary = useMemo(() => {
    let totalLiability = 0;
    let totalROU = 0;
    let leasesWithRate = 0;

    for (const l of activeLeases) {
      if (l.discount_rate > 0 && l.lease_term_months > 0) {
        const input = {
          lease_type: l.lease_type as "operating" | "finance",
          lease_term_months: l.lease_term_months,
          discount_rate: l.discount_rate,
          commencement_date: l.commencement_date,
          initial_direct_costs: l.initial_direct_costs,
          lease_incentives_received: l.lease_incentives_received,
          prepaid_rent: l.prepaid_rent,
          base_rent_monthly: l.base_rent_monthly,
        };
        totalLiability += calculateLeaseLiability(input);
        totalROU += calculateROUAsset(input);
        leasesWithRate++;
      }
    }
    return { totalLiability, totalROU, leasesWithRate };
  }, [activeLeases]);

  // Lease expiration timeline (sorted by expiration date)
  const expirationTimeline = [...activeLeases].sort(
    (a, b) =>
      new Date(a.expiration_date).getTime() -
      new Date(b.expiration_date).getTime()
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Real Estate
          </h1>
          <p className="text-muted-foreground">
            Manage leases, operating costs, and property portfolio
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${entityId}/real-estate/from-pdf`}>
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              From PDF
            </Button>
          </Link>
          <Link href={`/${entityId}/real-estate/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Lease
            </Button>
          </Link>
        </div>
      </div>

      {/* Critical Dates Alert Banner */}
      {upcomingDates.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <CardTitle className="text-base text-yellow-800">
                Upcoming Critical Dates ({upcomingDates.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcomingDates.slice(0, 5).map((cd) => {
                const days = daysUntil(cd.critical_date);
                return (
                  <div
                    key={cd.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-3">
                      {urgencyBadge(days)}
                      <span className={urgencyColor(days)}>
                        {new Date(
                          cd.critical_date + "T00:00:00"
                        ).toLocaleDateString()}
                      </span>
                      <span className="font-medium">
                        {DATE_TYPE_LABELS[cd.date_type]}
                      </span>
                      <span className="text-muted-foreground">
                        — {cd.leases?.lease_name ?? "Unknown Lease"}
                      </span>
                    </div>
                    <Link href={`/${entityId}/real-estate/${cd.lease_id}`}>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </Link>
                  </div>
                );
              })}
              {upcomingDates.length > 5 && (
                <p className="text-xs text-muted-foreground pt-1">
                  + {upcomingDates.length - 5} more upcoming dates
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active Leases</p>
            <p className="text-2xl font-semibold tabular-nums">
              {activeLeases.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Monthly Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalMonthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sublease Income</p>
            <p className="text-2xl font-semibold tabular-nums text-green-600">
              {totalSubleaseMonthlyIncome > 0
                ? formatCurrency(totalSubleaseMonthlyIncome)
                : "---"}
            </p>
            {activeSubleases.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {activeSubleases.length} active sublease{activeSubleases.length !== 1 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className={netMonthly < totalMonthly && totalSubleaseMonthlyIncome > 0 ? "border-green-200" : ""}>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net Monthly Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(netMonthly)}
            </p>
            {totalSubleaseMonthlyIncome > 0 && (
              <p className="text-xs text-green-600 mt-1">
                {((totalSubleaseMonthlyIncome / totalMonthly) * 100).toFixed(0)}% offset by subleases
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Annual Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalAnnual)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Cost / SF</p>
            <p className="text-2xl font-semibold tabular-nums">
              {totalSF > 0 ? formatCurrency(avgCostPerSF) : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total ROU Assets</p>
            <p className="text-2xl font-semibold tabular-nums">
              {asc842Summary.leasesWithRate > 0
                ? formatCurrency(asc842Summary.totalROU)
                : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Lease Liability</p>
            <p className="text-2xl font-semibold tabular-nums">
              {asc842Summary.leasesWithRate > 0
                ? formatCurrency(asc842Summary.totalLiability)
                : "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="leases" className="space-y-4">
        <TabsList>
          <TabsTrigger value="leases">Leases</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="dates">
            Critical Dates
            {criticalDates.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5">
                {criticalDates.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* === Leases Tab === */}
        <TabsContent value="leases">
          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by lease, lessor, or property..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="operating">Operating</SelectItem>
                <SelectItem value="finance">Finance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="pt-6">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredLeases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Building className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Leases Found</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    {searchQuery ||
                    statusFilter !== "active" ||
                    typeFilter !== "all"
                      ? "No leases match your current filters."
                      : "Add your first lease to start tracking real estate."}
                  </p>
                  {!searchQuery &&
                    statusFilter === "active" &&
                    typeFilter === "all" && (
                      <Link href={`/${entityId}/real-estate/new`}>
                        <Button>
                          <Plus className="mr-2 h-4 w-4" />
                          New Lease
                        </Button>
                      </Link>
                    )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Property</TableHead>
                        <TableHead>Lease Name</TableHead>
                        <TableHead>Lessor</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Commencement</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead className="text-right">
                          Monthly Rent
                        </TableHead>
                        <TableHead className="text-right">
                          Total Monthly
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeases.map((lease) => (
                        <TableRow key={lease.id}>
                          <TableCell className="font-medium">
                            {lease.properties?.property_name ?? "---"}
                          </TableCell>
                          <TableCell>{lease.lease_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {lease.lessor_name ?? "---"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {TYPE_LABELS[lease.lease_type]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(
                              lease.commencement_date + "T00:00:00"
                            ).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(
                              lease.expiration_date + "T00:00:00"
                            ).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(lease.base_rent_monthly)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatCurrency(totalMonthlyCost(lease))}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                STATUS_VARIANTS[lease.status] ?? "outline"
                              }
                            >
                              {STATUS_LABELS[lease.status] ?? lease.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/${entityId}/real-estate/${lease.id}`}
                            >
                              <Button variant="ghost" size="sm">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell colSpan={6}>
                          Totals ({filteredLeases.length} lease
                          {filteredLeases.length !== 1 ? "s" : ""})
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            filteredLeases.reduce(
                              (s, l) => s + l.base_rent_monthly,
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            filteredLeases.reduce(
                              (s, l) => s + totalMonthlyCost(l),
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Analytics Tab === */}
        <TabsContent value="analytics">
          <div className="space-y-6">
            {/* Lease Expiration Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Lease Expiration Timeline</CardTitle>
                <CardDescription>
                  Active leases sorted by expiration date
                </CardDescription>
              </CardHeader>
              <CardContent>
                {expirationTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lease</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead>Remaining</TableHead>
                        <TableHead className="text-right">
                          Monthly Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Remaining Cost
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expirationTimeline.map((lease) => {
                        const days = daysUntil(lease.expiration_date);
                        const monthsRemaining = Math.max(
                          0,
                          Math.ceil(days / 30.44)
                        );
                        const remainingCost =
                          totalMonthlyCost(lease) * monthsRemaining;
                        return (
                          <TableRow key={lease.id}>
                            <TableCell className="font-medium">
                              {lease.lease_name}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {lease.properties?.property_name ?? "---"}
                            </TableCell>
                            <TableCell className={urgencyColor(days)}>
                              {new Date(
                                lease.expiration_date + "T00:00:00"
                              ).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {days < 0 ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : days <= 180 ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-yellow-100 text-yellow-800"
                                >
                                  {monthsRemaining} mo
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">
                                  {monthsRemaining} mo
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(totalMonthlyCost(lease))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(remainingCost)}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/${entityId}/real-estate/${lease.id}`}
                              >
                                <Button variant="ghost" size="sm">
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Lifetime Cost Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Lifetime Cost Analysis</CardTitle>
                <CardDescription>
                  Total estimated cost over the full lease term for each active
                  lease
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeLeases.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lease</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Term</TableHead>
                        <TableHead className="text-right">
                          Monthly Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Lifetime Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Lease Liability
                        </TableHead>
                        <TableHead className="text-right">
                          ROU Asset
                        </TableHead>
                        <TableHead className="text-right">
                          Discount Rate
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeLeases.map((lease) => {
                        const liability =
                          lease.discount_rate > 0
                            ? calculateLeaseLiability({
                                lease_type: lease.lease_type as "operating" | "finance",
                                lease_term_months: lease.lease_term_months,
                                discount_rate: lease.discount_rate,
                                commencement_date: lease.commencement_date,
                                initial_direct_costs:
                                  lease.initial_direct_costs,
                                lease_incentives_received:
                                  lease.lease_incentives_received,
                                prepaid_rent: lease.prepaid_rent,
                                base_rent_monthly: lease.base_rent_monthly,
                              })
                            : 0;
                        const rou =
                          lease.discount_rate > 0
                            ? calculateROUAsset({
                                lease_type: lease.lease_type as "operating" | "finance",
                                lease_term_months: lease.lease_term_months,
                                discount_rate: lease.discount_rate,
                                commencement_date: lease.commencement_date,
                                initial_direct_costs:
                                  lease.initial_direct_costs,
                                lease_incentives_received:
                                  lease.lease_incentives_received,
                                prepaid_rent: lease.prepaid_rent,
                                base_rent_monthly: lease.base_rent_monthly,
                              })
                            : 0;
                        return (
                          <TableRow key={lease.id}>
                            <TableCell className="font-medium">
                              {lease.lease_name}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {TYPE_LABELS[lease.lease_type]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {lease.lease_term_months} mo
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(totalMonthlyCost(lease))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(totalLifetimeCost(lease))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {liability > 0
                                ? formatCurrency(liability)
                                : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {rou > 0 ? formatCurrency(rou) : "---"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {lease.discount_rate > 0
                                ? formatPercentage(lease.discount_rate)
                                : "---"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell colSpan={3}>Portfolio Totals</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalMonthly)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            activeLeases.reduce(
                              (s, l) => s + totalLifetimeCost(l),
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {asc842Summary.totalLiability > 0
                            ? formatCurrency(asc842Summary.totalLiability)
                            : "---"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {asc842Summary.totalROU > 0
                            ? formatCurrency(asc842Summary.totalROU)
                            : "---"}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Cost Breakdown by Type */}
            <Card>
              <CardHeader>
                <CardTitle>Occupancy Cost Breakdown</CardTitle>
                <CardDescription>
                  Monthly cost by category across all active leases
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeLeases.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No active leases.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Monthly</TableHead>
                        <TableHead className="text-right">Annual</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const totals = {
                          "Base Rent": activeLeases.reduce(
                            (s, l) => s + l.base_rent_monthly,
                            0
                          ),
                          CAM: activeLeases.reduce(
                            (s, l) => s + l.cam_monthly,
                            0
                          ),
                          Insurance: activeLeases.reduce(
                            (s, l) => s + l.insurance_monthly,
                            0
                          ),
                          "Property Tax": activeLeases.reduce(
                            (s, l) => s + l.property_tax_annual / 12,
                            0
                          ),
                          Utilities: activeLeases.reduce(
                            (s, l) => s + l.utilities_monthly,
                            0
                          ),
                          Other: activeLeases.reduce(
                            (s, l) => s + l.other_monthly_costs,
                            0
                          ),
                        };
                        return Object.entries(totals)
                          .filter(([, v]) => v > 0)
                          .map(([label, monthly]) => (
                            <TableRow key={label}>
                              <TableCell className="font-medium">
                                {label}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(monthly)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(monthly * 12)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {totalMonthly > 0
                                  ? `${((monthly / totalMonthly) * 100).toFixed(1)}%`
                                  : "---"}
                              </TableCell>
                            </TableRow>
                          ));
                      })()}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Gross Occupancy Cost</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalMonthly)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(totalAnnual)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          100.0%
                        </TableCell>
                      </TableRow>
                      {totalSubleaseMonthlyIncome > 0 && (
                        <>
                          <TableRow className="text-green-600">
                            <TableCell className="font-medium">Less: Sublease Income</TableCell>
                            <TableCell className="text-right tabular-nums">
                              ({formatCurrency(totalSubleaseMonthlyIncome)})
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              ({formatCurrency(totalSubleaseAnnualIncome)})
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {totalMonthly > 0
                                ? `-${((totalSubleaseMonthlyIncome / totalMonthly) * 100).toFixed(1)}%`
                                : "---"}
                            </TableCell>
                          </TableRow>
                          <TableRow className="font-semibold border-t-2">
                            <TableCell>Net Occupancy Cost</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(netMonthly)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(netMonthly * 12)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {totalMonthly > 0
                                ? `${((netMonthly / totalMonthly) * 100).toFixed(1)}%`
                                : "---"}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Critical Dates Tab === */}
        <TabsContent value="dates">
          <Card>
            <CardHeader>
              <CardTitle>All Open Critical Dates</CardTitle>
              <CardDescription>
                Unresolved dates across all leases, sorted by urgency
              </CardDescription>
            </CardHeader>
            <CardContent>
              {criticalDates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No open critical dates.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Urgency</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Lease</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criticalDates.map((cd) => {
                      const days = daysUntil(cd.critical_date);
                      return (
                        <TableRow key={cd.id}>
                          <TableCell>{urgencyBadge(days)}</TableCell>
                          <TableCell className={urgencyColor(days)}>
                            {new Date(
                              cd.critical_date + "T00:00:00"
                            ).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {DATE_TYPE_LABELS[cd.date_type]}
                          </TableCell>
                          <TableCell className="font-medium">
                            {cd.leases?.lease_name ?? "---"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {cd.description ?? "---"}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/${entityId}/real-estate/${cd.lease_id}`}
                            >
                              <Button variant="ghost" size="sm">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
