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
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  GL_ACCOUNT_GROUPS,
  UNALLOCATED_KEY,
  getAssetGLGroup,
} from "@/lib/utils/asset-gl-groups";

interface ReconciliationTabProps {
  entityId: string;
}

interface AssetWithDepr {
  id: string;
  asset_name: string;
  vehicle_class: string | null;
  acquisition_cost: number;
  book_net_value: number;
  depr_book_net_value: number | null;
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

  // Data
  const [glBalances, setGlBalances] = useState<
    Record<string, number>
  >({});
  const [subledgerBalances, setSubledgerBalances] = useState<
    Record<string, { total: number; assets: AssetWithDepr[] }>
  >({});
  const [reconciliations, setReconciliations] = useState<
    Record<string, ReconciliationRecord>
  >({});

  const loadData = useCallback(async () => {
    setLoading(true);

    // 1. Look up the entity's organization_id
    const { data: entityData, error: entityErr } = await supabase
      .from("entities")
      .select("organization_id")
      .eq("id", entityId)
      .single();
    const orgId = entityData?.organization_id;
    if (entityErr) console.error("[Recon] Entity lookup error:", entityErr.message);
    if (!orgId) console.warn("[Recon] No orgId found for entity", entityId);

    // 2. Fetch GL balances via master_accounts → master_account_mappings → gl_balances
    //    This is the same path the financial statements use.
    const balances: Record<string, number> = {};
    for (const group of GL_ACCOUNT_GROUPS) {
      balances[group.key] = 0;

      if (!orgId) continue;

      // Find the master account by name (more reliable than account_number which
      // may not have been set to the template value during initial setup).
      const { data: masterAccts, error: maErr } = await supabase
        .from("master_accounts")
        .select("id, account_number")
        .eq("organization_id", orgId)
        .eq("name", group.displayName);

      if (maErr) console.error(`[Recon] Master account lookup error for "${group.displayName}":`, maErr.message);

      const masterAcct = masterAccts?.[0];
      if (!masterAcct) {
        console.warn(`[Recon] No master account found for "${group.displayName}" (org: ${orgId})`);
        continue;
      }
      console.log(`[Recon] Found master account "${group.displayName}": id=${masterAcct.id}, acctNum=${masterAcct.account_number}`);

      // Find all entity account IDs mapped to this master account
      const { data: mappings, error: mapErr } = await supabase
        .from("master_account_mappings")
        .select("account_id")
        .eq("master_account_id", masterAcct.id)
        .eq("entity_id", entityId);

      if (mapErr) console.error(`[Recon] Mapping lookup error:`, mapErr.message);

      const accountIds = (mappings ?? []).map((m) => m.account_id);
      if (accountIds.length === 0) {
        console.warn(`[Recon] No entity account mappings found for master "${group.displayName}" + entity ${entityId}`);
        continue;
      }
      console.log(`[Recon] Found ${accountIds.length} mapped entity accounts for "${group.displayName}"`);

      // Sum GL balances for these mapped accounts in the selected period
      const { data: glData, error: glErr } = await supabase
        .from("gl_balances")
        .select("ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("account_id", accountIds);

      if (glErr) console.error(`[Recon] GL balances error:`, glErr.message);

      const total = (glData ?? []).reduce(
        (sum, row) => sum + Number(row.ending_balance ?? 0),
        0
      );
      console.log(`[Recon] GL balance for "${group.displayName}" (${periodMonth}/${periodYear}): ${total} from ${glData?.length ?? 0} rows`);
      balances[group.key] = total;
    }
    setGlBalances(balances);

    // 3. Fetch all assets with their depreciation for this period
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select("id, asset_name, vehicle_class, acquisition_cost, book_net_value")
      .eq("entity_id", entityId);

    const assets = (assetsData ?? []) as {
      id: string;
      asset_name: string;
      vehicle_class: string | null;
      acquisition_cost: number;
      book_net_value: number;
    }[];

    // Fetch depreciation entries for this period
    const assetIds = assets.map((a) => a.id);
    let deprMap: Record<string, number> = {};
    if (assetIds.length > 0) {
      const { data: deprData } = await supabase
        .from("fixed_asset_depreciation")
        .select("fixed_asset_id, book_net_value")
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("fixed_asset_id", assetIds);
      deprMap = Object.fromEntries(
        (deprData ?? []).map((d) => [
          d.fixed_asset_id,
          Number(d.book_net_value ?? 0),
        ])
      );
    }

    // Group by GL account group (+ catch-all for unallocated)
    const grouped: Record<string, { total: number; assets: AssetWithDepr[] }> = {};
    for (const group of GL_ACCOUNT_GROUPS) {
      grouped[group.key] = { total: 0, assets: [] };
    }
    grouped[UNALLOCATED_KEY] = { total: 0, assets: [] };

    for (const asset of assets) {
      const groupKey = getAssetGLGroup(asset.vehicle_class) ?? UNALLOCATED_KEY;
      const deprNbv = deprMap[asset.id] ?? null;
      // Use depreciation table value if available, otherwise fall back to current book_net_value
      const nbv = deprNbv ?? asset.book_net_value;
      grouped[groupKey].total += nbv;
      grouped[groupKey].assets.push({
        ...asset,
        depr_book_net_value: deprNbv,
      });
    }
    setSubledgerBalances(grouped);

    // 4. Fetch existing reconciliation records
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
        .update({ is_reconciled: false, reconciled_at: null, reconciled_by: null })
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading reconciliation data...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {GL_ACCOUNT_GROUPS.map((group) => {
              const glBal = glBalances[group.key] ?? 0;
              const subBal = subledgerBalances[group.key]?.total ?? 0;
              const variance = glBal - subBal;
              const recon = reconciliations[group.key];
              const isReconciled = recon?.is_reconciled ?? false;
              const assetList = subledgerBalances[group.key]?.assets ?? [];
              const isExpanded = expandedGroups.has(group.key);

              return (
                <Card key={group.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{group.displayName}</CardTitle>
                      {isReconciled ? (
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
                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          GL Balance
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(glBal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Subledger NBV
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
                            Math.abs(variance) > 0.01
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {formatCurrency(variance)}
                        </p>
                      </div>
                    </div>

                    {/* Asset Detail Expandable */}
                    <Collapsible
                      open={isExpanded}
                      onOpenChange={() => toggleGroup(group.key)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-start">
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
                                <TableHead className="text-right">Cost</TableHead>
                                <TableHead className="text-right">Book NBV</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {assetList.map((a) => (
                                <TableRow key={a.id}>
                                  <TableCell className="text-sm">
                                    {a.asset_name}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">
                                    {formatCurrency(a.acquisition_cost)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-sm">
                                    {formatCurrency(
                                      a.depr_book_net_value ?? a.book_net_value
                                    )}
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
                            disabled={saving === group.key}
                          >
                            {saving === group.key ? "Saving..." : "Mark Reconciled"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Unallocated Assets — always show if any exist */}
          {(() => {
            const unallocated = subledgerBalances[UNALLOCATED_KEY];
            if (!unallocated || unallocated.assets.length === 0) return null;
            const isExpanded = expandedGroups.has(UNALLOCATED_KEY);

            return (
              <Card className="border-amber-300 bg-amber-50/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Unallocated Assets</CardTitle>
                    <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-100">
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                      Needs Classification
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    These assets have no vehicle class or an unrecognized class and are not
                    included in any GL reconciliation group. Assign a vehicle class to each
                    asset so it maps to the correct GL account.
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
                          unallocated.assets.reduce((s, a) => s + a.acquisition_cost, 0)
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
                      <Button variant="ghost" size="sm" className="w-full justify-start">
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
                              <TableHead>Vehicle Class</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">Book NBV</TableHead>
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
                                  {formatCurrency(
                                    a.depr_book_net_value ?? a.book_net_value
                                  )}
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
