"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingUp,
  Layers,
  FileText,
  RefreshCw,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Activity,
  Save,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import {
  EQUIPMENT_TYPE_LABELS,
  processRevenueData,
  type RevenueProjectionResponse,
  type ClosedInvoice,
  type MonthlyRevenue,
  type DateMode,
  type RWInvoiceRow,
  type RWOrderRow,
  type RWQuoteRow,
} from "@/lib/utils/revenue-projection";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";

// ─── Snapshot Row Type ──────────────────────────────────────────────────────

interface SnapshotRow {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  section_id: string;
  projected_amount: number;
  snapshot_date: string;
  source: string;
  created_by: string;
  created_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EQUIP_COLORS: Record<string, string> = {
  vehicle: "#2563eb",
  grip_lighting: "#16a34a",
  studio: "#ea580c",
  pro_supplies: "#9333ea",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const REVENUE_SERIES: { key: string; label: string; color: string }[] = [
  { key: "closed", label: "Recognized", color: "#2563eb" },
  { key: "pending", label: "Pending", color: "#f59e0b" },
  { key: "pipeline", label: "Pipeline", color: "#94a3b8" },
  { key: "forecast", label: "Forecast", color: "#ea580c" },
];

function AccrualDeferralTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; payload: MonthlyRevenue }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-blue-500" />
          <span className="text-gray-500">Billed</span>
        </div>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(row.billed)}</span>
      </div>
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-emerald-500" />
          <span className="text-gray-500">Earned</span>
        </div>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(row.earned)}</span>
      </div>
      {row.accrued > 0 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-teal-500" />
            <span className="text-gray-500">Accrued Revenue</span>
          </div>
          <span className="font-medium tabular-nums text-teal-700">{formatCurrency(row.accrued)}</span>
        </div>
      )}
      {row.deferred > 0 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 bg-amber-500" />
            <span className="text-gray-500">Deferred Revenue</span>
          </div>
          <span className="font-medium tabular-nums text-amber-700">{formatCurrency(row.deferred)}</span>
        </div>
      )}
    </div>
  );
}

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload
    .filter((p) => p.dataKey !== "forecast")
    .reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
      {payload.map((entry) => {
        const series = REVENUE_SERIES.find((s) => s.key === entry.dataKey);
        if (!series || !entry.value) return null;
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: series.color }} />
              <span className="text-gray-500">{series.label}</span>
            </div>
            <span className="font-medium tabular-nums text-gray-900">{formatCurrency(entry.value)}</span>
          </div>
        );
      })}
      {payload.filter((p) => p.dataKey !== "forecast" && p.value).length > 1 && (
        <div className="flex items-center justify-between gap-8 border-t border-gray-200 mt-1.5 pt-1.5 font-medium text-gray-900">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}

function EquipmentTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { type: string; percentage: number } }> }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm whitespace-nowrap" style={{ zIndex: 50 }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: EQUIP_COLORS[entry.payload.type] || "#6b7280" }} />
        <span className="font-semibold text-gray-900">{entry.name}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-gray-500">Revenue</span>
        <span className="font-medium tabular-nums text-gray-900">{formatCurrency(entry.value)}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-gray-500">Share</span>
        <span className="font-medium tabular-nums text-gray-900">{entry.payload.percentage.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RevenueProjectionPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  // Raw rows from the API — cached so we can re-process client-side on mode change
  const [rawInvoices, setRawInvoices] = useState<RWInvoiceRow[] | null>(null);
  const [rawOrders, setRawOrders] = useState<RWOrderRow[] | null>(null);
  const [rawQuotes, setRawQuotes] = useState<RWQuoteRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("billing_date");
  const [invoiceMonthFilter, setInvoiceMonthFilter] = useState<string>("all");
  const [chartDrillDown, setChartDrillDown] = useState<{ month: string; label: string; category: "closed" | "pending" | "pipeline" } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/revenue-projection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const result = await res.json();
      setRawInvoices(result._rawInvoices);
      setRawOrders(result._rawOrders);
      setRawQuotes(result._rawQuotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleDateModeChange = (mode: DateMode) => {
    setDateMode(mode);
    setChartDrillDown(null);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // Derive processed data client-side — instant on date mode switch
  const data = useMemo(() => {
    if (!rawInvoices || !rawOrders || !rawQuotes) return null;
    return processRevenueData(rawInvoices, rawOrders, rawQuotes, dateMode);
  }, [rawInvoices, rawOrders, rawQuotes, dateMode]);

  // Accruals tab always uses invoice_date mode
  const accrualData = useMemo(() => {
    if (!rawInvoices || !rawOrders || !rawQuotes) return null;
    if (dateMode === "invoice_date") return data;
    return processRevenueData(rawInvoices, rawOrders, rawQuotes, "invoice_date");
  }, [rawInvoices, rawOrders, rawQuotes, dateMode, data]);

  // Derive unique months from invoices for filter dropdown
  // In rental_period mode, include all months that any invoice spans via allocations
  const invoiceMonths = useMemo(() => {
    if (!data) return [];
    const monthSet = new Map<string, string>();
    const toLabel = (mk: string) =>
      mk.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => {
        const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${names[Number(m) - 1]} ${y}`;
      });
    for (const inv of data.closedInvoices) {
      // Add all allocation months if present
      if (inv.allocations) {
        for (const alloc of inv.allocations) {
          if (!monthSet.has(alloc.month)) {
            monthSet.set(alloc.month, toLabel(alloc.month));
          }
        }
      } else if (inv.month && !monthSet.has(inv.month)) {
        monthSet.set(inv.month, toLabel(inv.month));
      }
    }
    return Array.from(monthSet.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([key, label]) => ({ key, label }));
  }, [data]);

  // Filter invoices — in rental_period mode, include invoices that have
  // allocations touching the selected month
  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    if (invoiceMonthFilter === "all") return data.closedInvoices;
    return data.closedInvoices.filter((inv) => {
      if (inv.allocations) {
        return inv.allocations.some((a) => a.month === invoiceMonthFilter);
      }
      return inv.month === invoiceMonthFilter;
    });
  }, [data, invoiceMonthFilter]);

  // Group filtered invoices by customer
  const customerGroups = useMemo(() => {
    const groups = new Map<string, { customer: string; invoices: ClosedInvoice[]; totalRevenue: number; totalAllocated: number }>();
    const showAllocation = dateMode === "rental_period" && invoiceMonthFilter !== "all";
    for (const inv of filteredInvoices) {
      const key = inv.customer || "Unknown";
      if (!groups.has(key)) {
        groups.set(key, { customer: key, invoices: [], totalRevenue: 0, totalAllocated: 0 });
      }
      const g = groups.get(key)!;
      g.invoices.push(inv);
      g.totalRevenue += inv.subTotal;
      if (showAllocation) {
        const alloc = inv.allocations?.find((a) => a.month === invoiceMonthFilter);
        g.totalAllocated += alloc ? alloc.amount : inv.subTotal;
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aVal = showAllocation ? b.totalAllocated : b.totalRevenue;
      const bVal = showAllocation ? a.totalAllocated : a.totalRevenue;
      return aVal - bVal;
    });
  }, [filteredInvoices, dateMode, invoiceMonthFilter]);

  // Drill-down data for chart click
  const drillDownItems = useMemo(() => {
    if (!chartDrillDown || !data) return { invoices: [], orders: [] };
    const { month, category } = chartDrillDown;
    if (category === "pipeline") {
      // Match the same date logic the chart uses for pipeline allocation
      const toMonthKey = (dateStr: string) => {
        if (!dateStr) return "";
        // Handle ISO "2026-03-01" format
        const iso = dateStr.match(/^(\d{4})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}`;
        // Handle US "03/01/2026" format
        const us = dateStr.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
        if (us) return `${us[2]}-${String(us[1]).padStart(2, "0")}`;
        return "";
      };
      const orderMatchesMonth = (o: typeof data.pipelineOrders[number]) => {
        if (dateMode === "rental_period" && o.estimatedStartDate && o.estimatedStopDate) {
          const start = new Date(o.estimatedStartDate);
          const end = new Date(o.estimatedStopDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return toMonthKey(o.orderDate) === month;
          }
          const [y, m] = month.split("-").map(Number);
          const monthStart = new Date(y, m - 1, 1);
          const monthEnd = new Date(y, m, 0);
          return start <= monthEnd && end >= monthStart;
        } else if (dateMode === "billing_date" && o.estimatedStartDate) {
          return toMonthKey(o.estimatedStopDate || o.estimatedStartDate) === month;
        } else {
          return toMonthKey(o.orderDate) === month;
        }
      };
      const orders = data.pipelineOrders.filter(orderMatchesMonth);
      return { invoices: [], orders };
    }
    // Closed or pending — filter invoices by status and month
    const statusSet = category === "closed"
      ? new Set(["CLOSED", "PROCESSED"])
      : new Set(["NEW", "APPROVED"]);
    const invoices = data.closedInvoices.filter((inv) => {
      if (!statusSet.has(inv.status)) return false;
      if (dateMode === "rental_period") {
        if (inv.allocations) {
          return inv.allocations.some((a) => a.month === month);
        }
        return inv.month === month;
      }
      return inv.month === month;
    });
    return { invoices, orders: [] };
  }, [chartDrillDown, data, dateMode]);

  const handleBarClick = useCallback((category: "closed" | "pending" | "pipeline") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (barData: any) => {
      const payload = barData?.payload as MonthlyRevenue | undefined;
      if (!payload?.month) return;
      setChartDrillDown((prev) => {
        if (prev && prev.month === payload.month && prev.category === category) return null;
        return { month: payload.month, label: payload.label || payload.month, category };
      });
    };
  }, []);

  // Snapshot / Trends state
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const now = new Date();
      const res = await fetch(
        `/api/revenue-projections/snapshot?entityId=${entityId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`
      );
      if (res.ok) {
        const json = await res.json();
        setSnapshots(json.snapshots ?? []);
      }
    } catch {
      // non-fatal
    } finally {
      setSnapshotsLoading(false);
    }
  }, [entityId]);

  const saveSnapshot = useCallback(async () => {
    if (!data) return;
    setSavingSnapshot(true);
    try {
      const now = new Date();
      const res = await fetch("/api/revenue-projections/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: now.getFullYear(),
          periodMonth: now.getMonth() + 1,
          projections: [
            { sectionId: "revenue", amount: data.currentMonthProjected },
            { sectionId: "pipeline", amount: data.pipelineValue },
            { sectionId: "ytd", amount: data.ytdRevenue },
          ],
          source: "manual",
        }),
      });
      if (res.ok) {
        toast.success("Snapshot saved for today");
        fetchSnapshots();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save snapshot");
      }
    } catch {
      toast.error("Failed to save snapshot");
    } finally {
      setSavingSnapshot(false);
    }
  }, [data, entityId, fetchSnapshots]);

  // Fetch snapshots on mount
  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  // Reset expanded state when filter changes
  useEffect(() => {
    setExpandedCustomers(new Set());
  }, [invoiceMonthFilter, dateMode]);

  const toggleCustomer = useCallback((customer: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customer)) next.delete(customer);
      else next.add(customer);
      return next;
    });
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Revenue Projection</h1>
            <p className="text-muted-foreground text-sm">
              Loading RentalWorks data...
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-[400px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Revenue Projection</h1>
            <p className="text-destructive text-sm">{error}</p>
          </div>
          <Button onClick={() => fetchData()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revenue Projection</h1>
          <p className="text-muted-foreground text-sm">
            Versatile — RentalWorks invoices, orders & quotes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-muted inline-flex items-center rounded-lg p-1">
            <button
              onClick={() => handleDateModeChange("invoice_date")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                dateMode === "invoice_date"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Invoice Date
            </button>
            <button
              onClick={() => handleDateModeChange("billing_date")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                dateMode === "billing_date"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Billing Date
            </button>
            <button
              onClick={() => handleDateModeChange("rental_period")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                dateMode === "rental_period"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Rental Period
            </button>
          </div>
          <Button
            onClick={saveSnapshot}
            variant="outline"
            size="sm"
            disabled={savingSnapshot || !data}
          >
            {savingSnapshot ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Snapshot
          </Button>
          <Button
            onClick={() => fetchData()}
            variant="outline"
            size="sm"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <KPICard
          title="YTD Revenue"
          value={formatCurrency(data.ytdRevenue)}
          description="Closed invoices this year"
          icon={<DollarSign className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Current Month"
          value={formatCurrency(data.currentMonthActual)}
          description={`Projected: ${formatCurrency(data.currentMonthProjected)}`}
          icon={<TrendingUp className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(data.pipelineValue)}
          description={`${data.pipelineOrders.length} open orders`}
          icon={<Layers className="text-muted-foreground h-4 w-4" />}
        />
        <KPICard
          title="Quote Opportunities"
          value={formatCurrency(data.quoteOpportunities)}
          description={`${data.pipelineQuotes.length} active quotes`}
          icon={<FileText className="text-muted-foreground h-4 w-4" />}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices ({data.closedInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            Pipeline ({data.pipelineOrders.length})
          </TabsTrigger>
          <TabsTrigger value="quotes">
            Quotes ({data.pipelineQuotes.length})
          </TabsTrigger>
          <TabsTrigger value="insights">
            <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="trends">
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="accruals">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            Accruals
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Revenue</CardTitle>
              <CardDescription>
                12-month history + 3-month forecast (6-month moving average)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart
                  data={data.monthlyData}
                  margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="label"
                    className="text-xs"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    tickFormatter={formatCompact}
                    className="text-xs"
                    tick={{ fontSize: 12 }}
                  />
                  <RechartsTooltip
                    content={<RevenueTooltip />}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                  />
                  <Legend />
                  <Bar
                    dataKey="closed"
                    name="Recognized"
                    fill="#2563eb"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("closed")}
                  />
                  <Bar
                    dataKey="pending"
                    name="Pending"
                    fill="#f59e0b"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("pending")}
                  />
                  <Bar
                    dataKey="pipeline"
                    name="Pipeline"
                    fill="#94a3b8"
                    stackId="a"
                    radius={[2, 2, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick("pipeline")}
                  />
                  <Line
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#ea580c"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart Drill-Down Panel */}
          {chartDrillDown && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{
                          backgroundColor:
                            chartDrillDown.category === "closed" ? "#2563eb"
                            : chartDrillDown.category === "pending" ? "#f59e0b"
                            : "#94a3b8",
                        }}
                      />
                      {chartDrillDown.label} —{" "}
                      {chartDrillDown.category === "closed" ? "Recognized"
                        : chartDrillDown.category === "pending" ? "Pending"
                        : "Pipeline"}
                    </CardTitle>
                    <CardDescription>
                      {chartDrillDown.category === "pipeline"
                        ? `${drillDownItems.orders.length} open orders`
                        : `${drillDownItems.invoices.length} invoices`}
                      {" — "}
                      {formatCurrency(
                        chartDrillDown.category === "pipeline"
                          ? drillDownItems.orders.reduce((s, o) => s + o.total, 0)
                          : drillDownItems.invoices.reduce((s, i) => s + i.subTotal, 0),
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChartDrillDown(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {chartDrillDown.category === "pipeline" ? (
                  drillDownItems.orders.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">No orders for this month.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Deal</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Order Date</TableHead>
                            <TableHead>Rental Period</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillDownItems.orders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="font-medium">{order.orderNumber}</TableCell>
                              <TableCell>{order.customer}</TableCell>
                              <TableCell className="max-w-[150px] truncate">{order.deal}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{order.description}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(order.orderDate)}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {order.estimatedStartDate ? `${formatDate(order.estimatedStartDate)} – ${formatDate(order.estimatedStopDate)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.total)}</TableCell>
                              <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                              <TableCell><Badge variant="secondary">{EQUIPMENT_TYPE_LABELS[order.equipmentType] || order.equipmentType}</Badge></TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell colSpan={6}>Total ({drillDownItems.orders.length} orders)</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.orders.reduce((s, o) => s + o.total, 0))}</TableCell>
                            <TableCell colSpan={2} />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )
                ) : (
                  drillDownItems.invoices.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">No invoices for this month.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Order / Description</TableHead>
                            <TableHead>Invoice Date</TableHead>
                            <TableHead>Billing Period</TableHead>
                            <TableHead className="text-right">Subtotal</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillDownItems.invoices.map((inv) => (
                            <TableRow key={inv.invoiceId}>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  {inv.invoiceNumber}
                                  {inv.status !== "CLOSED" && inv.status !== "PROCESSED" && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{inv.status}</Badge>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell>{inv.customer}</TableCell>
                              <TableCell className="max-w-[200px] truncate">{inv.orderDescription || inv.orderNumber}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(inv.invoiceDate)}</TableCell>
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {inv.billingStartDate ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(inv.subTotal)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(inv.tax)}</TableCell>
                              <TableCell className="text-right tabular-nums font-medium">{formatCurrency(inv.grossTotal)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell colSpan={5}>Total ({drillDownItems.invoices.length} invoices)</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.subTotal, 0))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.tax, 0))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(drillDownItems.invoices.reduce((s, i) => s + i.grossTotal, 0))}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          )}

          {/* Accrued & Deferred Revenue Chart */}
          {data.monthlyData.some((m) => m.accrued > 0 || m.deferred > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Accrued & Deferred Revenue</CardTitle>
                <CardDescription>
                  Monthly difference between earned revenue (by rental period) and billed revenue (by invoice date)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart
                    data={data.monthlyData.map((m) => ({
                      ...m,
                      // Show deferred as negative for diverging bar chart
                      deferredNeg: m.deferred > 0 ? -m.deferred : 0,
                    }))}
                    margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatCompact} className="text-xs" tick={{ fontSize: 12 }} />
                    <RechartsTooltip
                      content={<AccrualDeferralTooltip />}
                      allowEscapeViewBox={{ x: true, y: true }}
                      wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                    <Bar dataKey="accrued" name="Accrued" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="deferredNeg" name="Deferred" fill="#f59e0b" radius={[0, 0, 3, 3]} />
                    <Line dataKey="billed" name="Billed" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line dataKey="earned" name="Earned" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Equipment Breakdown */}
          {data.equipmentBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by Equipment Type</CardTitle>
                <CardDescription>YTD closed invoice breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-6 md:flex-row">
                  <div className="w-full md:w-1/2">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.equipmentBreakdown}
                          dataKey="amount"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={110}
                        >
                          {data.equipmentBreakdown.map((entry) => (
                            <Cell
                              key={entry.type}
                              fill={EQUIP_COLORS[entry.type] || "#6b7280"}
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={<EquipmentTooltip />}
                          allowEscapeViewBox={{ x: true, y: true }}
                          wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full space-y-3 md:w-1/2">
                    {data.equipmentBreakdown.map((entry) => (
                      <div
                        key={entry.type}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor:
                                EQUIP_COLORS[entry.type] || "#6b7280",
                            }}
                          />
                          <span className="text-sm font-medium">
                            {entry.label}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatCurrency(entry.amount)}
                          </span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({entry.percentage.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Invoices</CardTitle>
                  <CardDescription>
                    Revenue grouped by{" "}
                    {dateMode === "invoice_date"
                      ? "invoice date"
                      : dateMode === "rental_period"
                        ? "rental period (pro-rata)"
                        : "rental billing date"}
                  </CardDescription>
                </div>
                {invoiceMonths.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setInvoiceMonthFilter("all")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        invoiceMonthFilter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All
                    </button>
                    {invoiceMonths.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setInvoiceMonthFilter(key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          invoiceMonthFilter === key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {filteredInvoices.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No invoices found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  {(() => {
                    const showAllocation = dateMode === "rental_period" && invoiceMonthFilter !== "all";
                    const getAlloc = (inv: ClosedInvoice) =>
                      inv.allocations?.find((a) => a.month === invoiceMonthFilter);
                    return (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Invoices</TableHead>
                            {showAllocation ? (
                              <>
                                <TableHead className="text-right">Invoice Total</TableHead>
                                <TableHead className="text-right">Allocated</TableHead>
                              </>
                            ) : (
                              <>
                                <TableHead className="text-right">Revenue</TableHead>
                                <TableHead className="text-right">Tax</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerGroups.map((group) => {
                            const isExpanded = expandedCustomers.has(group.customer);
                            const groupTax = group.invoices.reduce((s, i) => s + i.tax, 0);
                            const groupGross = group.invoices.reduce((s, i) => s + i.grossTotal, 0);
                            return (
                              <React.Fragment key={group.customer}>
                                <TableRow
                                  className="hover:bg-muted/50 cursor-pointer"
                                  onClick={() => toggleCustomer(group.customer)}
                                >
                                  <TableCell className="w-8 px-2">
                                    <ChevronRight
                                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                                        isExpanded ? "rotate-90" : ""
                                      }`}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {group.customer}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-right tabular-nums">
                                    {group.invoices.length}
                                  </TableCell>
                                  {showAllocation ? (
                                    <>
                                      <TableCell className="text-muted-foreground text-right tabular-nums">
                                        {formatCurrency(group.totalRevenue)}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {formatCurrency(group.totalAllocated)}
                                      </TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {formatCurrency(group.totalRevenue)}
                                      </TableCell>
                                      <TableCell className="text-muted-foreground text-right tabular-nums">
                                        {formatCurrency(groupTax)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {formatCurrency(groupGross)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                                {isExpanded && group.invoices.map((inv) => {
                                  const alloc = showAllocation ? getAlloc(inv) : null;
                                  return (
                                    <TableRow key={inv.invoiceId} className="bg-muted/30">
                                      <TableCell />
                                      <TableCell className="pl-8" colSpan={showAllocation ? 1 : 1}>
                                        <div className="flex flex-col gap-0.5">
                                          <span className="flex items-center gap-1.5 text-sm font-medium">
                                            {inv.invoiceNumber}
                                            {inv.status && inv.status !== "CLOSED" && inv.status !== "PROCESSED" && (
                                              <Badge variant={inv.status === "APPROVED" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">
                                                {inv.status}
                                              </Badge>
                                            )}
                                          </span>
                                          <span className="text-muted-foreground max-w-[260px] truncate text-xs">
                                            {inv.orderDescription || inv.orderNumber}
                                          </span>
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex flex-col gap-0.5 text-xs">
                                          <span className="text-muted-foreground whitespace-nowrap">
                                            {formatDate(inv.invoiceDate)}
                                          </span>
                                          {(inv.billingStartDate || inv.billingEndDate) && (
                                            <span className="text-muted-foreground whitespace-nowrap">
                                              {formatDate(inv.billingStartDate)} – {formatDate(inv.billingEndDate)}
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                      {showAllocation ? (
                                        <>
                                          <TableCell className="text-muted-foreground text-right tabular-nums text-sm">
                                            {formatCurrency(inv.subTotal)}
                                            {alloc && (
                                              <span className="text-muted-foreground ml-1 text-xs">
                                                ({alloc.percentage}%, {alloc.days}d)
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-right font-medium tabular-nums text-sm">
                                            {alloc ? formatCurrency(alloc.amount) : formatCurrency(inv.subTotal)}
                                          </TableCell>
                                        </>
                                      ) : (
                                        <>
                                          <TableCell className="text-right tabular-nums text-sm">
                                            {formatCurrency(inv.subTotal)}
                                            {dateMode === "rental_period" && inv.allocations && (
                                              <div className="mt-0.5 flex flex-wrap justify-end gap-1">
                                                {inv.allocations.map((a) => (
                                                  <span
                                                    key={a.month}
                                                    className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px]"
                                                  >
                                                    {a.label}: {a.percentage}%
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-muted-foreground text-right tabular-nums text-sm">
                                            {formatCurrency(inv.tax)}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-sm">
                                            {formatCurrency(inv.grossTotal)}
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                          <TableRow className="border-t-2 font-semibold">
                            <TableCell />
                            <TableCell>
                              Total ({filteredInvoices.length} invoices, {customerGroups.length} customers)
                            </TableCell>
                            <TableCell />
                            {showAllocation ? (
                              <>
                                <TableCell className="text-muted-foreground text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.subTotal, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    customerGroups.reduce((s, g) => s + g.totalAllocated, 0),
                                  )}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.subTotal, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.tax, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.grossTotal, 0),
                                  )}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        </TableBody>
                      </Table>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline">
          <Card>
            <CardHeader>
              <CardTitle>Open Orders</CardTitle>
              <CardDescription>
                Active Versatile orders from RentalWorks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.pipelineOrders.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No open orders found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Deal</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pipelineOrders.map((order) => (
                      <TableRow key={order.orderId}>
                        <TableCell className="font-medium">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>{order.customer}</TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {order.deal}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {order.description}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(order.total)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.orderDate}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {EQUIPMENT_TYPE_LABELS[order.equipmentType] ||
                              order.equipmentType}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={4}>Total Pipeline</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          data.pipelineOrders.reduce(
                            (s, o) => s + o.total,
                            0,
                          ),
                        )}
                      </TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quotes Tab */}
        <TabsContent value="quotes">
          <Card>
            <CardHeader>
              <CardTitle>Active Quotes</CardTitle>
              <CardDescription>
                Open quote opportunities from RentalWorks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.pipelineQuotes.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No active quotes found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quote #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pipelineQuotes.map((quote) => (
                      <TableRow key={quote.quoteId || quote.quoteNumber}>
                        <TableCell className="font-medium">
                          {quote.quoteNumber}
                        </TableCell>
                        <TableCell>{quote.customer}</TableCell>
                        <TableCell className="max-w-[250px] truncate">
                          {quote.description}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(quote.total)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{quote.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {quote.quoteDate}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={3}>Total Opportunities</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          data.pipelineQuotes.reduce(
                            (s, q) => s + q.total,
                            0,
                          ),
                        )}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          <InsightsPanel data={data} />
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6">
          <TrendsPanel
            snapshots={snapshots}
            loading={snapshotsLoading}
            onRefresh={fetchSnapshots}
            onSaveSnapshot={saveSnapshot}
            saving={savingSnapshot}
            currentProjected={data.currentMonthProjected}
          />
        </TabsContent>

        {/* Accruals Tab — JE Schedule (always uses invoice_date data) */}
        <TabsContent value="accruals" className="space-y-6">
          {accrualData ? (
            <>
              {dateMode !== "invoice_date" && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <strong>Note:</strong> The accrual schedule always uses <strong>Invoice Date</strong> mode to compare billed vs. earned revenue, regardless of the date view selected above.
                </div>
              )}
              <AccrualSchedule monthlyData={accrualData.monthlyData} closedInvoices={accrualData.closedInvoices} />
            </>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading accrual data…</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

// ─── Client-side pro-rata allocation (mirrors server-side allocateToMonths) ──

interface InvoiceMonthDetail {
  invoiceId: string;
  invoiceNumber: string;
  customer: string;
  orderDescription: string;
  invoiceDate: string;
  billingStartDate: string;
  billingEndDate: string;
  subTotal: number;
  billedThisMonth: number;
  earnedThisMonth: number;
  adjustment: number; // positive = accrual, negative = deferral
}

function getMonthKeyClient(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function computeEarnedForMonth(
  startDateStr: string | null | undefined,
  endDateStr: string | null | undefined,
  amount: number,
  fallbackDateStr: string | null | undefined,
  targetMonth: string,
): number {
  if (amount === 0) return 0;

  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;

  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) {
    return getMonthKeyClient(fallbackDateStr) === targetMonth ? amount : 0;
  }

  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  if (totalDays <= 0) {
    return getMonthKeyClient(fallbackDateStr) === targetMonth ? amount : 0;
  }

  const [ty, tm] = targetMonth.split("-").map(Number);
  const monthStart = new Date(ty, tm - 1, 1);
  const monthEnd = new Date(ty, tm, 0);

  const overlapStart = startDate > monthStart ? startDate : monthStart;
  const overlapEnd = endDate < monthEnd ? endDate : monthEnd;
  const daysInMonth = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;

  if (daysInMonth <= 0) return 0;

  const dailyRate = amount / totalDays;
  return Math.round(dailyRate * daysInMonth * 100) / 100;
}

function getInvoiceDetailsForMonth(invoices: ClosedInvoice[], monthKey: string): InvoiceMonthDetail[] {
  const results: InvoiceMonthDetail[] = [];

  for (const inv of invoices) {
    // Only CLOSED/PROCESSED invoices contribute to accrual calc
    if (inv.status !== "CLOSED" && inv.status !== "PROCESSED") continue;

    const billedThisMonth = getMonthKeyClient(inv.invoiceDate) === monthKey ? inv.subTotal : 0;
    const earnedThisMonth = computeEarnedForMonth(
      inv.billingStartDate, inv.billingEndDate,
      inv.subTotal, inv.invoiceDate, monthKey,
    );

    // Skip invoices that don't touch this month at all
    if (billedThisMonth === 0 && earnedThisMonth === 0) continue;

    results.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      orderDescription: inv.orderDescription || inv.orderNumber,
      invoiceDate: inv.invoiceDate,
      billingStartDate: inv.billingStartDate,
      billingEndDate: inv.billingEndDate,
      subTotal: inv.subTotal,
      billedThisMonth,
      earnedThisMonth,
      adjustment: Math.round((earnedThisMonth - billedThisMonth) * 100) / 100,
    });
  }

  // Sort: largest absolute adjustment first
  results.sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment));
  return results;
}

// ─── AccrualSchedule Component ──────────────────────────────────────────────

function AccrualSchedule({ monthlyData, closedInvoices }: { monthlyData: MonthlyRevenue[]; closedInvoices: ClosedInvoice[] }) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Only show months that have any billed or earned activity
  const activeMonths = monthlyData.filter((m) => m.billed > 0 || m.earned > 0);

  // Build a lookup from the full monthlyData array so we can find the prior month
  const monthIndex = new Map<string, MonthlyRevenue>();
  for (const m of monthlyData) monthIndex.set(m.month, m);

  // Get prior month key from a "YYYY-MM" string
  const getPriorMonthKey = (mk: string) => {
    const [y, m] = mk.split("-").map(Number);
    const d = new Date(y, m - 2, 1); // m-1 is current (0-indexed), so m-2 is prior
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  // For each active month, compute reversal (from prior month) and net
  const scheduleRows = activeMonths.map((m) => {
    const priorKey = getPriorMonthKey(m.month);
    const prior = monthIndex.get(priorKey);
    const reversalAccrued = prior?.accrued ?? 0;
    const reversalDeferred = prior?.deferred ?? 0;
    const netRevenueImpact = (m.accrued - m.deferred) - (reversalAccrued - reversalDeferred);
    return {
      ...m,
      reversalAccrued,
      reversalDeferred,
      netRevenueImpact,
      priorLabel: prior?.label ?? priorKey,
    };
  });

  // Memoize invoice details for the expanded month
  const invoiceDetails = useMemo(() => {
    if (!expandedMonth) return [];
    return getInvoiceDetailsForMonth(closedInvoices, expandedMonth);
  }, [expandedMonth, closedInvoices]);

  const totals = scheduleRows.reduce(
    (acc, m) => ({
      billed: acc.billed + m.billed,
      earned: acc.earned + m.earned,
      accrued: acc.accrued + m.accrued,
      deferred: acc.deferred + m.deferred,
      reversalAccrued: acc.reversalAccrued + m.reversalAccrued,
      reversalDeferred: acc.reversalDeferred + m.reversalDeferred,
      netRevenueImpact: acc.netRevenueImpact + m.netRevenueImpact,
    }),
    { billed: 0, earned: 0, accrued: 0, deferred: 0, reversalAccrued: 0, reversalDeferred: 0, netRevenueImpact: 0 },
  );

  return (
    <>
      {/* Monthly Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Accrual & Deferral Schedule</CardTitle>
          <CardDescription>
            Monthly earned vs billed revenue with prior-month reversals — click a row to see invoice detail
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scheduleRows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No revenue data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]" />
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right border-l border-gray-200">Reverse Accrual</TableHead>
                    <TableHead className="text-right">Reverse Deferral</TableHead>
                    <TableHead className="text-right border-l border-gray-200">New Accrual</TableHead>
                    <TableHead className="text-right">New Deferral</TableHead>
                    <TableHead className="text-right border-l border-gray-200">Net Revenue Adj.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduleRows.map((m) => {
                    const isExpanded = expandedMonth === m.month;
                    return (
                      <React.Fragment key={m.month}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedMonth(isExpanded ? null : m.month)}
                        >
                          <TableCell className="text-muted-foreground w-[30px] px-2">
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />
                            }
                          </TableCell>
                          <TableCell className="font-medium">{m.label}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(m.billed)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(m.earned)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-rose-600 border-l border-gray-200">
                            {m.reversalAccrued > 0 ? `(${formatCurrency(m.reversalAccrued)})` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-rose-600">
                            {m.reversalDeferred > 0 ? `(${formatCurrency(m.reversalDeferred)})` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-teal-700 border-l border-gray-200">
                            {m.accrued > 0 ? formatCurrency(m.accrued) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {m.deferred > 0 ? formatCurrency(m.deferred) : "—"}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-medium border-l border-gray-200 ${m.netRevenueImpact > 0 ? "text-teal-700" : m.netRevenueImpact < 0 ? "text-amber-700" : ""}`}>
                            {m.netRevenueImpact === 0 ? "—" : formatCurrency(m.netRevenueImpact)}
                          </TableCell>
                        </TableRow>
                        {/* Expanded invoice detail */}
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={9} className="p-0 bg-muted/30">
                              <div className="px-4 py-3">
                                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                  Invoice Detail — {m.label} ({invoiceDetails.length} invoices)
                                </h5>
                                {invoiceDetails.length === 0 ? (
                                  <p className="text-muted-foreground text-sm py-2">No invoices touch this month.</p>
                                ) : (
                                  <div className="overflow-x-auto rounded border bg-white">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Invoice #</TableHead>
                                          <TableHead>Customer</TableHead>
                                          <TableHead>Description</TableHead>
                                          <TableHead>Invoice Date</TableHead>
                                          <TableHead>Billing Period</TableHead>
                                          <TableHead className="text-right">Invoice Total</TableHead>
                                          <TableHead className="text-right">Billed This Mo.</TableHead>
                                          <TableHead className="text-right">Earned This Mo.</TableHead>
                                          <TableHead className="text-right">Adjustment</TableHead>
                                          <TableHead>Type</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {invoiceDetails.map((inv) => (
                                          <TableRow key={inv.invoiceId}>
                                            <TableCell className="font-medium text-xs">{inv.invoiceNumber}</TableCell>
                                            <TableCell className="text-xs">{inv.customer}</TableCell>
                                            <TableCell className="text-xs max-w-[160px] truncate">{inv.orderDescription}</TableCell>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                              {formatDate(inv.invoiceDate)}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                              {inv.billingStartDate || inv.billingEndDate
                                                ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}`
                                                : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                              {formatCurrency(inv.subTotal)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">
                                              {inv.billedThisMonth > 0 ? formatCurrency(inv.billedThisMonth) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-xs">
                                              {inv.earnedThisMonth > 0 ? formatCurrency(inv.earnedThisMonth) : "—"}
                                            </TableCell>
                                            <TableCell className={`text-right tabular-nums text-xs font-medium ${inv.adjustment > 0 ? "text-teal-700" : inv.adjustment < 0 ? "text-amber-700" : ""}`}>
                                              {inv.adjustment === 0 ? "—" : formatCurrency(inv.adjustment)}
                                            </TableCell>
                                            <TableCell>
                                              {inv.adjustment > 0 && (
                                                <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100 text-[10px] px-1.5 py-0">Accrual</Badge>
                                              )}
                                              {inv.adjustment < 0 && (
                                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] px-1.5 py-0">Deferral</Badge>
                                              )}
                                              {inv.adjustment === 0 && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Matched</Badge>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="border-t-2 font-semibold">
                                          <TableCell colSpan={5} className="text-xs">
                                            Total ({invoiceDetails.length} invoices)
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.subTotal, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.billedThisMonth, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.earnedThisMonth, 0))}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums text-xs font-medium">
                                            {formatCurrency(invoiceDetails.reduce((s, i) => s + i.adjustment, 0))}
                                          </TableCell>
                                          <TableCell />
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.billed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.earned)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 border-l border-gray-200">
                      {totals.reversalAccrued > 0 ? `(${formatCurrency(totals.reversalAccrued)})` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600">
                      {totals.reversalDeferred > 0 ? `(${formatCurrency(totals.reversalDeferred)})` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-teal-700 border-l border-gray-200">
                      {totals.accrued > 0 ? formatCurrency(totals.accrued) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {totals.deferred > 0 ? formatCurrency(totals.deferred) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium border-l border-gray-200 ${totals.netRevenueImpact > 0 ? "text-teal-700" : "text-amber-700"}`}>
                      {formatCurrency(totals.netRevenueImpact)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Journal Entry Details */}
      <Card>
        <CardHeader>
          <CardTitle>Journal Entry Details</CardTitle>
          <CardDescription>
            Each month shows the reversal of the prior month&apos;s entry, then the new month-end adjusting entry, with net impact
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scheduleRows.filter((m) => m.accrued > 0 || m.deferred > 0 || m.reversalAccrued > 0 || m.reversalDeferred > 0).length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No adjustments needed — billed and earned revenue match for all months.
            </p>
          ) : (
            <div className="space-y-6">
              {scheduleRows
                .filter((m) => m.accrued > 0 || m.deferred > 0 || m.reversalAccrued > 0 || m.reversalDeferred > 0)
                .map((m) => {
                  const hasReversal = m.reversalAccrued > 0 || m.reversalDeferred > 0;
                  const hasNewEntry = m.accrued > 0 || m.deferred > 0;
                  let lineNum = 0;
                  return (
                    <div key={m.month} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">{m.label}</h4>
                        {m.netRevenueImpact !== 0 && (
                          <span className={`text-sm font-medium ${m.netRevenueImpact > 0 ? "text-teal-700" : "text-amber-700"}`}>
                            Net revenue impact: {formatCurrency(m.netRevenueImpact)}
                          </span>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[60px]">#</TableHead>
                              <TableHead>Account</TableHead>
                              <TableHead>Memo</TableHead>
                              <TableHead className="text-right">Debit</TableHead>
                              <TableHead className="text-right">Credit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {/* ── Reversal of prior month's entry ── */}
                            {hasReversal && (
                              <>
                                <TableRow className="bg-rose-50/50">
                                  <TableCell colSpan={5} className="text-xs font-semibold text-rose-700 uppercase tracking-wide py-1.5">
                                    Reversal of {m.priorLabel} Entry
                                  </TableCell>
                                </TableRow>
                                {m.reversalAccrued > 0 && (
                                  <>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Reverse {m.priorLabel} accrued revenue
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-rose-600">
                                        {formatCurrency(m.reversalAccrued)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Accrued Revenue (Asset)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Reverse {m.priorLabel} accrued revenue
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-rose-600">
                                        {formatCurrency(m.reversalAccrued)}
                                      </TableCell>
                                    </TableRow>
                                  </>
                                )}
                                {m.reversalDeferred > 0 && (
                                  <>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Deferred Revenue (Liability)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Reverse {m.priorLabel} deferred revenue
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-rose-600">
                                        {formatCurrency(m.reversalDeferred)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Reverse {m.priorLabel} deferred revenue
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-rose-600">
                                        {formatCurrency(m.reversalDeferred)}
                                      </TableCell>
                                    </TableRow>
                                  </>
                                )}
                              </>
                            )}
                            {/* ── New month-end adjusting entry ── */}
                            {hasNewEntry && (
                              <>
                                <TableRow className={hasReversal ? "bg-blue-50/50 border-t-2" : "bg-blue-50/50"}>
                                  <TableCell colSpan={5} className="text-xs font-semibold text-blue-700 uppercase tracking-wide py-1.5">
                                    {m.label} Month-End Adjusting Entry
                                  </TableCell>
                                </TableRow>
                                {m.accrued > 0 && (
                                  <>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Accrued Revenue (Asset)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Revenue earned but not yet billed — {m.label}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-teal-700">
                                        {formatCurrency(m.accrued)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Accrued rental revenue — {m.label}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-teal-700">
                                        {formatCurrency(m.accrued)}
                                      </TableCell>
                                    </TableRow>
                                  </>
                                )}
                                {m.deferred > 0 && (
                                  <>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Rental Revenue (Income)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Revenue billed but not yet earned — {m.label}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-amber-700">
                                        {formatCurrency(m.deferred)}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-muted-foreground">{++lineNum}</TableCell>
                                      <TableCell className="font-medium">Deferred Revenue (Liability)</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        Deferred rental revenue — {m.label}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">—</TableCell>
                                      <TableCell className="text-right tabular-nums font-medium text-amber-700">
                                        {formatCurrency(m.deferred)}
                                      </TableCell>
                                    </TableRow>
                                  </>
                                )}
                              </>
                            )}
                            {/* ── Net summary row ── */}
                            {hasReversal && hasNewEntry && (
                              <TableRow className="border-t-2 bg-gray-50/50">
                                <TableCell />
                                <TableCell colSpan={2} className="font-semibold text-sm">
                                  Net Impact on Revenue
                                </TableCell>
                                <TableCell className={`text-right tabular-nums font-semibold ${m.netRevenueImpact < 0 ? "text-amber-700" : ""}`}>
                                  {m.netRevenueImpact < 0 ? formatCurrency(Math.abs(m.netRevenueImpact)) : "—"}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums font-semibold ${m.netRevenueImpact > 0 ? "text-teal-700" : ""}`}>
                                  {m.netRevenueImpact > 0 ? formatCurrency(m.netRevenueImpact) : "—"}
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function KPICard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

// ─── Insights Panel ─────────────────────────────────────────────────────────

function InsightsPanel({ data }: { data: RevenueProjectionResponse }) {
  const insights = useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Month-over-month growth
    const sortedMonths = [...data.monthlyData]
      .filter((m) => m.closed > 0)
      .sort((a, b) => a.month.localeCompare(b.month));
    const lastTwo = sortedMonths.slice(-2);
    let momGrowth: number | null = null;
    let momPrior = 0;
    let momCurrent = 0;
    if (lastTwo.length === 2 && lastTwo[0].closed > 0) {
      momPrior = lastTwo[0].closed;
      momCurrent = lastTwo[1].closed;
      momGrowth = ((momCurrent - momPrior) / momPrior) * 100;
    }

    // Top customers by revenue
    const customerRevenue = new Map<string, number>();
    for (const inv of data.closedInvoices) {
      const key = inv.customer || "Unknown";
      customerRevenue.set(key, (customerRevenue.get(key) ?? 0) + inv.subTotal);
    }
    const topCustomers = Array.from(customerRevenue.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const totalInvoiceRevenue = data.closedInvoices.reduce((s, i) => s + i.subTotal, 0);

    // Revenue concentration — top customer %
    const topCustomerPct =
      topCustomers.length > 0 && totalInvoiceRevenue > 0
        ? (topCustomers[0][1] / totalInvoiceRevenue) * 100
        : 0;

    // Annualized run rate from current month projected
    const annualRunRate = data.currentMonthProjected * 12;

    // Days remaining in month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = daysInMonth - daysElapsed;

    // Daily run rate this month
    const dailyRate = daysElapsed > 0 ? data.currentMonthActual / daysElapsed : 0;
    const projectedAtCurrentPace = dailyRate * daysInMonth;

    // Pipeline conversion — if all pipeline converts
    const pipelineUpsidePct =
      data.currentMonthActual > 0
        ? (data.pipelineValue / data.currentMonthActual) * 100
        : 0;

    // Best month in last 12
    const bestMonth = sortedMonths.reduce(
      (best, m) => (m.closed > best.closed ? m : best),
      sortedMonths[0] ?? { month: "", label: "N/A", closed: 0 },
    );

    // Average monthly revenue
    const avgMonthly =
      sortedMonths.length > 0
        ? sortedMonths.reduce((s, m) => s + m.closed, 0) / sortedMonths.length
        : 0;

    // Current month vs average
    const vsAvgPct =
      avgMonthly > 0
        ? ((data.currentMonthActual - avgMonthly) / avgMonthly) * 100
        : 0;

    // Equipment type with highest revenue
    const topEquipment = data.equipmentBreakdown.length > 0
      ? data.equipmentBreakdown.reduce((best, e) => (e.amount > best.amount ? e : best), data.equipmentBreakdown[0])
      : null;

    return {
      momGrowth,
      momPrior,
      momCurrent,
      topCustomers,
      totalInvoiceRevenue,
      topCustomerPct,
      annualRunRate,
      daysRemaining,
      daysInMonth,
      daysElapsed,
      dailyRate,
      projectedAtCurrentPace,
      pipelineUpsidePct,
      bestMonth,
      avgMonthly,
      vsAvgPct,
      topEquipment,
      currentMonthKey,
    };
  }, [data]);

  const TrendIcon = ({ value }: { value: number }) => {
    if (value > 0) return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
    if (value < 0) return <ArrowDownRight className="h-4 w-4 text-rose-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  return (
    <>
      {/* Key Metrics Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Month-over-Month Growth
              <TrendIcon value={insights.momGrowth ?? 0} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {insights.momGrowth !== null ? (
              <>
                <div className={`text-2xl font-bold ${insights.momGrowth >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {insights.momGrowth >= 0 ? "+" : ""}{insights.momGrowth.toFixed(1)}%
                </div>
                <p className="text-muted-foreground text-xs mt-1">
                  {formatCurrency(insights.momPrior)} → {formatCurrency(insights.momCurrent)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Need 2+ months of data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Annualized Run Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(insights.annualRunRate)}</div>
            <p className="text-muted-foreground text-xs mt-1">
              Based on {formatCurrency(data.currentMonthProjected)}/mo projected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Pacing This Month
              <TrendIcon value={insights.vsAvgPct} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(insights.projectedAtCurrentPace)}</div>
            <p className="text-muted-foreground text-xs mt-1">
              {formatCurrency(insights.dailyRate)}/day &middot; {insights.daysElapsed}d elapsed, {insights.daysRemaining}d remaining
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Insights */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Top Customers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Customers by Revenue</CardTitle>
            <CardDescription>Invoiced revenue concentration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.topCustomers.map(([customer, revenue], i) => {
                const pct = insights.totalInvoiceRevenue > 0 ? (revenue / insights.totalInvoiceRevenue) * 100 : 0;
                return (
                  <div key={customer}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate max-w-[200px]">
                        {i + 1}. {customer}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(revenue)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {insights.topCustomerPct > 40 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>Concentration risk:</strong> Top customer accounts for {insights.topCustomerPct.toFixed(0)}% of revenue
              </div>
            )}
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Performance Summary</CardTitle>
            <CardDescription>Key revenue indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current Month vs. Average</span>
                <span className={`text-sm font-semibold ${insights.vsAvgPct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {insights.vsAvgPct >= 0 ? "+" : ""}{insights.vsAvgPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monthly Average (trailing)</span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(insights.avgMonthly)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Best Month</span>
                <span className="text-sm font-semibold tabular-nums">
                  {insights.bestMonth.label} — {formatCurrency(insights.bestMonth.closed)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pipeline Upside</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(data.pipelineValue)} ({insights.pipelineUpsidePct.toFixed(0)}% of actual)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Quote Opportunities</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(data.quoteOpportunities)} ({data.pipelineQuotes.length} quotes)
                </span>
              </div>
              {insights.topEquipment && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Top Equipment Category</span>
                  <span className="text-sm font-semibold">
                    {insights.topEquipment.label} ({insights.topEquipment.percentage.toFixed(0)}%)
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Highlights */}
      {data.pipelineOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Largest Pipeline Deals</CardTitle>
            <CardDescription>Top open orders by value</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.pipelineOrders]
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5)
                  .map((order) => (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-medium">{order.orderNumber}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell className="max-w-[250px] truncate">{order.description}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(order.total)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{order.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── Trends Panel ───────────────────────────────────────────────────────────

function TrendsPanel({
  snapshots,
  loading,
  onRefresh,
  onSaveSnapshot,
  saving,
  currentProjected,
}: {
  snapshots: SnapshotRow[];
  loading: boolean;
  onRefresh: () => void;
  onSaveSnapshot: () => void;
  saving: boolean;
  currentProjected: number;
}) {
  // Group snapshots by date, summing revenue section
  const chartData = useMemo(() => {
    const byDate = new Map<string, { revenue: number; pipeline: number; ytd: number }>();
    for (const s of snapshots) {
      if (!byDate.has(s.snapshot_date)) {
        byDate.set(s.snapshot_date, { revenue: 0, pipeline: 0, ytd: 0 });
      }
      const entry = byDate.get(s.snapshot_date)!;
      if (s.section_id === "revenue") entry.revenue = Number(s.projected_amount);
      else if (s.section_id === "pipeline") entry.pipeline = Number(s.projected_amount);
      else if (s.section_id === "ytd") entry.ytd = Number(s.projected_amount);
    }

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({
        date,
        label: new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ...values,
      }));
  }, [snapshots]);

  // Calculate day-over-day changes
  const changes = useMemo(() => {
    if (chartData.length < 2) return [];
    return chartData.slice(1).map((cur, i) => {
      const prev = chartData[i];
      const delta = cur.revenue - prev.revenue;
      const pct = prev.revenue !== 0 ? (delta / prev.revenue) * 100 : 0;
      return { ...cur, delta, pct, prevRevenue: prev.revenue };
    });
  }, [chartData]);

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading trend data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Projection Trend — {monthLabel}</CardTitle>
              <CardDescription>
                How the projected revenue for this month has changed day over day
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={onSaveSnapshot} variant="outline" size="sm" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Today
              </Button>
              <Button onClick={onRefresh} variant="ghost" size="sm">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No snapshots yet for {monthLabel}.</p>
              <p className="text-muted-foreground text-xs mt-1">
                Click &quot;Save Today&quot; to capture today&apos;s projection ({formatCurrency(currentProjected)}) and start tracking.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatCompact} className="text-xs" tick={{ fontSize: 12 }} />
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm" style={{ zIndex: 50 }}>
                        <p className="font-semibold text-gray-900 mb-1.5">{label}</p>
                        {payload.map((entry) => (
                          <div key={entry.dataKey as string} className="flex items-center justify-between gap-6">
                            <span className="text-gray-500 capitalize">{entry.dataKey as string}</span>
                            <span className="font-medium tabular-nums">{formatCurrency(entry.value as number)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50, pointerEvents: "none" }}
                />
                <Legend />
                <Bar dataKey="revenue" name="Projected Revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Line dataKey="pipeline" name="Pipeline" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Day-over-Day Changes Table */}
      {changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Daily Changes</CardTitle>
            <CardDescription>Day-over-day projection movement</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">% Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...changes].reverse().map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(row.prevRevenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(row.revenue)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${row.delta > 0 ? "text-emerald-700" : row.delta < 0 ? "text-rose-700" : ""}`}>
                      {row.delta > 0 ? "+" : ""}{formatCurrency(row.delta)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${row.pct > 0 ? "text-emerald-700" : row.pct < 0 ? "text-rose-700" : ""}`}>
                      {row.pct > 0 ? "+" : ""}{row.pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Snapshots */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Snapshot History</CardTitle>
            <CardDescription>All saved snapshots for {monthLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Projected Revenue</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                  <TableHead className="text-right">YTD Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...chartData].reverse().map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {row.revenue > 0 ? formatCurrency(row.revenue) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.pipeline > 0 ? formatCurrency(row.pipeline) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ytd > 0 ? formatCurrency(row.ytd) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
