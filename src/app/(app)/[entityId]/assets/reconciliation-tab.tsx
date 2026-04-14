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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  ChevronLeft,
  Plus,
  X,
  Download,
} from "lucide-react";
import { formatCurrency, getPeriodShortLabel } from "@/lib/utils/dates";
import {
  RECON_GROUPS,
  UNALLOCATED_KEY,
  type ReconGroup,
} from "@/lib/utils/asset-gl-groups";
import {
  getEffectiveMasterType,
  getVehicleClassification,
  getReportingGroup,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import { toast } from "sonner";

interface ReconciliationTabProps {
  entityId: string;
}

interface EntityAccount {
  id: string;
  account_number: string | null;
  name: string;
  classification: string;
  account_type: string;
}

interface AssetRow {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_class: string | null;
  in_service_date: string | null;
  acquisition_cost: number;
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  book_accumulated_depreciation: number;
  book_net_value: number;
  status: string;
  disposed_date: string | null;
  cost_account_id: string | null;
  accum_depr_account_id: string | null;
  master_type_override: string | null;
}

interface DeprRow {
  fixed_asset_id: string;
  book_depreciation: number;
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
  const [entityAccounts, setEntityAccounts] = useState<EntityAccount[]>([]);
  const [mappedAccounts, setMappedAccounts] = useState<
    Record<string, { id: string; account_id: string }[]>
  >({});
  const [glBalances, setGlBalances] = useState<Record<string, number>>({});
  const [subledgerBalances, setSubledgerBalances] = useState<
    Record<string, SubledgerGroup>
  >({});
  const [reconciliations, setReconciliations] = useState<
    Record<string, ReconciliationRecord>
  >({});

  // All assets + depr data for export
  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);
  const [deprMapState, setDeprMapState] = useState<Record<string, DeprRow>>({});

  // Account picker state
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [accountSearch, setAccountSearch] = useState("");

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

    // 1. Fetch all entity accounts (for the picker)
    const { data: acctData } = await supabase
      .from("accounts")
      .select("id, account_number, name, classification, account_type")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number");

    setEntityAccounts((acctData ?? []) as EntityAccount[]);

    // 2. Fetch configured account mappings for this entity (via API to bypass RLS)
    const linkRes = await fetch(`/api/assets/recon-links?entityId=${entityId}`);
    const mappingData = linkRes.ok ? await linkRes.json() : [];

    const mapped: Record<string, { id: string; account_id: string }[]> = {};
    for (const group of RECON_GROUPS) {
      mapped[group.key] = [];
    }
    for (const m of (mappingData ?? []) as {
      id: string;
      recon_group: string;
      account_id: string;
    }[]) {
      if (!mapped[m.recon_group]) mapped[m.recon_group] = [];
      mapped[m.recon_group].push({ id: m.id, account_id: m.account_id });
    }
    setMappedAccounts(mapped);

    // 3. Fetch GL balances for all mapped accounts
    const allAccountIds = Object.values(mapped)
      .flat()
      .map((m) => m.account_id);
    const balances: Record<string, number> = {};

    if (allAccountIds.length > 0) {
      const { data: glData } = await supabase
        .from("gl_balances")
        .select("account_id, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth)
        .in("account_id", allAccountIds);

      const glMap: Record<string, number> = {};
      for (const row of (glData ?? []) as {
        account_id: string;
        ending_balance: number;
      }[]) {
        glMap[row.account_id] = Number(row.ending_balance ?? 0);
      }

      for (const group of RECON_GROUPS) {
        const groupAcctIds =
          mapped[group.key]?.map((m) => m.account_id) ?? [];
        balances[group.key] = groupAcctIds.reduce(
          (sum, id) => sum + (glMap[id] ?? 0),
          0
        );
      }
    }
    setGlBalances(balances);

    // 4. Fetch all assets with accum depr and GL overrides
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_class, in_service_date, acquisition_cost, book_useful_life_months, book_salvage_value, book_depreciation_method, book_accumulated_depreciation, book_net_value, status, disposed_date, cost_account_id, accum_depr_account_id, master_type_override"
      )
      .eq("entity_id", entityId);

    const allAssetsRaw = (assetsData ?? []) as AssetRow[];

    // Reconciliation is an as-of view: only include assets that existed and
    // were still held at the end of the selected period. Filter out assets
    // acquired after the period (future purchases) and assets disposed on or
    // before the period's last day (already sold by the reporting date).
    const periodLastDay = (() => {
      const d = new Date(periodYear, periodMonth, 0); // day 0 = last day of prior
      return d.toISOString().split("T")[0];
    })();
    const assets = allAssetsRaw.filter((a) => {
      const isd = a.in_service_date?.slice(0, 10) ?? null;
      if (!isd || isd > periodLastDay) return false;
      const dd = a.disposed_date?.slice(0, 10) ?? null;
      if (a.status === "disposed" && dd && dd <= periodLastDay) return false;
      return true;
    });

    // 5. Fetch depreciation entries for this period
    const assetIds = assets.map((a) => a.id);
    const deprMap: Record<string, DeprRow> = {};
    if (assetIds.length > 0) {
      for (let i = 0; i < assetIds.length; i += 500) {
        const batch = assetIds.slice(i, i + 500);
        const { data: deprData } = await supabase
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, book_depreciation, book_accumulated, book_net_value")
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth)
          .in("fixed_asset_id", batch);

        for (const d of (deprData ?? []) as DeprRow[]) {
          deprMap[d.fixed_asset_id] = d;
        }
      }
    }

    // Store for export
    setAllAssets(assets);
    setDeprMapState(deprMap);

    // 6. Group assets by recon group and compute totals
    //    If an asset has cost_account_id or accum_depr_account_id set,
    //    place it in whichever recon group has that account linked (GL override).
    //    Otherwise fall back to vehicle_class → master type mapping.
    const grouped: Record<string, SubledgerGroup> = {};
    for (const group of RECON_GROUPS) {
      grouped[group.key] = { total: 0, assets: [] };
    }
    grouped[UNALLOCATED_KEY] = { total: 0, assets: [] };

    // Build reverse lookup: account_id → recon group key
    const accountToReconGroup: Record<string, string> = {};
    for (const [groupKey, mappings] of Object.entries(mapped)) {
      for (const m of mappings) {
        accountToReconGroup[m.account_id] = groupKey;
      }
    }

    for (const asset of assets) {
      const depr = deprMap[asset.id];
      const cost = asset.acquisition_cost;
      // Accumulated depreciation is a contra-asset. The DB stores normal
      // depreciation as positive and adjustments can be negative. Simply
      // negate to convert to balance-sheet sign:
      //   DB +10000 (normal depr)  → subledger -10000
      //   DB -24.12 (reduce depr)  → subledger +24.12
      const rawAccum = depr
        ? Number(depr.book_accumulated)
        : asset.book_accumulated_depreciation;
      const accumDepr = -rawAccum;

      // Check for GL account override on the asset
      const costOverrideGroup = asset.cost_account_id
        ? accountToReconGroup[asset.cost_account_id]
        : null;
      const accumOverrideGroup = asset.accum_depr_account_id
        ? accountToReconGroup[asset.accum_depr_account_id]
        : null;

      // Determine cost group: override → vehicle class master type fallback
      let costKey: string | null = costOverrideGroup ?? null;
      let accumKey: string | null = accumOverrideGroup ?? null;

      if (!costKey || !accumKey) {
        // Fall back to vehicle class → master type → matching RECON_GROUP
        const mt = getEffectiveMasterType(
          asset.vehicle_class,
          asset.master_type_override,
          cc
        );
        if (mt) {
          if (!costKey) {
            const cg = RECON_GROUPS.find(
              (g) => g.masterType === mt && g.lineType === "cost"
            );
            if (cg) costKey = cg.key;
          }
          if (!accumKey) {
            const ag = RECON_GROUPS.find(
              (g) => g.masterType === mt && g.lineType === "accum_depr"
            );
            if (ag) accumKey = ag.key;
          }
        }
      }

      // If neither override nor class mapping, put in unallocated
      if (!costKey && !accumKey) {
        const nbv = depr ? Number(depr.book_net_value) : asset.book_net_value;
        grouped[UNALLOCATED_KEY].total += nbv;
        grouped[UNALLOCATED_KEY].assets.push({ ...asset, periodValue: nbv });
        continue;
      }

      if (costKey && grouped[costKey]) {
        grouped[costKey].total += cost;
        grouped[costKey].assets.push({ ...asset, periodValue: cost });
      }
      if (accumKey && grouped[accumKey]) {
        grouped[accumKey].total += accumDepr;
        grouped[accumKey].assets.push({ ...asset, periodValue: accumDepr });
      }
    }
    setSubledgerBalances(grouped);

    // 7. Fetch existing reconciliation records
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

  // -- Account linking (same pattern as debt reconciliation) --

  const handleAddAccounts = async (groupKey: string) => {
    if (selectedAccountIds.size === 0) return;
    setSaving(groupKey);

    let linked = 0;
    for (const accountId of selectedAccountIds) {
      const res = await fetch("/api/assets/recon-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          recon_group: groupKey,
          account_id: accountId,
        }),
      });
      if (res.ok) linked++;
    }

    if (linked > 0) {
      toast.success(`${linked} account${linked !== 1 ? "s" : ""} linked`);
      setAddingToGroup(null);
      setSelectedAccountIds(new Set());
      setAccountSearch("");
      loadData();
    } else {
      toast.error("Failed to link accounts");
    }
    setSaving(null);
  };

  const handleRemoveAccount = async (
    mappingId: string,
    groupKey: string
  ) => {
    setSaving(groupKey);
    await fetch(`/api/assets/recon-links?id=${mappingId}`, { method: "DELETE" });
    loadData();
    setSaving(null);
  };

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

  function handleExportCSV() {
    const periodLabel = getPeriodShortLabel(periodYear, periodMonth);
    const headers = [
      "Subledger Group",
      "Asset Tag",
      "Asset Name",
      "Class",
      "Class Name",
      "Reporting Group",
      "Master Type",
      "Status",
      "In Service Date",
      "Depr Method",
      "Useful Life (mo)",
      "Acquisition Cost",
      "Salvage Value",
      `Monthly Depr (${periodLabel})`,
      `Accum Depreciation (${periodLabel})`,
      `Net Book Value (${periodLabel})`,
    ];

    const rows: string[][] = [];

    for (const asset of allAssets) {
      const depr = deprMapState[asset.id];
      const classification = getVehicleClassification(asset.vehicle_class, customClasses);
      const mt = getEffectiveMasterType(
        asset.vehicle_class,
        asset.master_type_override,
        customClasses
      );

      // Determine which recon group this asset falls into
      let groupLabel = "Unallocated";
      const mtValue = mt;
      if (mtValue) {
        const costGroup = RECON_GROUPS.find(
          (g) => g.masterType === mtValue && g.lineType === "cost"
        );
        groupLabel = costGroup ? costGroup.displayName.replace(" — Cost", "") : mtValue;
      }

      const monthlyDepr = depr ? depr.book_depreciation : 0;
      const accumDepr = depr
        ? depr.book_accumulated
        : asset.book_accumulated_depreciation;
      const nbv = depr ? depr.book_net_value : asset.book_net_value;

      rows.push([
        groupLabel,
        asset.asset_tag ?? "",
        asset.asset_name,
        classification?.class ?? "",
        classification?.className ?? "",
        classification?.reportingGroup ?? "",
        mt ?? "",
        asset.status,
        asset.in_service_date ?? "",
        asset.book_depreciation_method.replace(/_/g, " "),
        String(asset.book_useful_life_months || ""),
        asset.acquisition_cost.toFixed(2),
        asset.book_salvage_value.toFixed(2),
        monthlyDepr.toFixed(2),
        accumDepr.toFixed(2),
        nbv.toFixed(2),
      ]);
    }

    // Sort by group then asset name
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            return str.includes(",") || str.includes('"')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asset-reconciliation-${periodYear}-${String(periodMonth).padStart(2, "0")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const accountsById = Object.fromEntries(
    entityAccounts.map((a) => [a.id, a])
  );
  const allMappedAccountIds = new Set(
    Object.values(mappedAccounts).flat().map((m) => m.account_id)
  );

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

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
    const groupMappings = mappedAccounts[group.key] ?? [];
    const isAdding = addingToGroup === group.key;

    return (
      <Card key={group.key}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{group.displayName}</CardTitle>
            {isReconciled ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Reconciled
              </Badge>
            ) : Math.abs(variance) > 1.00 && groupMappings.length > 0 ? (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Variance
              </Badge>
            ) : (
              <Badge variant="outline">
                {groupMappings.length === 0 ? "No Accounts" : "Pending"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mapped GL Accounts */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              GL Accounts
            </p>
            {groupMappings.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No GL accounts linked yet
              </p>
            ) : (() => {
              const acctExpanded = expandedGroups.has(`accts_${group.key}`);
              const visible = acctExpanded ? groupMappings : groupMappings.slice(0, 1);
              const hiddenCount = groupMappings.length - 1;
              return (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2">
                    {visible.map((mapping) => {
                      const acct = accountsById[mapping.account_id];
                      return (
                        <Badge
                          key={mapping.id}
                          variant="secondary"
                          className="text-xs font-mono gap-1"
                        >
                          {acct
                            ? `${acct.account_number ?? ""} ${acct.name}`.trim()
                            : mapping.account_id.slice(0, 8)}
                          <button
                            onClick={() =>
                              handleRemoveAccount(mapping.id, group.key)
                            }
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => toggleGroup(`accts_${group.key}`)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {acctExpanded ? (
                        <>
                          <ChevronDown className="h-3 w-3" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3 w-3" />
                          +{hiddenCount} more account{hiddenCount !== 1 ? "s" : ""}
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Add account picker — multi-select */}
            {isAdding ? (
              <div className="space-y-2">
                <Input
                  placeholder="Search accounts..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="text-sm"
                />
                <div className="max-h-48 overflow-y-auto rounded border p-1 space-y-0.5">
                  {entityAccounts
                    .filter((a) => !allMappedAccountIds.has(a.id))
                    .filter((a) => {
                      if (!accountSearch) return true;
                      const q = accountSearch.toLowerCase();
                      return (
                        (a.account_number ?? "").toLowerCase().includes(q) ||
                        a.name.toLowerCase().includes(q)
                      );
                    })
                    .map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={selectedAccountIds.has(a.id)}
                          onCheckedChange={(checked) => {
                            setSelectedAccountIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(a.id);
                              else next.delete(a.id);
                              return next;
                            });
                          }}
                        />
                        <span className="font-mono text-xs text-muted-foreground w-12 shrink-0">
                          {a.account_number ?? ""}
                        </span>
                        <span className="truncate">{a.name}</span>
                      </label>
                    ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {selectedAccountIds.size} selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingToGroup(null);
                        setSelectedAccountIds(new Set());
                        setAccountSearch("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAddAccounts(group.key)}
                      disabled={selectedAccountIds.size === 0 || saving === group.key}
                    >
                      {saving === group.key
                        ? "Linking..."
                        : `Link ${selectedAccountIds.size} Account${selectedAccountIds.size !== 1 ? "s" : ""}`}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingToGroup(group.key);
                  setSelectedAccountIds(new Set());
                  setAccountSearch("");
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Link Account
              </Button>
            )}
          </div>

          {/* Summary - only show if accounts are mapped */}
          {groupMappings.length > 0 && (
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
                    Math.abs(variance) > 1.00
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  {formatCurrency(variance)}
                </p>
              </div>
            </div>
          )}

          {/* Asset detail */}
          {assetList.length > 0 && (
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
                  {assetList.length} asset{assetList.length !== 1 ? "s" : ""}{" "}
                  in group
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
          )}

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
                  disabled={
                    saving === group.key || groupMappings.length === 0
                  }
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              if (periodMonth === 1) {
                setPeriodMonth(12);
                setPeriodYear(periodYear - 1);
              } else {
                setPeriodMonth(periodMonth - 1);
              }
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
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
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              if (periodMonth === 12) {
                setPeriodMonth(1);
                setPeriodYear(periodYear + 1);
              } else {
                setPeriodMonth(periodMonth + 1);
              }
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={loading || allAssets.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export Recon CSV
        </Button>
      </div>

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
              const subCost =
                subledgerBalances["vehicles_cost"]?.total ?? 0;
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
                          Math.abs(netVariance) > 1.00
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
              const subCost =
                subledgerBalances["trailers_cost"]?.total ?? 0;
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
                          Math.abs(netVariance) > 1.00
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
                    These assets have no vehicle class or an unrecognized
                    class. Assign a vehicle class to each asset so it maps to
                    the correct GL account group.
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
                              <TableHead className="text-right">
                                Cost
                              </TableHead>
                              <TableHead className="text-right">
                                NBV
                              </TableHead>
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
