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
  taxable_sales: number | null;
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
  record_type: string | null;
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
  rw_customer_number: string | null;
  agreement_type: string;
  status: string;
  tax_rate: number;
}

interface TierData {
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  sort_order: number;
  rate_pro_supplies: number | null;
  rate_vehicle: number | null;
  rate_grip_lighting: number | null;
  rate_studio: number | null;
  max_disc_pro_supplies: number | null;
  max_disc_vehicle: number | null;
  max_disc_grip_lighting: number | null;
  max_disc_studio: number | null;
}

// Category grouping for invoice line items
const RECORD_TYPE_CATEGORIES = [
  { key: "R", label: "Rental", color: "text-blue-700 dark:text-blue-400" },
  { key: "S", label: "Sales", color: "text-green-700 dark:text-green-400" },
  { key: "L", label: "Loss & Damage", color: "text-orange-700 dark:text-orange-400" },
  { key: "M", label: "Miscellaneous", color: "text-purple-700 dark:text-purple-400" },
] as const;

function getRecordTypeLabel(rt: string | null): string {
  if (!rt) return "Other";
  const found = RECORD_TYPE_CATEGORIES.find((c) => c.key === rt);
  return found ? found.label : "Other";
}

function groupItemsByCategory(items: InvoiceItem[]) {
  const groups: Record<string, InvoiceItem[]> = {};
  for (const item of items) {
    const key = item.record_type || "O"; // O = Other/unknown
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
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
  const [excludedICodes, setExcludedICodes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      // Load customer
      const { data: cust } = await supabase
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();
      setCustomer(cust as CustomerData | null);

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

      // Load excluded I-codes (global + customer-specific) for client-side highlighting
      const codes = new Set<string>();
      if (cust?.use_global_exclusions) {
        const { data: globalCodes } = await supabase
          .from("rebate_excluded_icodes")
          .select("i_code")
          .eq("entity_id", entityId)
          .is("rebate_customer_id", null);
        for (const ic of globalCodes || []) {
          codes.add(ic.i_code.trim());
        }
      }
      const { data: customerCodes } = await supabase
        .from("rebate_excluded_icodes")
        .select("i_code")
        .eq("rebate_customer_id", customerId);
      for (const ic of customerCodes || []) {
        codes.add(ic.i_code.trim());
      }
      setExcludedICodes(codes);
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
                {customer.rw_customer_number
                  ? `#${customer.rw_customer_number}`
                  : customer.rw_customer_id}
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

      {/* Tier Rate Structure */}
      {tiers.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Rebate Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    <TableHead className="text-center">Pro Supply</TableHead>
                    <TableHead className="text-center">Vehicle</TableHead>
                    <TableHead className="text-center">G&L</TableHead>
                    <TableHead className="text-center">Studio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => {
                    const isCurrent = tier === currentTier;
                    const thresholdLabel = tier.threshold_max
                      ? `${formatCurrency(tier.threshold_min)} - ${formatCurrency(tier.threshold_max)}`
                      : `${formatCurrency(tier.threshold_min)}+`;
                    return (
                      <TableRow
                        key={tier.sort_order}
                        className={isCurrent ? "bg-green-50 dark:bg-green-950/20 font-medium" : ""}
                      >
                        <TableCell className="font-semibold">{thresholdLabel}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_pro_supplies)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_vehicle)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_grip_lighting)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.rate_studio)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Max Discount Allowed</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Threshold</TableHead>
                    <TableHead className="text-center">Pro Supply</TableHead>
                    <TableHead className="text-center">Vehicle</TableHead>
                    <TableHead className="text-center">G&L</TableHead>
                    <TableHead className="text-center">Studio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => {
                    const isCurrent = tier === currentTier;
                    const thresholdLabel = tier.threshold_max
                      ? `${formatCurrency(tier.threshold_min)} - ${formatCurrency(tier.threshold_max)}`
                      : `${formatCurrency(tier.threshold_min)}+`;
                    return (
                      <TableRow
                        key={tier.sort_order}
                        className={isCurrent ? "bg-green-50 dark:bg-green-950/20 font-medium" : ""}
                      >
                        <TableCell className="font-semibold">{thresholdLabel}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_pro_supplies)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_vehicle)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_grip_lighting)}</TableCell>
                        <TableCell className="text-center">{formatPct(tier.max_disc_studio)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
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
                              <div className="p-3 space-y-4">
                                {/* Calculation Breakdown + Meta */}
                                <div className="flex gap-6">
                                  {/* Calculation Breakdown Table */}
                                  <div className="w-80 shrink-0">
                                    <h4 className="text-sm font-medium mb-2">Calculation Breakdown</h4>
                                    <div className="border rounded-md overflow-hidden text-sm">
                                      {(() => {
                                        const isCommercial = customer.agreement_type === "commercial";
                                        const rows: { label: string; value: string; highlight?: "red" | "yellow" | "green" }[] = isCommercial
                                          ? [
                                              { label: "Gross Invoice Total", value: formatCurrency(inv.list_total) },
                                              { label: "Excluded", value: formatCurrency(inv.excluded_total), highlight: "red" },
                                              { label: "Tax", value: formatCurrency(inv.tax_amount) },
                                              { label: "Taxable Sales", value: formatCurrency(inv.taxable_sales) },
                                              { label: "Before Discount", value: formatCurrency(inv.before_discount), highlight: "yellow" },
                                              { label: "Discount", value: formatCurrency(inv.discount_amount) },
                                              { label: "Discount %", value: formatPct(inv.discount_percent) },
                                              { label: "Final Amount", value: formatCurrency(inv.final_amount) },
                                              { label: "Remaining Rebate", value: formatPct(inv.remaining_rebate_pct) },
                                              { label: "Net Rebate", value: formatCurrency(inv.net_rebate), highlight: "green" },
                                            ]
                                          : [
                                              { label: "List Total", value: formatCurrency(inv.list_total) },
                                              { label: "Excluded", value: formatCurrency(inv.excluded_total), highlight: "red" },
                                              { label: "Sub Total", value: formatCurrency(inv.sub_total) },
                                              { label: "Before Discount", value: formatCurrency(inv.before_discount), highlight: "yellow" },
                                              { label: "Discount", value: formatCurrency(inv.discount_amount) },
                                              { label: "Discount %", value: formatPct(inv.discount_percent) },
                                              { label: "Final Amount", value: formatCurrency(inv.final_amount) },
                                              { label: "Remaining Rebate", value: formatPct(inv.remaining_rebate_pct) },
                                              { label: "Net Rebate", value: formatCurrency(inv.net_rebate), highlight: "green" },
                                            ];

                                        return rows.map((row, idx) => (
                                          <div
                                            key={idx}
                                            className={`flex items-center justify-between px-3 py-1.5 border-b last:border-b-0 ${
                                              row.highlight === "red"
                                                ? "bg-red-100 dark:bg-red-950/30 text-red-900 dark:text-red-200"
                                                : row.highlight === "yellow"
                                                  ? "bg-yellow-100 dark:bg-yellow-950/30 text-yellow-900 dark:text-yellow-200"
                                                  : row.highlight === "green"
                                                    ? "bg-green-100 dark:bg-green-950/30 text-green-900 dark:text-green-200 font-semibold"
                                                    : ""
                                            }`}
                                          >
                                            <span>{row.label}</span>
                                            <span className="font-mono tabular-nums">{row.value}</span>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  </div>

                                  {/* Invoice Meta */}
                                  <div className="flex-1 space-y-3 text-sm">
                                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                      <div>
                                        <span className="text-muted-foreground">Tier: </span>
                                        {inv.tier_label || "N/A"}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Rebate Rate: </span>
                                        {formatPct(inv.rebate_rate)}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Cumulative Revenue: </span>
                                        {formatCurrency(inv.cumulative_revenue)}
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Cumulative Rebate: </span>
                                        {formatCurrency(inv.cumulative_rebate)}
                                      </div>
                                    </div>

                                    {/* Line Items by Category */}
                                    {invoiceItems[inv.id] &&
                                      invoiceItems[inv.id].length > 0 && (() => {
                                        const grouped = groupItemsByCategory(invoiceItems[inv.id]);
                                        const orderedKeys = [
                                          ...RECORD_TYPE_CATEGORIES.map((c) => c.key).filter((k) => grouped[k]),
                                          ...Object.keys(grouped).filter(
                                            (k) => !RECORD_TYPE_CATEGORIES.some((c) => c.key === k),
                                          ),
                                        ];

                                        return (
                                          <div className="space-y-1">
                                            <h4 className="text-sm font-medium mb-2">Line Items</h4>
                                            {orderedKeys.map((catKey) => {
                                              const items = grouped[catKey];
                                              const catConfig = RECORD_TYPE_CATEGORIES.find((c) => c.key === catKey);
                                              const label = catConfig?.label || "Other";
                                              const colorClass = catConfig?.color || "text-muted-foreground";
                                              const expandKey = `${inv.id}:${catKey}`;
                                              const isExpanded = expandedCategories.has(expandKey);

                                              const catTotal = items.reduce((s, it) => s + (it.extended || 0), 0);
                                              const excludedItems = items.filter((it) => {
                                                const byICode = it.i_code != null && excludedICodes.has(it.i_code.trim());
                                                return it.is_excluded || byICode;
                                              });
                                              const excludedTotal = excludedItems.reduce(
                                                (s, it) => s + (it.extended || 0),
                                                0,
                                              );

                                              return (
                                                <div key={catKey} className="border rounded-md">
                                                  <button
                                                    type="button"
                                                    className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                                    onClick={() => {
                                                      setExpandedCategories((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(expandKey)) next.delete(expandKey);
                                                        else next.add(expandKey);
                                                        return next;
                                                      });
                                                    }}
                                                  >
                                                    <div className="flex items-center gap-2">
                                                      {isExpanded ? (
                                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                      ) : (
                                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                      )}
                                                      <span className={`font-medium ${colorClass}`}>
                                                        {label}
                                                      </span>
                                                      <span className="text-muted-foreground">
                                                        ({items.length} item{items.length !== 1 ? "s" : ""})
                                                      </span>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs">
                                                      {excludedTotal > 0 && (
                                                        <span className="text-red-600 dark:text-red-400 font-medium">
                                                          Excluded: {formatCurrency(excludedTotal)}
                                                        </span>
                                                      )}
                                                      <span className="font-medium">
                                                        {formatCurrency(catTotal)}
                                                      </span>
                                                    </div>
                                                  </button>

                                                  {isExpanded && (
                                                    <div className="border-t">
                                                      <Table>
                                                        <TableHeader>
                                                          <TableRow>
                                                            <TableHead>I-Code</TableHead>
                                                            <TableHead>Description</TableHead>
                                                            <TableHead className="text-right">Qty</TableHead>
                                                            <TableHead className="text-right">Extended</TableHead>
                                                            <TableHead>Status</TableHead>
                                                          </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                          {[...excludedItems, ...items.filter((it) => {
                                                            const byICode = it.i_code != null && excludedICodes.has(it.i_code.trim());
                                                            return !(it.is_excluded || byICode);
                                                          })].map((item) => {
                                                            const isExcludedByICode =
                                                              item.i_code != null &&
                                                              excludedICodes.has(item.i_code.trim());
                                                            const isExcluded =
                                                              item.is_excluded || isExcludedByICode;
                                                            return (
                                                              <TableRow
                                                                key={item.id}
                                                                className={
                                                                  isExcluded
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
                                                                  {isExcluded && (
                                                                    <Badge
                                                                      variant="destructive"
                                                                      className="text-xs"
                                                                    >
                                                                      Excluded
                                                                    </Badge>
                                                                  )}
                                                                </TableCell>
                                                              </TableRow>
                                                            );
                                                          })}
                                                        </TableBody>
                                                      </Table>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })()}
                                  </div>
                                </div>
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
