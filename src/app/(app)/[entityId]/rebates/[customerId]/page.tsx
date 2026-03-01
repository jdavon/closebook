"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  RefreshCw,
  Calculator,
  Loader2,
  ChevronDown,
  ChevronRight,
  Ban,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  getEquipmentLabel,
  getCurrentQuarter,
} from "@/lib/utils/rebate-calculations";
import type { EquipmentType } from "@/lib/types/database";

interface RebateInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  billing_end_date: string | null;
  status: string | null;
  deal: string | null;
  order_number: string | null;
  order_description: string | null;
  equipment_type: string;
  list_total: number;
  gross_total: number;
  sub_total: number;
  tax_amount: number;
  discount_amount: number;
  excluded_total: number | null;
  before_discount: number | null;
  discount_percent: number | null;
  final_amount: number | null;
  tier_label: string | null;
  rebate_rate: number | null;
  remaining_rebate_pct: number | null;
  net_rebate: number | null;
  cumulative_revenue: number | null;
  cumulative_rebate: number | null;
  quarter: string | null;
  is_manually_excluded: boolean;
  manual_exclusion_reason: string | null;
}

interface InvoiceItem {
  id: string;
  i_code: string | null;
  description: string | null;
  quantity: number | null;
  extended: number | null;
  is_excluded: boolean;
}

interface QuarterlySummary {
  id: string;
  quarter: string;
  total_revenue: number | null;
  total_rebate: number | null;
  invoice_count: number | null;
  tier_label: string | null;
  is_paid: boolean;
}

interface CustomerData {
  id: string;
  customer_name: string;
  rw_customer_id: string;
  agreement_type: string;
  status: string;
  tax_rate: number;
}

interface TierData {
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  sort_order: number;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "0.00%";
  return `${n.toFixed(2)}%`;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const customerId = params.customerId as string;
  const supabase = createClient();

  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [tiers, setTiers] = useState<TierData[]>([]);
  const [invoices, setInvoices] = useState<RebateInvoice[]>([]);
  const [quarterlySummaries, setQuarterlySummaries] = useState<
    QuarterlySummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(
    new Set(),
  );
  const [invoiceItems, setInvoiceItems] = useState<
    Record<string, InvoiceItem[]>
  >({});
  const [selectedQuarter, setSelectedQuarter] = useState("all");

  const loadData = useCallback(async () => {
    try {
      // Load customer
      const { data: cust } = await supabase
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();
      setCustomer(cust);

      // Load tiers
      const { data: tierData } = await supabase
        .from("rebate_tiers")
        .select("*")
        .eq("rebate_customer_id", customerId)
        .order("sort_order");
      setTiers(tierData || []);

      // Load invoices
      const { data: invData } = await supabase
        .from("rebate_invoices")
        .select("*")
        .eq("rebate_customer_id", customerId)
        .order("billing_end_date", { ascending: true });
      setInvoices(invData || []);

      // Load quarterly summaries
      const { data: qtrData } = await supabase
        .from("rebate_quarterly_summaries")
        .select("*")
        .eq("rebate_customer_id", customerId)
        .order("year", { ascending: true });
      setQuarterlySummaries(qtrData || []);
    } finally {
      setLoading(false);
    }
  }, [supabase, customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/rebates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_customer",
          entityId,
          customerId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Synced ${data.synced} invoices, ${data.itemsSynced} items`);
        loadData();
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await fetch("/api/rebates/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "calculate_customer",
          entityId,
          customerId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Calculated rebates for ${data.invoiceCount} invoices: ${formatCurrency(data.totalRebate)}`,
        );
        loadData();
      } else {
        toast.error(data.error || "Calculation failed");
      }
    } catch {
      toast.error("Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const toggleInvoiceExpand = async (invoiceId: string) => {
    const next = new Set(expandedInvoices);
    if (next.has(invoiceId)) {
      next.delete(invoiceId);
    } else {
      next.add(invoiceId);
      // Load items if not cached
      if (!invoiceItems[invoiceId]) {
        const { data } = await supabase
          .from("rebate_invoice_items")
          .select("*")
          .eq("rebate_invoice_id", invoiceId);
        setInvoiceItems((prev) => ({ ...prev, [invoiceId]: data || [] }));
      }
    }
    setExpandedInvoices(next);
  };

  const handleToggleExclusion = async (invoice: RebateInvoice) => {
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_manual_exclusion",
          invoiceId: invoice.id,
          isExcluded: !invoice.is_manually_excluded,
          reason: !invoice.is_manually_excluded
            ? "Manually excluded"
            : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          invoice.is_manually_excluded
            ? "Invoice included"
            : "Invoice excluded",
        );
        loadData();
      }
    } catch {
      toast.error("Failed to toggle exclusion");
    }
  };

  const handleMarkPaid = async (summary: QuarterlySummary) => {
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_quarter_paid",
          summaryId: summary.id,
          isPaid: !summary.is_paid,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          summary.is_paid
            ? `${summary.quarter} marked unpaid`
            : `${summary.quarter} marked paid`,
        );
        loadData();
      }
    } catch {
      toast.error("Failed to update payment status");
    }
  };

  // Filter invoices by selected quarter
  const filteredInvoices =
    selectedQuarter === "all"
      ? invoices
      : invoices.filter((inv) => inv.quarter === selectedQuarter);

  // Get unique quarters for tabs
  const quarters = Array.from(
    new Set(invoices.map((inv) => inv.quarter).filter(Boolean)),
  ).sort();

  // Current quarter stats
  const currentQtr = getCurrentQuarter();
  const qtrSummary = quarterlySummaries.find((q) => q.quarter === currentQtr);

  // Cumulative totals
  const totalRevenue = invoices.reduce(
    (s, inv) => s + (inv.final_amount || 0),
    0,
  );
  const totalRebate = invoices.reduce(
    (s, inv) => s + (inv.net_rebate || 0),
    0,
  );

  // Tier progress
  const currentTier =
    tiers.find(
      (t) =>
        totalRevenue >= t.threshold_min &&
        (t.threshold_max == null || totalRevenue < t.threshold_max),
    ) || tiers[0];
  const nextTier = tiers.find((t) => t.threshold_min > totalRevenue);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6">
        <p>Customer not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/${entityId}/rebates`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">
                {customer.customer_name}
              </h1>
              <Badge
                variant={
                  customer.agreement_type === "commercial"
                    ? "default"
                    : "secondary"
                }
              >
                {customer.agreement_type}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {customer.rw_customer_id}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCalculate}
            disabled={calculating}
          >
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totalRevenue)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Rebate</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totalRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Tier</CardDescription>
            <CardTitle className="text-2xl">
              {currentTier?.label || "N/A"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Invoices</CardDescription>
            <CardTitle className="text-2xl">{invoices.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Tier Progress Bar */}
      {tiers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Tier Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{formatCurrency(totalRevenue)} cumulative revenue</span>
                {nextTier && (
                  <span>
                    {formatCurrency(nextTier.threshold_min - totalRevenue)} to
                    next tier ({nextTier.label})
                  </span>
                )}
              </div>
              <div className="h-3 bg-secondary rounded-full overflow-hidden">
                {tiers.map((tier, idx) => {
                  const max =
                    tier.threshold_max ||
                    Math.max(totalRevenue * 1.2, tier.threshold_min * 1.5);
                  const totalMax =
                    tiers[tiers.length - 1]?.threshold_max ||
                    Math.max(totalRevenue * 1.2, 500000);
                  const width = ((max - tier.threshold_min) / totalMax) * 100;
                  const isCurrent = tier === currentTier;
                  return (
                    <div
                      key={idx}
                      className={`h-full inline-block ${
                        isCurrent
                          ? "bg-primary"
                          : totalRevenue >= tier.threshold_min
                            ? "bg-primary/60"
                            : "bg-secondary"
                      }`}
                      style={{ width: `${Math.min(width, 100)}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                {tiers.map((tier, idx) => (
                  <span key={idx}>
                    {tier.label}: {formatCurrency(tier.threshold_min)}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quarterly Summaries */}
      {quarterlySummaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Quarterly Summaries</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Rebate</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quarterlySummaries.map((qs) => (
                  <TableRow key={qs.id}>
                    <TableCell className="font-medium">{qs.quarter}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(qs.total_revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(qs.total_rebate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {qs.invoice_count}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{qs.tier_label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={qs.is_paid ? "default" : "secondary"}
                        className={
                          qs.is_paid
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : ""
                        }
                      >
                        {qs.is_paid ? "Paid" : "Unpaid"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkPaid(qs)}
                      >
                        {qs.is_paid ? "Mark Unpaid" : "Mark Paid"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invoice Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
            <Tabs value={selectedQuarter} onValueChange={setSelectedQuarter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {quarters.map((q) => (
                  <TabsTrigger key={q} value={q!}>
                    {q}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No invoices found.</p>
              <p className="text-sm mt-1">
                Click &quot;Sync&quot; to pull invoices from RentalWorks.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead>Deal / Order</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">List Total</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Before Disc</TableHead>
                  <TableHead className="text-right">Rebate %</TableHead>
                  <TableHead className="text-right">Net Rebate</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((inv) => (
                  <Collapsible key={inv.id} asChild>
                    <>
                      <CollapsibleTrigger asChild>
                        <TableRow
                          className={`cursor-pointer ${
                            inv.is_manually_excluded
                              ? "opacity-50 line-through"
                              : ""
                          }`}
                          onClick={() => toggleInvoiceExpand(inv.id)}
                        >
                          <TableCell>
                            {expandedInvoices.has(inv.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {inv.invoice_number}
                          </TableCell>
                          <TableCell>
                            {inv.billing_end_date || inv.invoice_date || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{inv.quarter}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {inv.deal || inv.order_description || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {getEquipmentLabel(
                                inv.equipment_type as EquipmentType,
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.list_total)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.discount_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(inv.before_discount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatPct(inv.remaining_rebate_pct)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(inv.net_rebate)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleExclusion(inv);
                              }}
                              title={
                                inv.is_manually_excluded
                                  ? "Include invoice"
                                  : "Exclude invoice"
                              }
                            >
                              {inv.is_manually_excluded ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <Ban className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        {expandedInvoices.has(inv.id) ? (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={12}>
                              <div className="p-3 space-y-3">
                                {/* Invoice details */}
                                <div className="grid grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">
                                      Tier:{" "}
                                    </span>
                                    {inv.tier_label || "N/A"}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">
                                      Rebate Rate:{" "}
                                    </span>
                                    {formatPct(inv.rebate_rate)}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">
                                      Excluded Total:{" "}
                                    </span>
                                    {formatCurrency(inv.excluded_total)}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">
                                      Cumulative:{" "}
                                    </span>
                                    Rev {formatCurrency(inv.cumulative_revenue)} / Reb{" "}
                                    {formatCurrency(inv.cumulative_rebate)}
                                  </div>
                                </div>

                                {/* Line Items */}
                                {invoiceItems[inv.id] &&
                                  invoiceItems[inv.id].length > 0 && (
                                    <div>
                                      <h4 className="text-sm font-medium mb-2">
                                        Line Items
                                      </h4>
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>I-Code</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead className="text-right">
                                              Qty
                                            </TableHead>
                                            <TableHead className="text-right">
                                              Extended
                                            </TableHead>
                                            <TableHead>Status</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {invoiceItems[inv.id].map((item) => (
                                            <TableRow
                                              key={item.id}
                                              className={
                                                item.is_excluded
                                                  ? "bg-red-50 dark:bg-red-950/20"
                                                  : ""
                                              }
                                            >
                                              <TableCell className="font-mono text-xs">
                                                {item.i_code || "—"}
                                              </TableCell>
                                              <TableCell className="text-sm">
                                                {item.description || "—"}
                                              </TableCell>
                                              <TableCell className="text-right">
                                                {item.quantity}
                                              </TableCell>
                                              <TableCell className="text-right">
                                                {formatCurrency(item.extended)}
                                              </TableCell>
                                              <TableCell>
                                                {item.is_excluded && (
                                                  <Badge
                                                    variant="destructive"
                                                    className="text-xs"
                                                  >
                                                    Excluded
                                                  </Badge>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
