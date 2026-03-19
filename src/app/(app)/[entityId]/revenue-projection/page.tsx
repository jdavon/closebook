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
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  EQUIPMENT_TYPE_LABELS,
  type RevenueProjectionResponse,
  type ClosedInvoice,
  type MonthlyRevenue,
  type DateMode,
} from "@/lib/utils/revenue-projection";
import {
  ComposedChart,
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

  const [data, setData] = useState<RevenueProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("rental_period");
  const [invoiceMonthFilter, setInvoiceMonthFilter] = useState<string>("all");

  const fetchData = async (mode?: DateMode) => {
    const activeMode = mode ?? dateMode;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/revenue-projection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, dateMode: activeMode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleDateModeChange = (mode: DateMode) => {
    setDateMode(mode);
    fetchData(mode);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

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
          description="All invoices this year"
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
                  />
                  <Bar
                    dataKey="pending"
                    name="Pending"
                    fill="#f59e0b"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="pipeline"
                    name="Pipeline"
                    fill="#94a3b8"
                    stackId="a"
                    radius={[2, 2, 0, 0]}
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
                    const colCount = showAllocation ? 7 : 7;
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
                                {/* Customer summary row */}
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
                                {/* Expanded invoice detail rows */}
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
                          {/* Grand total row */}
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

        {/* Accruals Tab — JE Schedule */}
        <TabsContent value="accruals" className="space-y-6">
          <AccrualSchedule monthlyData={data.monthlyData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function AccrualSchedule({ monthlyData }: { monthlyData: MonthlyRevenue[] }) {
  const activeMonths = monthlyData.filter((m) => m.billed > 0 || m.earned > 0);

  const totals = activeMonths.reduce(
    (acc, m) => ({
      billed: acc.billed + m.billed,
      earned: acc.earned + m.earned,
      accrued: acc.accrued + m.accrued,
      deferred: acc.deferred + m.deferred,
    }),
    { billed: 0, earned: 0, accrued: 0, deferred: 0 },
  );

  return (
    <>
      {/* Monthly Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Accrual & Deferral Schedule</CardTitle>
          <CardDescription>
            Monthly earned vs billed revenue — use for QuickBooks journal entries
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeMonths.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No revenue data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Accrued</TableHead>
                    <TableHead className="text-right">Deferred</TableHead>
                    <TableHead className="text-right">Net Adj.</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeMonths.map((m) => {
                    const netAdj = m.accrued - m.deferred;
                    return (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(m.billed)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(m.earned)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-teal-700">
                          {m.accrued > 0 ? formatCurrency(m.accrued) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">
                          {m.deferred > 0 ? formatCurrency(m.deferred) : "—"}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-medium ${netAdj > 0 ? "text-teal-700" : netAdj < 0 ? "text-amber-700" : ""}`}>
                          {netAdj === 0 ? "—" : formatCurrency(netAdj)}
                        </TableCell>
                        <TableCell>
                          {m.accrued > 0 && m.deferred === 0 && (
                            <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100">Accrual</Badge>
                          )}
                          {m.deferred > 0 && m.accrued === 0 && (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Deferral</Badge>
                          )}
                          {m.accrued > 0 && m.deferred > 0 && (
                            <Badge variant="outline">Mixed</Badge>
                          )}
                          {m.accrued === 0 && m.deferred === 0 && (
                            <Badge variant="secondary">Matched</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.billed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.earned)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-teal-700">
                      {totals.accrued > 0 ? formatCurrency(totals.accrued) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {totals.deferred > 0 ? formatCurrency(totals.deferred) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${totals.accrued - totals.deferred > 0 ? "text-teal-700" : "text-amber-700"}`}>
                      {formatCurrency(totals.accrued - totals.deferred)}
                    </TableCell>
                    <TableCell />
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
            Monthly adjusting entries for QuickBooks — post at month-end, reverse at beginning of next month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeMonths.filter((m) => m.accrued > 0 || m.deferred > 0).length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No adjustments needed — billed and earned revenue match for all months.
            </p>
          ) : (
            <div className="space-y-4">
              {activeMonths
                .filter((m) => m.accrued > 0 || m.deferred > 0)
                .map((m) => (
                  <div key={m.month} className="rounded-lg border p-4">
                    <h4 className="font-semibold mb-3">{m.label}</h4>
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
                          {m.accrued > 0 && (
                            <>
                              <TableRow>
                                <TableCell className="text-muted-foreground">1</TableCell>
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
                                <TableCell className="text-muted-foreground">2</TableCell>
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
                                <TableCell className="text-muted-foreground">{m.accrued > 0 ? 3 : 1}</TableCell>
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
                                <TableCell className="text-muted-foreground">{m.accrued > 0 ? 4 : 2}</TableCell>
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
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
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
