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
  buildOpeningBalance,
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
  book_accumulated_depreciation: number;
  book_net_value: number;
  tax_cost_basis: number | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  tax_accumulated_depreciation: number;
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

/** Parse ISO date string without timezone shift (avoids new Date() UTC issue) */
function parseISODate(dateStr: string): { year: number; month: number } {
  const parts = dateStr.split("T")[0].split("-");
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
}

interface EffectiveValues {
  usefulLife: number;
  salvageValue: number;
  method: string;
  ulFromRule: boolean;
  salvageFromRule: boolean;
  ulIsOverride: boolean;
  salvageIsOverride: boolean;
}

/**
 * Resolve the effective useful life / salvage / method for an asset.
 *
 * Reporting-group rules are the default — schedules, end dates, and remaining
 * life are all calculated from the rule when one exists. An asset is treated
 * as overriding the rule only when its stored value is non-zero and different
 * from what the rule would produce. This way assets whose stored values were
 * left at zero (salvage) or match the rule already (useful life) display
 * rule-driven values; truly asset-specific values still win.
 */
function resolveEffectiveValues(
  asset: AssetRow,
  rule: DepreciationRule | undefined
): EffectiveValues {
  const assetUL = asset.book_useful_life_months;
  const assetSalvage = asset.book_salvage_value;
  const assetMethod = asset.book_depreciation_method;

  const ruleUL = rule?.book_useful_life_months ?? null;
  const ruleSalvagePct = rule?.book_salvage_pct ?? null;
  const ruleSalvage =
    ruleSalvagePct != null && ruleSalvagePct >= 0
      ? Math.round(asset.acquisition_cost * (ruleSalvagePct / 100) * 100) / 100
      : null;
  const ruleMethod = rule?.book_depreciation_method;

  let usefulLife = assetUL;
  let salvageValue = assetSalvage;
  let method = assetMethod;
  let ulFromRule = false;
  let salvageFromRule = false;
  let ulIsOverride = false;
  let salvageIsOverride = false;

  if (ruleUL != null && ruleUL > 0) {
    if (assetUL && assetUL > 0 && assetUL !== ruleUL) {
      usefulLife = assetUL;
      ulIsOverride = true;
    } else {
      usefulLife = ruleUL;
      ulFromRule = true;
    }
  }

  if (ruleSalvage != null) {
    if (assetSalvage > 0 && Math.abs(assetSalvage - ruleSalvage) > 0.01) {
      salvageValue = assetSalvage;
      salvageIsOverride = true;
    } else {
      salvageValue = ruleSalvage;
      salvageFromRule = true;
    }
  }

  if (ruleMethod) {
    if (!assetMethod || assetMethod === ruleMethod) {
      method = ruleMethod;
    }
    // else: asset's method stays (silent override — not surfaced in UI yet)
  }

  return {
    usefulLife,
    salvageValue,
    method,
    ulFromRule,
    salvageFromRule,
    ulIsOverride,
    salvageIsOverride,
  };
}

/** Build AssetForDepreciation from effective (rule-driven unless overridden) values. */
function resolveAssetForCalc(
  asset: AssetRow,
  rule: DepreciationRule | undefined
): AssetForDepreciation {
  const eff = resolveEffectiveValues(asset, rule);
  return {
    acquisition_cost: asset.acquisition_cost,
    in_service_date: asset.in_service_date,
    book_useful_life_months: eff.usefulLife,
    book_salvage_value: eff.salvageValue,
    book_depreciation_method: eff.method,
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
  const [openingDate, setOpeningDate] = useState<string | null>(null);

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

  const loadSettings = useCallback(async () => {
    const res = await fetch(`/api/assets/settings?entityId=${entityId}`);
    if (res.ok) {
      const data = await res.json();
      setOpeningDate(data.rental_asset_opening_date);
    }
  }, [entityId]);

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_class, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, book_accumulated_depreciation, book_net_value, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, tax_accumulated_depreciation, section_179_amount, bonus_depreciation_amount, status"
      )
      .eq("entity_id", entityId)
      .in("status", ["active", "fully_depreciated"])
      .order("asset_name");
    setAssets((data as unknown as AssetRow[]) ?? []);
  }, [supabase, entityId]);

  const buildSchedules = useCallback(() => {
    if (assets.length === 0 || months.length === 0 || !openingDate) {
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

      const opening = buildOpeningBalance(
        openingDate,
        asset.book_accumulated_depreciation,
        asset.tax_accumulated_depreciation
      );

      const schedule = generateDepreciationSchedule(
        assetForCalc,
        lastMonth.year,
        lastMonth.month,
        opening
      );

      const entryMap: Record<string, DepreciationEntry> = {};
      for (const entry of schedule) {
        entryMap[monthKey(entry.period_year, entry.period_month)] = entry;
      }
      map[asset.id] = entryMap;
    }

    setScheduleMap(map);
  }, [assets, rules, months, customClasses, openingDate]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadAssets(), loadRules(), loadSettings()]);
      setLoading(false);
    }
    init();
  }, [loadAssets, loadRules, loadSettings]);

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
    if (assets.length === 0 || !openingDate) return;
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

      const opening = buildOpeningBalance(
        openingDate,
        asset.book_accumulated_depreciation,
        asset.tax_accumulated_depreciation
      );

      const schedule = generateDepreciationSchedule(
        assetForCalc,
        currentPeriod.year,
        currentPeriod.month,
        opening
      );

      // Delete non-manual entries (only post-opening)
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

  /**
   * Resolve the effective UL/salvage/method for display. Rule-driven by
   * default; asset values win only when they explicitly diverge.
   */
  function resolveEffective(asset: AssetRow) {
    const group = getReportingGroup(asset.vehicle_class, customClasses);
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);
    const rule = group ? rulesMap.get(group) : undefined;
    return resolveEffectiveValues(asset, rule);
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
    const isd = parseISODate(asset.in_service_date);
    const { usefulLife } = resolveEffective(asset);

    if (!usefulLife || usefulLife <= 0) return "---";

    const elapsed = monthsBetween(isd.year, isd.month, year, month);
    if (elapsed < 0) return `${usefulLife} mo`;
    const remaining = Math.max(0, usefulLife - elapsed);
    return `${remaining} mo`;
  }

  function getCellClass(
    asset: AssetRow,
    year: number,
    month: number
  ): string {
    if (viewMode === "remaining_life") {
      const { usefulLife } = resolveEffective(asset);
      if (usefulLife > 0 && asset.in_service_date) {
        const isd = parseISODate(asset.in_service_date);
        const elapsed = monthsBetween(isd.year, isd.month, year, month);
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
    const { usefulLife, ulFromRule, ulIsOverride } = resolveEffective(asset);
    if (usefulLife && usefulLife > 0) {
      const suffix = ulFromRule ? "*" : ulIsOverride ? "†" : "";
      return `${usefulLife} mo${suffix}`;
    }
    return "---";
  }

  function getInServiceLabel(asset: AssetRow): string {
    if (!asset.in_service_date) return "---";
    const isd = parseISODate(asset.in_service_date);
    return getPeriodShortLabel(isd.year, isd.month);
  }

  function getEndServiceLabel(asset: AssetRow): string {
    if (!asset.in_service_date) return "---";
    const isd = parseISODate(asset.in_service_date);
    const { usefulLife } = resolveEffective(asset);
    if (!usefulLife || usefulLife <= 0) return "---";

    // End date = in-service month + useful life - 1 (last month of depreciation)
    let endMonth = isd.month + usefulLife - 1;
    let endYear = isd.year;
    endYear += Math.floor((endMonth - 1) / 12);
    endMonth = ((endMonth - 1) % 12) + 1;
    return getPeriodShortLabel(endYear, endMonth);
  }

  function getEffectiveSalvage(asset: AssetRow): string {
    const { salvageValue, salvageFromRule, salvageIsOverride } = resolveEffective(asset);
    if (salvageValue > 0) {
      const suffix = salvageFromRule ? "*" : salvageIsOverride ? "†" : "";
      return `${formatCurrency(salvageValue)}${suffix}`;
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

        <div className="flex items-center gap-4 ml-auto">
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
          * = value from reporting group rule · † = asset-specific override (does not follow the rule)
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
                      <th className="text-center py-2 px-2 min-w-[90px] font-medium whitespace-nowrap">
                        In Service
                      </th>
                      <th className="text-center py-2 px-2 min-w-[90px] font-medium whitespace-nowrap">
                        End Date
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
                        <td className="text-center py-2 px-2 whitespace-nowrap text-muted-foreground">
                          {getInServiceLabel(asset)}
                        </td>
                        <td className="text-center py-2 px-2 whitespace-nowrap text-muted-foreground">
                          {getEndServiceLabel(asset)}
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
                    <th className="py-2 px-2 min-w-[90px]"></th>
                    <th className="py-2 px-2 min-w-[90px]"></th>
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
