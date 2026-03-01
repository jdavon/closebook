"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  RefreshCw,
  Calculator,
  Settings,
  Loader2,
  Trash2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentQuarter } from "@/lib/utils/rebate-calculations";

interface RebateCustomer {
  id: string;
  customer_name: string;
  rw_customer_id: string;
  agreement_type: string;
  status: string;
  tax_rate: number;
  max_discount_percent: number | null;
  effective_date: string | null;
  use_global_exclusions: boolean;
  notes: string | null;
}

interface RebateTier {
  id?: string;
  label: string;
  threshold_min: number;
  threshold_max: number | null;
  rate_pro_supplies: number;
  rate_vehicle: number;
  rate_grip_lighting: number;
  rate_studio: number;
  max_disc_pro_supplies: number;
  max_disc_vehicle: number;
  max_disc_grip_lighting: number;
  max_disc_studio: number;
}

interface QuarterlySummary {
  id: string;
  quarter: string;
  total_revenue: number;
  total_rebate: number;
  invoice_count: number;
  tier_label: string | null;
  is_paid: boolean;
}

interface RWCustomerResult {
  Customer: string;
  CustomerId: string;
  CustomerNumber: string;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

const EMPTY_TIER: RebateTier = {
  label: "",
  threshold_min: 0,
  threshold_max: null,
  rate_pro_supplies: 0,
  rate_vehicle: 0,
  rate_grip_lighting: 0,
  rate_studio: 0,
  max_disc_pro_supplies: 0,
  max_disc_vehicle: 0,
  max_disc_grip_lighting: 0,
  max_disc_studio: 0,
};

export default function RebateTrackerPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;

  const [customers, setCustomers] = useState<RebateCustomer[]>([]);
  const [allTiers, setAllTiers] = useState<Record<string, RebateTier[]>>({});
  const [quarterlySummaries, setQuarterlySummaries] = useState<
    Record<string, QuarterlySummary[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<RebateCustomer | null>(
    null,
  );
  const [formName, setFormName] = useState("");
  const [formRwId, setFormRwId] = useState("");
  const [formType, setFormType] = useState<string>("commercial");
  const [formTaxRate, setFormTaxRate] = useState("9.75");
  const [formMaxDiscount, setFormMaxDiscount] = useState("");
  const [formEffectiveDate, setFormEffectiveDate] = useState("");
  const [formUseGlobalExcl, setFormUseGlobalExcl] = useState(true);
  const [formNotes, setFormNotes] = useState("");
  const [formTiers, setFormTiers] = useState<RebateTier[]>([]);
  const [saving, setSaving] = useState(false);

  // RW customer search
  const [rwSearchQuery, setRwSearchQuery] = useState("");
  const [rwSearchResults, setRwSearchResults] = useState<RWCustomerResult[]>(
    [],
  );
  const [rwSearching, setRwSearching] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // Load config
      const configRes = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_config", entityId }),
      });
      const config = await configRes.json();

      setCustomers(config.customers || []);

      // Group tiers by customer
      const tierMap: Record<string, RebateTier[]> = {};
      for (const t of config.tiers || []) {
        if (!tierMap[t.rebate_customer_id]) tierMap[t.rebate_customer_id] = [];
        tierMap[t.rebate_customer_id].push(t);
      }
      setAllTiers(tierMap);

      // Load quarterly summaries for each customer
      const summaryMap: Record<string, QuarterlySummary[]> = {};
      for (const c of config.customers || []) {
        const res = await fetch("/api/rebates/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_summaries",
            entityId,
            customerId: c.id,
          }),
        });
        // This might 400 since we haven't implemented get_summaries - load from supabase directly
      }
      // For now, summaries loaded from the quarterly table via a lightweight fetch
      setQuarterlySummaries(summaryMap);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/rebates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_all", entityId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Synced ${data.results?.length || 0} customers from RentalWorks`,
        );
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

  const handleCalculateAll = async () => {
    setCalculating(true);
    try {
      const res = await fetch("/api/rebates/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calculate_all", entityId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Rebates calculated for all customers");
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

  const handleSearchRwCustomer = async () => {
    if (!rwSearchQuery.trim()) return;
    setRwSearching(true);
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search_rw_customers",
          query: rwSearchQuery,
        }),
      });
      const data = await res.json();
      setRwSearchResults(data.customers || []);
    } catch {
      toast.error("Search failed");
    } finally {
      setRwSearching(false);
    }
  };

  const selectRwCustomer = (c: RWCustomerResult) => {
    setFormName(c.Customer);
    setFormRwId(c.CustomerId);
    setRwSearchResults([]);
    setRwSearchQuery("");
  };

  const openAddDialog = () => {
    setEditingCustomer(null);
    setFormName("");
    setFormRwId("");
    setFormType("commercial");
    setFormTaxRate("9.75");
    setFormMaxDiscount("");
    setFormEffectiveDate("");
    setFormUseGlobalExcl(true);
    setFormNotes("");
    setFormTiers([
      {
        ...EMPTY_TIER,
        label: "Tier 1: $0 - $150k",
        threshold_min: 0,
        threshold_max: 150000,
      },
      {
        ...EMPTY_TIER,
        label: "Tier 2: $150k - $300k",
        threshold_min: 150000,
        threshold_max: 300000,
      },
      {
        ...EMPTY_TIER,
        label: "Tier 3: $300k+",
        threshold_min: 300000,
        threshold_max: null,
      },
    ]);
    setRwSearchQuery("");
    setRwSearchResults([]);
    setDialogOpen(true);
  };

  const openEditDialog = (c: RebateCustomer) => {
    setEditingCustomer(c);
    setFormName(c.customer_name);
    setFormRwId(c.rw_customer_id);
    setFormType(c.agreement_type);
    setFormTaxRate(String(c.tax_rate));
    setFormMaxDiscount(c.max_discount_percent ? String(c.max_discount_percent) : "");
    setFormEffectiveDate(c.effective_date || "");
    setFormUseGlobalExcl(c.use_global_exclusions);
    setFormNotes(c.notes || "");
    setFormTiers(allTiers[c.id] || [{ ...EMPTY_TIER, label: "Default" }]);
    setDialogOpen(true);
  };

  const handleSaveCustomer = async () => {
    if (!formName || !formRwId) {
      toast.error("Customer name and RW Customer ID are required");
      return;
    }
    if (formTiers.length === 0) {
      toast.error("At least one tier is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_customer",
          entityId,
          customer: {
            id: editingCustomer?.id,
            customer_name: formName,
            rw_customer_id: formRwId,
            agreement_type: formType,
            tax_rate: parseFloat(formTaxRate) || 9.75,
            max_discount_percent: formMaxDiscount
              ? parseFloat(formMaxDiscount)
              : null,
            effective_date: formEffectiveDate || null,
            use_global_exclusions: formUseGlobalExcl,
            notes: formNotes || null,
          },
          tiers: formTiers,
          excludedICodes: [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          editingCustomer ? "Customer updated" : "Customer added",
        );
        setDialogOpen(false);
        loadData();

        // Auto-trigger sync for new customers
        if (!editingCustomer && data.customerId) {
          toast.info("Starting initial invoice sync...");
          fetch("/api/rebates/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "sync_customer",
              entityId,
              customerId: data.customerId,
            }),
          }).then(async (syncRes) => {
            const syncData = await syncRes.json();
            if (syncData.success) {
              toast.success(`Synced ${syncData.synced} invoices`);
              loadData();
            }
          });
        }
      } else {
        toast.error(data.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!confirm("Delete this customer and all associated data?")) return;
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_customer", customerId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Customer deleted");
        loadData();
      } else {
        toast.error(data.error || "Delete failed");
      }
    } catch {
      toast.error("Delete failed");
    }
  };

  const updateTier = (idx: number, field: string, value: string | number | null) => {
    setFormTiers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addTier = () => {
    setFormTiers((prev) => [
      ...prev,
      { ...EMPTY_TIER, label: `Tier ${prev.length + 1}` },
    ]);
  };

  const removeTier = (idx: number) => {
    setFormTiers((prev) => prev.filter((_, i) => i !== idx));
  };

  // Compute YTD totals from quarterly summaries
  const currentYear = new Date().getFullYear();
  const currentQtr = getCurrentQuarter();

  const getCustomerYTDRevenue = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    return sums
      .filter((s) => s.quarter.startsWith(String(currentYear)))
      .reduce((total, s) => total + (s.total_revenue || 0), 0);
  };

  const getCustomerYTDRebate = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    return sums
      .filter((s) => s.quarter.startsWith(String(currentYear)))
      .reduce((total, s) => total + (s.total_rebate || 0), 0);
  };

  const getCustomerQtrRebate = (customerId: string) => {
    const sums = quarterlySummaries[customerId] || [];
    const qtr = sums.find((s) => s.quarter === currentQtr);
    return qtr?.total_rebate || 0;
  };

  const totalYTDRevenue = customers.reduce(
    (s, c) => s + getCustomerYTDRevenue(c.id),
    0,
  );
  const totalYTDRebate = customers.reduce(
    (s, c) => s + getCustomerYTDRebate(c.id),
    0,
  );
  const totalQtrRebate = customers.reduce(
    (s, c) => s + getCustomerQtrRebate(c.id),
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rebate Tracker</h1>
          <p className="text-muted-foreground">
            Track commercial exclusive rebate agreements
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${entityId}/rebates/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCalculateAll}
            disabled={calculating}
          >
            {calculating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate All
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Agreements</CardDescription>
            <CardTitle className="text-3xl">
              {customers.filter((c) => c.status === "active").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>YTD Revenue</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(totalYTDRevenue)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>YTD Rebates</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(totalYTDRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{currentQtr} Rebates</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(totalQtrRebate)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Customer Table */}
      <Card>
        <CardHeader>
          <CardTitle>Exclusive Agreements</CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No rebate customers yet.</p>
              <p className="text-sm mt-1">
                Click &quot;Add Customer&quot; to set up your first exclusive
                agreement.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>RW ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">YTD Revenue</TableHead>
                  <TableHead className="text-right">YTD Rebate</TableHead>
                  <TableHead className="text-right">
                    {currentQtr} Rebate
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/${entityId}/rebates/${c.id}`)
                    }
                  >
                    <TableCell className="font-medium">
                      {c.customer_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.rw_customer_id}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.agreement_type === "commercial"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {c.agreement_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === "active" ? "default" : "outline"
                        }
                        className={
                          c.status === "active"
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : ""
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRevenue(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerYTDRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(getCustomerQtrRebate(c.id))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleDeleteCustomer(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Customer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCustomer ? "Edit Customer" : "Add New Customer"}
            </DialogTitle>
            <DialogDescription>
              {editingCustomer
                ? "Update the rebate agreement configuration."
                : "Search RentalWorks for the customer, then configure their rebate agreement."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* RW Customer Search (only for new) */}
            {!editingCustomer && (
              <div className="space-y-2">
                <Label>Search RentalWorks Customer</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Type customer name..."
                    value={rwSearchQuery}
                    onChange={(e) => setRwSearchQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSearchRwCustomer()
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={handleSearchRwCustomer}
                    disabled={rwSearching}
                  >
                    {rwSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {rwSearchResults.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {rwSearchResults.map((r) => (
                      <button
                        key={r.CustomerId}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                        onClick={() => selectRwCustomer(r)}
                      >
                        <span className="font-medium">{r.Customer}</span>
                        <span className="text-muted-foreground ml-2">
                          ({r.CustomerId})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>RW Customer ID</Label>
                <Input
                  value={formRwId}
                  onChange={(e) => setFormRwId(e.target.value)}
                  placeholder="e.g., V100005"
                />
              </div>
              <div className="space-y-2">
                <Label>Agreement Type</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="freelancer">Freelancer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input
                  value={formTaxRate}
                  onChange={(e) => setFormTaxRate(e.target.value)}
                  type="number"
                  step="0.01"
                />
              </div>
              {formType === "freelancer" && (
                <div className="space-y-2">
                  <Label>Max Discount (%)</Label>
                  <Input
                    value={formMaxDiscount}
                    onChange={(e) => setFormMaxDiscount(e.target.value)}
                    type="number"
                    step="0.01"
                    placeholder="Global cap"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input
                  value={formEffectiveDate}
                  onChange={(e) => setFormEffectiveDate(e.target.value)}
                  type="date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formUseGlobalExcl}
                onCheckedChange={setFormUseGlobalExcl}
              />
              <Label>Use global I-Code exclusions</Label>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Tier Editor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Rebate Tiers</Label>
                <Button variant="outline" size="sm" onClick={addTier}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Tier
                </Button>
              </div>
              {formTiers.map((tier, idx) => (
                <Card key={idx} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-3 items-center flex-1">
                        <Input
                          value={tier.label}
                          onChange={(e) =>
                            updateTier(idx, "label", e.target.value)
                          }
                          placeholder="Tier label"
                          className="max-w-[200px]"
                        />
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={tier.threshold_min}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "threshold_min",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-28"
                          />
                          <span className="text-muted-foreground">to $</span>
                          <Input
                            type="number"
                            value={tier.threshold_max ?? ""}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "threshold_max",
                                e.target.value
                                  ? parseFloat(e.target.value)
                                  : null,
                              )
                            }
                            placeholder="No limit"
                            className="w-28"
                          />
                        </div>
                      </div>
                      {formTiers.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTier(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    {/* Rates grid */}
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Pro Supplies %
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.rate_pro_supplies}
                          onChange={(e) =>
                            updateTier(
                              idx,
                              "rate_pro_supplies",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Vehicle %
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.rate_vehicle}
                          onChange={(e) =>
                            updateTier(
                              idx,
                              "rate_vehicle",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          G&L %
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.rate_grip_lighting}
                          onChange={(e) =>
                            updateTier(
                              idx,
                              "rate_grip_lighting",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Studio %
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.rate_studio}
                          onChange={(e) =>
                            updateTier(
                              idx,
                              "rate_studio",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                        />
                      </div>
                    </div>

                    {/* Max discount rates (commercial only) */}
                    {formType === "commercial" && (
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Max Disc PS %
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={tier.max_disc_pro_supplies}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "max_disc_pro_supplies",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Max Disc Veh %
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={tier.max_disc_vehicle}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "max_disc_vehicle",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Max Disc G&L %
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={tier.max_disc_grip_lighting}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "max_disc_grip_lighting",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Max Disc Stu %
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={tier.max_disc_studio}
                            onChange={(e) =>
                              updateTier(
                                idx,
                                "max_disc_studio",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingCustomer ? "Save Changes" : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
