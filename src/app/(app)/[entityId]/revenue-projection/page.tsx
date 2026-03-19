"use client";

import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  EQUIPMENT_TYPE_LABELS,
  type RevenueProjectionResponse,
  type ClosedInvoice,
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
  const [dateMode, setDateMode] = useState<DateMode>("invoice_date");
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
                  <CardTitle>Closed Invoices</CardTitle>
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
                  No closed invoices found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  {(() => {
                    // Show allocation column when in rental_period mode and filtering a specific month
                    const showAllocation = dateMode === "rental_period" && invoiceMonthFilter !== "all";
                    // Helper to get the allocation for the filtered month
                    const getAlloc = (inv: ClosedInvoice) =>
                      inv.allocations?.find((a) => a.month === invoiceMonthFilter);
                    return (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Order</TableHead>
                            <TableHead>Invoice Date</TableHead>
                            <TableHead>Billing Period</TableHead>
                            {showAllocation ? (
                              <>
                                <TableHead className="text-right">
                                  Invoice Total
                                </TableHead>
                                <TableHead className="text-right">
                                  Allocated
                                </TableHead>
                                <TableHead className="text-right">
                                  %
                                </TableHead>
                                <TableHead className="text-right">
                                  Days
                                </TableHead>
                              </>
                            ) : (
                              <>
                                <TableHead>Month</TableHead>
                                <TableHead className="text-right">
                                  Revenue
                                </TableHead>
                                <TableHead className="text-right">
                                  Tax
                                </TableHead>
                                <TableHead className="text-right">
                                  Total
                                </TableHead>
                              </>
                            )}
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredInvoices.map((inv) => {
                            const alloc = showAllocation ? getAlloc(inv) : null;
                            return (
                              <TableRow key={inv.invoiceId}>
                                <TableCell className="font-medium">
                                  {inv.invoiceNumber}
                                </TableCell>
                                <TableCell>{inv.customer}</TableCell>
                                <TableCell className="max-w-[180px] truncate">
                                  {inv.orderDescription || inv.orderNumber}
                                </TableCell>
                                <TableCell className="text-muted-foreground whitespace-nowrap">
                                  {formatDate(inv.invoiceDate)}
                                </TableCell>
                                <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                                  {inv.billingStartDate || inv.billingEndDate
                                    ? `${formatDate(inv.billingStartDate)} – ${formatDate(inv.billingEndDate)}`
                                    : "—"}
                                </TableCell>
                                {showAllocation ? (
                                  <>
                                    <TableCell className="text-muted-foreground text-right tabular-nums">
                                      {formatCurrency(inv.subTotal)}
                                    </TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">
                                      {alloc ? formatCurrency(alloc.amount) : formatCurrency(inv.subTotal)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {alloc ? `${alloc.percentage}%` : "100%"}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-right tabular-nums">
                                      {alloc ? alloc.days : "—"}
                                    </TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell>
                                      <Badge variant="outline">
                                        {inv.month
                                          ? inv.month.replace(
                                              /^(\d{4})-(\d{2})$/,
                                              (_, y, m) => {
                                                const months = [
                                                  "Jan","Feb","Mar","Apr","May","Jun",
                                                  "Jul","Aug","Sep","Oct","Nov","Dec",
                                                ];
                                                return `${months[Number(m) - 1]} ${y.slice(2)}`;
                                              },
                                            )
                                          : "—"}
                                      </Badge>
                                      {dateMode === "rental_period" && inv.allocations && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {inv.allocations.map((a) => (
                                            <span
                                              key={a.month}
                                              className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
                                            >
                                              {a.label}: {a.percentage}%
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">
                                      {formatCurrency(inv.subTotal)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-right tabular-nums">
                                      {formatCurrency(inv.tax)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {formatCurrency(inv.grossTotal)}
                                    </TableCell>
                                  </>
                                )}
                                <TableCell>
                                  <Badge variant="secondary">
                                    {EQUIPMENT_TYPE_LABELS[inv.equipmentType] ||
                                      inv.equipmentType}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="border-t-2 font-semibold">
                            {showAllocation ? (
                              <>
                                <TableCell colSpan={5}>
                                  Total ({filteredInvoices.length} invoices)
                                </TableCell>
                                <TableCell className="text-muted-foreground text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, i) => s + i.subTotal, 0),
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(
                                    filteredInvoices.reduce((s, inv) => {
                                      const alloc = getAlloc(inv);
                                      return s + (alloc ? alloc.amount : inv.subTotal);
                                    }, 0),
                                  )}
                                </TableCell>
                                <TableCell />
                                <TableCell />
                              </>
                            ) : (
                              <>
                                <TableCell colSpan={6}>
                                  Total ({filteredInvoices.length} invoices)
                                </TableCell>
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
                            <TableCell />
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
      </Tabs>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

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
