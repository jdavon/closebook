"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calculator } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, getCurrentPeriod, getPeriodShortLabel } from "@/lib/utils/dates";
import {
  generateDepreciationSchedule,
  type AssetForDepreciation,
  type DepreciationEntry,
} from "@/lib/utils/depreciation";
import {
  getReportingGroup,
  getAllReportingGroups,
  type VehicleClassification,
} from "@/lib/utils/vehicle-classification";
import type { DepreciationRule } from "./depreciation-rules-settings";

interface DepreciationScheduleTabProps {
  entityId: string;
  customClasses?: VehicleClassification[];
}

interface AssetRow {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_class: string | null;
  acquisition_cost: number;
  in_service_date: string;
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  book_net_value: number;
  tax_cost_basis: number | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  section_179_amount: number;
  bonus_depreciation_amount: number;
  status: string;
}

type ViewMode = "depreciation" | "remaining_life" | "net_book_value";

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthKey(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function generateMonthRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function monthsBetween(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): number {
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}

/** Apply group rules as fallback when asset lacks depreciation params */
function resolveAssetForCalc(
  asset: AssetRow,
  rule: DepreciationRule | undefined
): AssetForDepreciation {
  let usefulLife = asset.book_useful_life_months;
  let salvageValue = asset.book_salvage_value;
  let method = asset.book_depreciation_method;

  // Fall back to group rule if the asset has no useful life set (0 or missing)
  if (rule && (!usefulLife || usefulLife <= 0)) {
    if (rule.book_useful_life_months && rule.book_useful_life_months > 0) {
      usefulLife = rule.book_useful_life_months;
    }
    if (rule.book_salvage_pct != null && rule.book_salvage_pct >= 0) {
      salvageValue = Math.round(asset.acquisition_cost * (rule.book_salvage_pct / 100) * 100) / 100;
    }
    if (rule.book_depreciation_method && method === "none") {
      method = rule.book_depreciation_method;
    }
  }

  return {
    acquisition_cost: asset.acquisition_cost,
    in_service_date: asset.in_service_date,
    book_useful_life_months: usefulLife,
    book_salvage_value: salvageValue,
    book_depreciation_method: method,
    tax_cost_basis: asset.tax_cost_basis,
    tax_depreciation_method: asset.tax_depreciation_method,
    tax_useful_life_months: asset.tax_useful_life_months,
    section_179_amount: asset.section_179_amount,
    bonus_depreciation_amount: asset.bonus_depreciation_amount,
  };
}

export function DepreciationScheduleTab({
  entityId,
  customClasses,
}: DepreciationScheduleTabProps) {
  const supabase = createClient();
  const now = new Date();
  const currentPeriod = getCurrentPeriod();

  const [startYear, setStartYear] = useState(now.getFullYear());
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(now.getFullYear());
  const [endMonth, setEndMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<ViewMode>("depreciation");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [rules, setRules] = useState<DepreciationRule[]>([]);

  // Schedule data: assetId -> monthKey -> DepreciationEntry
  const [scheduleMap, setScheduleMap] = useState<
    Record<string, Record<string, DepreciationEntry>>
  >({});

  const months = useMemo(
    () => generateMonthRange(startYear, startMonth, endYear, endMonth),
    [startYear, startMonth, endYear, endMonth]
  );

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i + 1);

  const loadRules = useCallback(async () => {
    const res = await fetch(`/api/assets/depreciation-rules?entityId=${entityId}`);
    if (res.ok) {
      setRules(await res.json());
    }
  }, [entityId]);

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_class, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, book_net_value, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, status"
      )
      .eq("entity_id", entityId)
      .in("status", ["active", "fully_depreciated"])
      .order("asset_name");
    setAssets((data as unknown as AssetRow[]) ?? []);
  }, [supabase, entityId]);

  const buildSchedules = useCallback(() => {
    if (assets.length === 0 || months.length === 0) {
      setScheduleMap({});
      return;
    }

    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) {
      rulesMap.set(r.reporting_group, r);
    }

    const lastMonth = months[months.length - 1];
    const map: Record<string, Record<string, DepreciationEntry>> = {};

    for (const asset of assets) {
      const group = getReportingGroup(asset.vehicle_class, customClasses);
      const rule = group ? rulesMap.get(group) : undefined;
      const assetForCalc = resolveAssetForCalc(asset, rule);

      const schedule = generateDepreciationSchedule(
        assetForCalc,
        lastMonth.year,
        lastMonth.month
      );

      const entryMap: Record<string, DepreciationEntry> = {};
      for (const entry of schedule) {
        entryMap[monthKey(entry.period_year, entry.period_month)] = entry;
      }
      map[asset.id] = entryMap;
    }

    setScheduleMap(map);
  }, [assets, rules, months, customClasses]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadAssets(), loadRules()]);
      setLoading(false);
    }
    init();
  }, [loadAssets, loadRules]);

  useEffect(() => {
    if (!loading) {
      buildSchedules();
    }
  }, [loading, buildSchedules]);

  // Group assets by reporting group
  const groupedAssets = useMemo(() => {
    const groups: Record<string, AssetRow[]> = {};
    for (const asset of assets) {
      const group = getReportingGroup(asset.vehicle_class, customClasses) ?? "Unassigned";
      if (!groups[group]) groups[group] = [];
      groups[group].push(asset);
    }

    const allGroups = getAllReportingGroups(customClasses);
    const orderedKeys = [
      ...allGroups.filter((g) => groups[g]),
      ...Object.keys(groups).filter((g) => !allGroups.includes(g)),
    ];

    return orderedKeys.map((key) => ({
      group: key,
      assets: groups[key],
    }));
  }, [assets, customClasses]);

  // Regenerate all schedules through current period and save to DB
  async function handleGenerateAll() {
    if (assets.length === 0) return;
    setGenerating(true);

    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) {
      rulesMap.set(r.reporting_group, r);
    }

    let count = 0;
    for (const asset of assets) {
      if (asset.status !== "active") continue;

      const group = getReportingGroup(asset.vehicle_class, customClasses);
      const rule = group ? rulesMap.get(group) : undefined;
      const assetForCalc = resolveAssetForCalc(asset, rule);

      const schedule = generateDepreciationSchedule(
        assetForCalc,
        currentPeriod.year,
        currentPeriod.month
      );

      // Delete non-manual entries
      await supabase
        .from("fixed_asset_depreciation")
        .delete()
        .eq("fixed_asset_id", asset.id)
        .eq("is_manual_override", false);

      // Get existing manual periods
      const { data: manualEntries } = await supabase
        .from("fixed_asset_depreciation")
        .select("period_year, period_month")
        .eq("fixed_asset_id", asset.id)
        .eq("is_manual_override", true);

      const manualPeriods = new Set(
        (manualEntries ?? []).map(
          (e: { period_year: number; period_month: number }) =>
            `${e.period_year}-${e.period_month}`
        )
      );

      const newEntries = schedule
        .filter(
          (entry) =>
            !manualPeriods.has(`${entry.period_year}-${entry.period_month}`)
        )
        .map((entry) => ({
          fixed_asset_id: asset.id,
          period_year: entry.period_year,
          period_month: entry.period_month,
          book_depreciation: entry.book_depreciation,
          book_accumulated: entry.book_accumulated,
          book_net_value: entry.book_net_value,
          tax_depreciation: entry.tax_depreciation,
          tax_accumulated: entry.tax_accumulated,
          tax_net_value: entry.tax_net_value,
          is_manual_override: false,
        }));

      if (newEntries.length > 0) {
        await supabase.from("fixed_asset_depreciation").insert(newEntries);
      }

      // Update asset's accumulated depreciation
      if (schedule.length > 0) {
        const last = schedule[schedule.length - 1];
        await supabase
          .from("fixed_assets")
          .update({
            book_accumulated_depreciation: last.book_accumulated,
            book_net_value: last.book_net_value,
            tax_accumulated_depreciation: last.tax_accumulated,
            tax_net_value: last.tax_net_value,
          })
          .eq("id", asset.id);
      }
      count++;
    }

    toast.success(`Regenerated schedules for ${count} assets`);
    setGenerating(false);
    await loadAssets();
    buildSchedules();
  }

  function getCellValue(
    asset: AssetRow,
    year: number,
    month: number
  ): string {
    const key = monthKey(year, month);
    const entry = scheduleMap[asset.id]?.[key];

    if (viewMode === "depreciation") {
      if (!entry) return "---";
      return formatCurrency(entry.book_depreciation);
    }

    if (viewMode === "net_book_value") {
      if (!entry) return "---";
      return formatCurrency(entry.book_net_value);
    }

    // remaining_life
    if (!asset.in_service_date) return "---";
    const isd = new Date(asset.in_service_date);
    const isdYear = isd.getFullYear();
    const isdMonth = isd.getMonth() + 1;

    // Resolve effective useful life
    const group = getReportingGroup(asset.vehicle_class, customClasses);
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);
    const rule = group ? rulesMap.get(group) : undefined;

    let usefulLife = asset.book_useful_life_months;
    if (rule && (!usefulLife || usefulLife <= 0)) {
      usefulLife = rule.book_useful_life_months ?? 0;
    }

    if (!usefulLife || usefulLife <= 0) return "---";

    const elapsed = monthsBetween(isdYear, isdMonth, year, month);
    const remaining = Math.max(0, usefulLife - elapsed);
    return `${remaining} mo`;
  }

  function getCellClass(
    asset: AssetRow,
    year: number,
    month: number
  ): string {
    if (viewMode === "remaining_life") {
      const group = getReportingGroup(asset.vehicle_class, customClasses);
      const rulesMap = new Map<string, DepreciationRule>();
      for (const r of rules) rulesMap.set(r.reporting_group, r);
      const rule = group ? rulesMap.get(group) : undefined;
      let usefulLife = asset.book_useful_life_months;
      if (rule && (!usefulLife || usefulLife <= 0)) {
        usefulLife = rule.book_useful_life_months ?? 0;
      }
      if (usefulLife > 0) {
        const isd = new Date(asset.in_service_date);
        const elapsed = monthsBetween(
          isd.getFullYear(),
          isd.getMonth() + 1,
          year,
          month
        );
        const remaining = Math.max(0, usefulLife - elapsed);
        if (remaining === 0) return "text-red-600 font-medium";
        if (remaining <= 6) return "text-amber-600";
      }
    }
    return "";
  }

  function getGroupMonthlyTotal(
    groupAssets: AssetRow[],
    year: number,
    month: number
  ): number {
    const key = monthKey(year, month);
    let total = 0;
    for (const asset of groupAssets) {
      const entry = scheduleMap[asset.id]?.[key];
      if (entry) {
        if (viewMode === "net_book_value") {
          total += entry.book_net_value;
        } else {
          total += entry.book_depreciation;
        }
      }
    }
    return total;
  }

  // Effective useful life display for asset info column
  function getEffectiveUL(asset: AssetRow): string {
    if (asset.book_useful_life_months && asset.book_useful_life_months > 0) {
      return `${asset.book_useful_life_months} mo`;
    }
    const group = getReportingGroup(asset.vehicle_class, customClasses);
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);
    const rule = group ? rulesMap.get(group) : undefined;
    if (rule?.book_useful_life_months && rule.book_useful_life_months > 0) {
      return `${rule.book_useful_life_months} mo*`;
    }
    return "---";
  }

  function getEffectiveSalvage(asset: AssetRow): string {
    if (asset.book_salvage_value > 0) {
      return formatCurrency(asset.book_salvage_value);
    }
    const group = getReportingGroup(asset.vehicle_class, customClasses);
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);
    const rule = group ? rulesMap.get(group) : undefined;
    if (rule?.book_salvage_pct != null && rule.book_salvage_pct > 0) {
      const val = Math.round(asset.acquisition_cost * (rule.book_salvage_pct / 100) * 100) / 100;
      return `${formatCurrency(val)}*`;
    }
    return "$0.00";
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">From:</span>
          <Select
            value={String(startMonth)}
            onValueChange={(v) => setStartMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS_FULL.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(startYear)}
            onValueChange={(v) => setStartYear(Number(v))}
          >
            <SelectTrigger className="w-[90px]">
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">To:</span>
          <Select
            value={String(endMonth)}
            onValueChange={(v) => setEndMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS_FULL.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(endYear)}
            onValueChange={(v) => setEndYear(Number(v))}
          >
            <SelectTrigger className="w-[90px]">
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

        <div className="flex items-center gap-2 ml-auto">
          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="depreciation">Monthly Depreciation</SelectItem>
              <SelectItem value="net_book_value">Net Book Value</SelectItem>
              <SelectItem value="remaining_life">Remaining Useful Life</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={handleGenerateAll}
            disabled={generating || assets.length === 0}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${generating ? "animate-spin" : ""}`}
            />
            {generating ? "Generating..." : "Generate All Schedules"}
          </Button>
        </div>
      </div>

      {/* Legend for group rules */}
      {rules.length > 0 && (
        <p className="text-xs text-muted-foreground">
          * = value derived from reporting group rule (asset has no direct assumption)
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading depreciation data...
        </p>
      ) : groupedAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Active Assets</h3>
          <p className="text-muted-foreground text-center">
            Add assets and generate depreciation schedules to view the schedule.
          </p>
        </div>
      ) : (
        groupedAssets.map(({ group, assets: groupAssets }) => (
          <Card key={group}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{group}</CardTitle>
                <Badge variant="outline">
                  {groupAssets.length} asset{groupAssets.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="sticky left-0 bg-background text-left py-2 pr-2 min-w-[180px] font-medium z-10">
                        Asset
                      </th>
                      <th className="text-right py-2 px-2 min-w-[100px] font-medium whitespace-nowrap">
                        Cost
                      </th>
                      <th className="text-right py-2 px-2 min-w-[90px] font-medium whitespace-nowrap">
                        Salvage
                      </th>
                      <th className="text-center py-2 px-2 min-w-[70px] font-medium whitespace-nowrap">
                        UL
                      </th>
                      {months.map(({ year, month }) => (
                        <th
                          key={monthKey(year, month)}
                          className="text-right py-2 px-3 min-w-[110px] font-medium whitespace-nowrap"
                        >
                          {getPeriodShortLabel(year, month)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupAssets.map((asset) => (
                      <tr key={asset.id} className="border-b border-muted/50 hover:bg-muted/30">
                        <td className="sticky left-0 bg-background py-2 pr-2 z-10">
                          <div className="truncate max-w-[180px]" title={asset.asset_name}>
                            <span className="font-medium text-xs">
                              {asset.asset_tag ? `${asset.asset_tag} — ` : ""}
                            </span>
                            <span className="text-xs">{asset.asset_name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums whitespace-nowrap">
                          {formatCurrency(asset.acquisition_cost)}
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                          {getEffectiveSalvage(asset)}
                        </td>
                        <td className="text-center py-2 px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                          {getEffectiveUL(asset)}
                        </td>
                        {months.map(({ year, month }) => (
                          <td
                            key={monthKey(year, month)}
                            className={`text-right py-2 px-3 tabular-nums whitespace-nowrap ${getCellClass(
                              asset,
                              year,
                              month
                            )}`}
                          >
                            {getCellValue(asset, year, month)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Group total row */}
                    <tr className="border-t-2 border-foreground/20 font-semibold">
                      <td className="sticky left-0 bg-background py-2 pr-2 font-semibold z-10">
                        {viewMode === "remaining_life"
                          ? ""
                          : `${group} Total`}
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums whitespace-nowrap">
                        {viewMode !== "remaining_life" &&
                          formatCurrency(
                            groupAssets.reduce(
                              (s, a) => s + a.acquisition_cost,
                              0
                            )
                          )}
                      </td>
                      <td className="py-2 px-2"></td>
                      <td className="py-2 px-2"></td>
                      {months.map(({ year, month }) => (
                        <td
                          key={monthKey(year, month)}
                          className="text-right py-2 px-3 tabular-nums whitespace-nowrap font-semibold"
                        >
                          {viewMode !== "remaining_life"
                            ? formatCurrency(
                                getGroupMonthlyTotal(groupAssets, year, month)
                              )
                            : ""}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* Grand total across all groups */}
      {!loading && groupedAssets.length > 0 && viewMode !== "remaining_life" && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 bg-background text-left py-2 pr-2 min-w-[180px] font-semibold z-10">
                      Grand Total
                    </th>
                    <th className="text-right py-2 px-2 min-w-[100px] font-semibold whitespace-nowrap">
                      {formatCurrency(
                        assets.reduce((s, a) => s + a.acquisition_cost, 0)
                      )}
                    </th>
                    <th className="py-2 px-2 min-w-[90px]"></th>
                    <th className="py-2 px-2 min-w-[70px]"></th>
                    {months.map(({ year, month }) => {
                      let total = 0;
                      for (const asset of assets) {
                        const key = monthKey(year, month);
                        const entry = scheduleMap[asset.id]?.[key];
                        if (entry) {
                          total +=
                            viewMode === "net_book_value"
                              ? entry.book_net_value
                              : entry.book_depreciation;
                        }
                      }
                      return (
                        <th
                          key={monthKey(year, month)}
                          className="text-right py-2 px-3 font-semibold tabular-nums whitespace-nowrap"
                        >
                          {formatCurrency(total)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
