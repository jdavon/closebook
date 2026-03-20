"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Settings,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  RECON_GROUPS,
  UNALLOCATED_KEY,
  getAssetGLGroup,
  type ReconGroup,
} from "@/lib/utils/asset-gl-groups";
import {
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";

interface ReconciliationTabProps {
  entityId: string;
}

interface AssetRow {
  id: string;
  asset_name: string;
  vehicle_class: string | null;
  acquisition_cost: number;
  book_accumulated_depreciation: number;
  book_net_value: number;
}

/** Per-period depreciation row */
interface DeprRow {
  fixed_asset_id: string;
  book_accumulated: number;
  book_net_value: number;
}

interface SubledgerGroup {
  total: number;
  assets: Array<AssetRow & { periodValue: number }>;
}

interface ReconciliationRecord {
  id: string;
  gl_account_group: string;
  gl_balance: number | null;
  subledger_balance: number | null;
  variance: number | null;
  is_reconciled: boolean;
  reconciled_at: string | null;
  notes: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ReconciliationTab({ entityId }: ReconciliationTabProps) {
  const supabase = createClient();
  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);
  const [glBalances, setGlBalances] = useState<Record<string, number>>({});
  const [subledgerBalances, setSubledgerBalances] = useState<
    Record<string, SubledgerGroup>
  >({});
  const [reconciliations, setReconciliations] = useState<
    Record<string, ReconciliationRecord>
  >({});
  const [missingLinks, setMissingLinks] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);

    // 0. Load custom classes
    const ccRes = await fetch(`/api/assets/classes?entityId=${entityId}`);
    let cc: VehicleClassification[] = [];
    if (ccRes.ok) {
      const rows: CustomVehicleClassRow[] = await ccRes.json();
      cc = customRowsToClassifications(rows);
      setCustomClasses(cc);
    }

    // 1. Fetch GL account links for this entity
    const { data: linkData } = await supabase
      .from("asset_recon_gl_links")
      .select("recon_group, account_id")
      .eq("entity_id", entityId);

    const linkMap: Record<string, string> = {};
    for (const row of linkData ?? []) {
      linkMap[row.recon_group] = row.account_id;
    }

    // Check which recon groups are missing a link
    const missing = RECON_GROUPS
      .filter((g) => !linkMap[g.key])
      .map((g) => g.key);
    setMissingLinks(missing);

    // 2. Fetch GL balances from linked accounts
    const balances: Record<string, number> = {};
    for (const group of RECON_GROUPS) {
      balances[group.key] = 0;
      const accountId = linkMap[group.key];
      if (!accountId) continue;

      const { data: glData } = await supabase
        .from("gl_balances")
        .select("ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .eq("account_id", accountId);

      balances[group.key] = (glData ?? []).reduce(
        (sum, row) => sum + Number(row.ending_balance ?? 0),
        0
      );
    }
    setGlBalances(balances);

    // 3. Fetch all assets with accum depr
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, vehicle_class, acquisition_cost, book_accumulated_depreciation, book_net_value"
      )
      .eq("entity_id", entityId);

    const assets = (assetsData ?? []) as AssetRow[];

    // 4. Fetch depreciation entries for this period (for period-specific accum depr)
    const assetIds = assets.map((a) => a.id);
    let deprMap: Record<string, DeprRow> = {};
    if (assetIds.length > 0) {
      // Paginate to handle large sets
      for (let i = 0; i < assetIds.length; i += 500) {
        const batch = assetIds.slice(i, i + 500);
        const { data: deprData } = await supabase
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, book_accumulated, book_net_value")
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth)
          .in("fixed_asset_id", batch);

        for (const d of (deprData ?? []) as DeprRow[]) {
          deprMap[d.fixed_asset_id] = d;
        }
      }
    }

    // 5. Group assets by recon group and compute totals
    const grouped: Record<string, SubledgerGroup> = {};
    for (const group of RECON_GROUPS) {
      grouped[group.key] = { total: 0, assets: [] };
    }
    grouped[UNALLOCATED_KEY] = { total: 0, assets: [] };

    for (const asset of assets) {
      const glGroup = getAssetGLGroup(asset.vehicle_class, cc);
      if (!glGroup) {
        // Unallocated — add to unallocated bucket (use NBV)
        const depr = deprMap[asset.id];
        const nbv = depr ? Number(depr.book_net_value) : asset.book_net_value;
        grouped[UNALLOCATED_KEY].total += nbv;
        grouped[UNALLOCATED_KEY].assets.push({ ...asset, periodValue: nbv });
        continue;
      }

      const costKey = `${glGroup}_cost`;
      const accumKey = `${glGroup}_accum_depr`;

      const depr = deprMap[asset.id];
      const cost = asset.acquisition_cost;
      // Accum depr should be negative (contra-asset), matching GL convention
      const accumDepr = depr
        ? -Math.abs(Number(depr.book_accumulated))
        : -Math.abs(asset.book_accumulated_depreciation);

      if (grouped[costKey]) {
        grouped[costKey].total += cost;
        grouped[costKey].assets.push({ ...asset, periodValue: cost });
      }
      if (grouped[accumKey]) {
        grouped[accumKey].total += accumDepr;
        grouped[accumKey].assets.push({ ...asset, periodValue: accumDepr });
      }
    }
    setSubledgerBalances(grouped);

    // 6. Fetch existing reconciliation records
    const { data: reconData } = await supabase
      .from("asset_reconciliations")
      .select("*")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const reconMap: Record<string, ReconciliationRecord> = {};
    const notesMap: Record<string, string> = {};
    for (const r of (reconData ?? []) as ReconciliationRecord[]) {
      reconMap[r.gl_account_group] = r;
      notesMap[r.gl_account_group] = r.notes ?? "";
    }
    setReconciliations(reconMap);
    setNotes(notesMap);

    setLoading(false);
  }, [supabase, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleReconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const glBal = glBalances[groupKey] ?? 0;
    const subBal = subledgerBalances[groupKey]?.total ?? 0;
    const variance = glBal - subBal;

    const { data: userData } = await supabase.auth.getUser();

    await supabase.from("asset_reconciliations").upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        gl_account_group: groupKey,
        gl_balance: glBal,
        subledger_balance: subBal,
        variance,
        is_reconciled: true,
        reconciled_by: userData?.user?.id ?? null,
        reconciled_at: new Date().toISOString(),
        notes: notes[groupKey] || null,
      },
      { onConflict: "entity_id,period_year,period_month,gl_account_group" }
    );

    setSaving(null);
    loadData();
  };

  const handleUnreconcile = async (groupKey: string) => {
    setSaving(groupKey);
    const recon = reconciliations[groupKey];
    if (recon) {
      await supabase
        .from("asset_reconciliations")
        .update({
          is_reconciled: false,
          reconciled_at: null,
          reconciled_by: null,
        })
        .eq("id", recon.id);
    }
    setSaving(null);
    loadData();
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  // Group recon groups by master type for display
  const vehicleGroups = RECON_GROUPS.filter((g) => g.masterType === "Vehicle");
  const trailerGroups = RECON_GROUPS.filter((g) => g.masterType === "Trailer");

  function renderReconCard(group: ReconGroup) {
    const glBal = glBalances[group.key] ?? 0;
    const subBal = subledgerBalances[group.key]?.total ?? 0;
    const variance = glBal - subBal;
    const recon = reconciliations[group.key];
    const isReconciled = recon?.is_reconciled ?? false;
    const assetList = subledgerBalances[group.key]?.assets ?? [];
    const isExpanded = expandedGroups.has(group.key);
    const isMissing = missingLinks.includes(group.key);

    return (
      <Card key={group.key} className={isMissing ? "border-amber-300" : undefined}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{group.displayName}</CardTitle>
            {isMissing ? (
              <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-100">
                <Settings className="mr-1 h-3 w-3" />
                No GL Account
              </Badge>
            ) : isReconciled ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Reconciled
              </Badge>
            ) : Math.abs(variance) > 0.01 ? (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Variance
              </Badge>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                GL Balance
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {isMissing ? "—" : formatCurrency(glBal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Subledger
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(subBal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Variance
              </p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  isMissing
                    ? "text-muted-foreground"
                    : Math.abs(variance) > 0.01
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                {isMissing ? "—" : formatCurrency(variance)}
              </p>
            </div>
          </div>

          {/* Asset detail */}
          <Collapsible
            open={isExpanded}
            onOpenChange={() => toggleGroup(group.key)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
              >
                {isExpanded ? (
                  <ChevronDown className="mr-2 h-4 w-4" />
                ) : (
                  <ChevronRight className="mr-2 h-4 w-4" />
                )}
                {assetList.length} asset{assetList.length !== 1 ? "s" : ""} in
                group
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 max-h-60 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="text-right">
                        {group.lineType === "cost" ? "Cost" : "Accum Depr"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assetList.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-sm">
                          {a.asset_name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatCurrency(a.periodValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Notes */}
          <Textarea
            placeholder="Reconciliation notes..."
            value={notes[group.key] ?? ""}
            onChange={(e) =>
              setNotes((prev) => ({ ...prev, [group.key]: e.target.value }))
            }
            className="text-sm"
            rows={2}
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            {recon?.reconciled_at && (
              <p className="text-xs text-muted-foreground">
                Reconciled{" "}
                {new Date(recon.reconciled_at).toLocaleDateString()}
              </p>
            )}
            <div className="ml-auto flex gap-2">
              {isReconciled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnreconcile(group.key)}
                  disabled={saving === group.key}
                >
                  {saving === group.key ? "Saving..." : "Unreconcile"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleReconcile(group.key)}
                  disabled={saving === group.key || isMissing}
                >
                  {saving === group.key ? "Saving..." : "Mark Reconciled"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Select
            value={String(periodMonth)}
            onValueChange={(v) => setPeriodMonth(Number(v))}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(periodYear)}
            onValueChange={(v) => setPeriodYear(Number(v))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Missing links warning */}
      {missingLinks.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-start gap-2">
            <Settings className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">
                GL accounts not configured
              </p>
              <p className="text-amber-700 mt-1">
                Open <strong>Edit Settings</strong> to link GL accounts for:{" "}
                {missingLinks
                  .map(
                    (k) =>
                      RECON_GROUPS.find((g) => g.key === k)?.displayName ?? k
                  )
                  .join(", ")}
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading reconciliation data...
        </p>
      ) : (
        <div className="space-y-8">
          {/* Vehicles section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Vehicles
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {vehicleGroups.map(renderReconCard)}
            </div>
            {/* Net summary */}
            {(() => {
              const costBal = glBalances["vehicles_cost"] ?? 0;
              const accumBal = glBalances["vehicles_accum_depr"] ?? 0;
              const glNet = costBal + accumBal;
              const subCost = subledgerBalances["vehicles_cost"]?.total ?? 0;
              const subAccum =
                subledgerBalances["vehicles_accum_depr"]?.total ?? 0;
              const subNet = subCost + subAccum;
              const netVariance = glNet - subNet;
              return (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        GL Net (Vehicles)
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(glNet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Subledger Net
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(subNet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Net Variance
                      </p>
                      <p
                        className={`text-lg font-semibold tabular-nums ${
                          Math.abs(netVariance) > 0.01
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {formatCurrency(netVariance)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Trailers section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Trailers
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {trailerGroups.map(renderReconCard)}
            </div>
            {/* Net summary */}
            {(() => {
              const costBal = glBalances["trailers_cost"] ?? 0;
              const accumBal = glBalances["trailers_accum_depr"] ?? 0;
              const glNet = costBal + accumBal;
              const subCost = subledgerBalances["trailers_cost"]?.total ?? 0;
              const subAccum =
                subledgerBalances["trailers_accum_depr"]?.total ?? 0;
              const subNet = subCost + subAccum;
              const netVariance = glNet - subNet;
              return (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        GL Net (Trailers)
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(glNet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Subledger Net
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(subNet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Net Variance
                      </p>
                      <p
                        className={`text-lg font-semibold tabular-nums ${
                          Math.abs(netVariance) > 0.01
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {formatCurrency(netVariance)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Unallocated Assets */}
          {(() => {
            const unallocated = subledgerBalances[UNALLOCATED_KEY];
            if (!unallocated || unallocated.assets.length === 0) return null;
            const isExpanded = expandedGroups.has(UNALLOCATED_KEY);

            return (
              <Card className="border-amber-300 bg-amber-50/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Unallocated Assets
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-amber-500 text-amber-700 bg-amber-100"
                    >
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                      Needs Classification
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    These assets have no vehicle class or an unrecognized class.
                    Assign a vehicle class to each asset so it maps to the
                    correct GL account group.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Total Cost
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(
                          unallocated.assets.reduce(
                            (s, a) => s + a.acquisition_cost,
                            0
                          )
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        Total NBV
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(unallocated.total)}
                      </p>
                    </div>
                  </div>

                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleGroup(UNALLOCATED_KEY)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                      >
                        {isExpanded ? (
                          <ChevronDown className="mr-2 h-4 w-4" />
                        ) : (
                          <ChevronRight className="mr-2 h-4 w-4" />
                        )}
                        {unallocated.assets.length} unallocated asset
                        {unallocated.assets.length !== 1 ? "s" : ""}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 max-h-80 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead>Class</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">NBV</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unallocated.assets.map((a) => (
                              <TableRow key={a.id}>
                                <TableCell className="text-sm">
                                  {a.asset_name}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {a.vehicle_class ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatCurrency(a.acquisition_cost)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatCurrency(a.periodValue)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}
