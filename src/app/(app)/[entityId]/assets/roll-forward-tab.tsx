"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils/dates";
import {
  GL_ACCOUNT_GROUPS,
  RECON_GROUPS,
  getAssetGLGroup,
  type GLAccountGroup,
} from "@/lib/utils/asset-gl-groups";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
  type DepreciationEntry,
} from "@/lib/utils/depreciation";
import {
  getReportingGroup,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import type { DepreciationRule } from "./depreciation-rules-settings";

interface RollForwardTabProps {
  entityId: string;
}

interface AssetRecord {
  id: string;
  asset_name: string;
  vehicle_class: string | null;
  acquisition_cost: number;
  in_service_date: string;
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  tax_cost_basis: number | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  section_179_amount: number;
  bonus_depreciation_amount: number;
  status: string;
  disposed_date: string | null;
  cost_account_id: string | null;
  master_type_override: string | null;
}

interface MonthlyRollForward {
  year: number;
  month: number;
  // Cost roll-forward
  beginningCost: number;
  additionsCost: number;
  disposalsCost: number;
  endingCost: number;
  // Accumulated depreciation roll-forward
  beginningAccum: number;
  depreciation: number;
  disposalsAccum: number;
  endingAccum: number;
  // Net book value (derived)
  beginningNbv: number;
  endingNbv: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function parseISODate(dateStr: string): { year: number; month: number } {
  const parts = dateStr.split("T")[0].split("-");
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
}

/**
 * Resolve effective useful life / salvage / method for an asset. Mirrors the
 * logic in depreciation-schedule-tab.tsx so both tabs calculate from the same
 * rule-driven inputs. When a reporting-group rule exists, it wins over the
 * asset's stored values.
 */
function resolveAssetForCalc(
  asset: AssetRecord,
  rule: DepreciationRule | undefined
): AssetForDepreciation {
  const ruleSalvagePct = rule?.book_salvage_pct ?? null;
  const ruleSalvage =
    ruleSalvagePct != null && ruleSalvagePct >= 0
      ? Math.round(asset.acquisition_cost * (ruleSalvagePct / 100) * 100) / 100
      : null;

  const usefulLife =
    rule?.book_useful_life_months != null && rule.book_useful_life_months > 0
      ? rule.book_useful_life_months
      : asset.book_useful_life_months;
  const salvageValue = ruleSalvage != null ? ruleSalvage : asset.book_salvage_value;
  const method = rule?.book_depreciation_method ?? asset.book_depreciation_method;

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

function computeRollForward(
  group: GLAccountGroup,
  assets: AssetRecord[],
  scheduleMap: Record<string, Record<string, DepreciationEntry>>,
  openingAccumMap: Record<string, number>,
  months: { year: number; month: number }[],
  openingYear: number,
  openingMonth: number,
  resolveGLGroup: (asset: AssetRecord) => string | null
): MonthlyRollForward[] {
  const groupAssets = assets.filter((a) => resolveGLGroup(a) === group.key);

  const isInServiceBy = (a: AssetRecord, y: number, m: number) => {
    if (!a.in_service_date) return false;
    const d = parseISODate(a.in_service_date);
    return d.year < y || (d.year === y && d.month <= m);
  };
  const isDisposedBy = (a: AssetRecord, y: number, m: number) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parseISODate(a.disposed_date);
    return d.year < y || (d.year === y && d.month <= m);
  };
  const isInServiceIn = (a: AssetRecord, y: number, m: number) => {
    if (!a.in_service_date) return false;
    const d = parseISODate(a.in_service_date);
    return d.year === y && d.month === m;
  };
  const isDisposedIn = (a: AssetRecord, y: number, m: number) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parseISODate(a.disposed_date);
    return d.year === y && d.month === m;
  };
  const prevPeriod = (y: number, m: number) =>
    m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };

  // Look up an asset's accumulated depreciation at the end of a given period.
  // The in-memory schedule does not emit an entry for the opening period
  // itself — at that period, fall back to the pinned opening balance.
  const accumAt = (a: AssetRecord, y: number, m: number): number => {
    const entry = scheduleMap[a.id]?.[monthKey(y, m)];
    if (entry) return entry.book_accumulated;
    if (y === openingYear && m === openingMonth) {
      return openingAccumMap[a.id] ?? 0;
    }
    return 0;
  };

  const result: MonthlyRollForward[] = [];

  for (const { year, month } of months) {
    // Opening-period snapshot: beginning equals ending from the pinned
    // opening balances; no additions/disposals/depreciation flow here.
    if (year === openingYear && month === openingMonth) {
      const heldAtOpening = groupAssets.filter(
        (a) => isInServiceBy(a, year, month) && !isDisposedBy(a, year, month)
      );
      const snapshotCost = heldAtOpening.reduce(
        (s, a) => s + Number(a.acquisition_cost),
        0
      );
      let snapshotAccum = 0;
      for (const a of heldAtOpening) {
        snapshotAccum += openingAccumMap[a.id] ?? 0;
      }
      result.push({
        year,
        month,
        beginningCost: snapshotCost,
        additionsCost: 0,
        disposalsCost: 0,
        endingCost: snapshotCost,
        beginningAccum: snapshotAccum,
        depreciation: 0,
        disposalsAccum: 0,
        endingAccum: snapshotAccum,
        beginningNbv: snapshotCost - snapshotAccum,
        endingNbv: snapshotCost - snapshotAccum,
      });
      continue;
    }

    const { year: py, month: pm } = prevPeriod(year, month);
    const heldAtStart = groupAssets.filter(
      (a) => isInServiceBy(a, py, pm) && !isDisposedBy(a, py, pm)
    );

    // ---- COST ----
    const beginningCost = heldAtStart.reduce(
      (s, a) => s + Number(a.acquisition_cost),
      0
    );
    const additionsAssets = groupAssets.filter((a) =>
      isInServiceIn(a, year, month)
    );
    const additionsCost = additionsAssets.reduce(
      (s, a) => s + Number(a.acquisition_cost),
      0
    );
    const disposalsAssets = heldAtStart.filter((a) =>
      isDisposedIn(a, year, month)
    );
    const disposalsCost = disposalsAssets.reduce(
      (s, a) => s + Number(a.acquisition_cost),
      0
    );
    const endingCost = beginningCost + additionsCost - disposalsCost;

    // ---- ACCUMULATED DEPRECIATION (from in-memory rule-driven schedule) ----
    let beginningAccum = 0;
    for (const a of heldAtStart) {
      beginningAccum += accumAt(a, py, pm);
    }
    let depreciation = 0;
    for (const a of groupAssets) {
      const entry = scheduleMap[a.id]?.[monthKey(year, month)];
      if (entry) depreciation += entry.book_depreciation;
    }
    let disposalsAccum = 0;
    for (const a of disposalsAssets) {
      disposalsAccum += accumAt(a, year, month);
    }
    const endingAccum = beginningAccum + depreciation - disposalsAccum;

    const beginningNbv = beginningCost - beginningAccum;
    const endingNbv = endingCost - endingAccum;

    result.push({
      year,
      month,
      beginningCost,
      additionsCost,
      disposalsCost,
      endingCost,
      beginningAccum,
      depreciation,
      disposalsAccum,
      endingAccum,
      beginningNbv,
      endingNbv,
    });
  }

  return result;
}

export function RollForwardTab({ entityId }: RollForwardTabProps) {
  const supabase = createClient();
  const now = new Date();

  const [startYear, setStartYear] = useState(now.getFullYear());
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(now.getFullYear());
  const [endMonth, setEndMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [openingYear, setOpeningYear] = useState<number | null>(null);
  const [openingMonth, setOpeningMonth] = useState<number | null>(null);
  const [openingDate, setOpeningDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/settings?entityId=${entityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.rental_asset_opening_date) return;
        const iso: string = data.rental_asset_opening_date;
        setOpeningDate(iso);
        const [y, m] = iso.split("-").map(Number);
        setOpeningYear(y);
        setOpeningMonth(m);
        let nextY = y;
        let nextM = m + 1;
        if (nextM > 12) {
          nextM = 1;
          nextY++;
        }
        setStartYear(nextY);
        setStartMonth(nextM);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  function handleStartYearChange(y: number) {
    let newY = y;
    let newM = startMonth;
    if (openingYear != null && openingMonth != null) {
      if (newY < openingYear) newY = openingYear;
      if (newY === openingYear && newM < openingMonth) newM = openingMonth;
    }
    setStartYear(newY);
    setStartMonth(newM);
  }
  function handleStartMonthChange(m: number) {
    let newM = m;
    if (
      openingYear != null &&
      openingMonth != null &&
      startYear === openingYear &&
      newM < openingMonth
    ) {
      newM = openingMonth;
    }
    setStartMonth(newM);
  }

  const [rollForwardData, setRollForwardData] = useState<
    Record<string, MonthlyRollForward[]>
  >({});

  const loadData = useCallback(async () => {
    setLoading(true);

    // 1. Custom vehicle classes (needed for master-type resolution).
    const ccRes = await fetch(`/api/assets/classes?entityId=${entityId}`);
    let customClasses: VehicleClassification[] = [];
    if (ccRes.ok) {
      const rows: CustomVehicleClassRow[] = await ccRes.json();
      customClasses = customRowsToClassifications(rows);
    }

    // 2. Reporting-group depreciation rules — the authoritative source of
    // useful life / salvage / method for live schedule calculation.
    const rulesRes = await fetch(
      `/api/assets/depreciation-rules?entityId=${entityId}`
    );
    const rules: DepreciationRule[] = rulesRes.ok ? await rulesRes.json() : [];
    const rulesMap = new Map<string, DepreciationRule>();
    for (const r of rules) rulesMap.set(r.reporting_group, r);

    // 3. Assets with all fields required for schedule calculation.
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, vehicle_class, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, status, disposed_date, cost_account_id, master_type_override"
      )
      .eq("entity_id", entityId);
    const assets = (assetsData ?? []) as AssetRecord[];

    // 4. Recon links so GL-override placement still routes an asset to the
    // correct Vehicle/Trailer bucket when a cost account is pinned.
    const linkRes = await fetch(`/api/assets/recon-links?entityId=${entityId}`);
    const linkData = linkRes.ok ? await linkRes.json() : [];
    const accountToParent: Record<string, string> = {};
    for (const m of linkData as { recon_group: string; account_id: string }[]) {
      const reconGroup = RECON_GROUPS.find((g) => g.key === m.recon_group);
      if (reconGroup) {
        accountToParent[m.account_id] = reconGroup.parentKey;
      }
    }

    const resolveGLGroup = (asset: AssetRecord): string | null => {
      if (asset.cost_account_id && accountToParent[asset.cost_account_id]) {
        return accountToParent[asset.cost_account_id];
      }
      return getAssetGLGroup(
        asset.vehicle_class,
        asset.master_type_override,
        customClasses
      );
    };

    const months = generateMonthRange(startYear, startMonth, endYear, endMonth);
    const openY = openingYear ?? 0;
    const openM = openingMonth ?? 0;

    // 5. Pinned opening balances — the is_manual_override row written at the
    // opening period during import. This is the same source the Depreciation
    // Schedule tab uses, keeping the two tabs aligned even if rules drift.
    const assetIds = assets.map((a) => a.id);
    const openingAccumMap: Record<string, number> = {};
    if (openY > 0 && openM > 0 && assetIds.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < assetIds.length; i += batchSize) {
        const batch = assetIds.slice(i, i + batchSize);
        const { data: openingRows } = await supabase
          .from("fixed_asset_depreciation")
          .select("fixed_asset_id, book_accumulated")
          .in("fixed_asset_id", batch)
          .eq("period_year", openY)
          .eq("period_month", openM);
        for (const r of (openingRows ?? []) as {
          fixed_asset_id: string;
          book_accumulated: number;
        }[]) {
          openingAccumMap[r.fixed_asset_id] = Number(r.book_accumulated) || 0;
        }
      }
    }

    // 6. Live, rule-driven schedule per asset through the end of the range.
    // Same inputs as the Depreciation Schedule tab: rule-resolved UL/salvage
    // /method + opening balance anchored at the opening period.
    const scheduleMap: Record<string, Record<string, DepreciationEntry>> = {};
    if (months.length > 0) {
      const lastMonth = months[months.length - 1];
      for (const asset of assets) {
        const group = getReportingGroup(asset.vehicle_class, customClasses);
        const rule = group ? rulesMap.get(group) : undefined;
        const assetForCalc = resolveAssetForCalc(asset, rule);

        const storedBook = openingAccumMap[asset.id] ?? 0;
        const opening = openingDate
          ? buildOpeningBalance(openingDate, storedBook, 0)
          : undefined;

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
        scheduleMap[asset.id] = entryMap;
      }
    }

    const data: Record<string, MonthlyRollForward[]> = {};
    for (const group of GL_ACCOUNT_GROUPS) {
      data[group.key] = computeRollForward(
        group,
        assets,
        scheduleMap,
        openingAccumMap,
        months,
        openY,
        openM,
        resolveGLGroup
      );
    }
    setRollForwardData(data);
    setLoading(false);
  }, [
    supabase,
    entityId,
    startYear,
    startMonth,
    endYear,
    endMonth,
    openingYear,
    openingMonth,
    openingDate,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const months = generateMonthRange(startYear, startMonth, endYear, endMonth);
  const allYears = Array.from(
    { length: 5 },
    (_, i) => now.getFullYear() - i + 1
  );
  const years = openingYear
    ? allYears.filter((y) => y >= openingYear).sort((a, b) => a - b)
    : allYears;
  const startMonthOptions =
    openingYear != null &&
    openingMonth != null &&
    startYear === openingYear
      ? MONTHS_FULL.map((m, i) => ({ value: i + 1, label: m })).filter(
          (o) => o.value >= openingMonth
        )
      : MONTHS_FULL.map((m, i) => ({ value: i + 1, label: m }));

  interface RowDef {
    key: keyof MonthlyRollForward | "sep";
    label: string;
    bold?: boolean;
    /** Wrap positive values in parens AND color red — for outflows like disposals. */
    negative?: boolean;
    /** Wrap positive values in parens without coloring — for contra-asset balances. */
    paren?: boolean;
    separator?: boolean;
  }

  const ROW_LABELS: RowDef[] = [
    { key: "beginningCost", label: "Beginning Cost" },
    { key: "additionsCost", label: "+ Additions" },
    { key: "disposalsCost", label: "− Disposals", negative: true },
    { key: "endingCost", label: "Ending Cost", bold: true },
    { key: "sep", label: "", separator: true },
    { key: "beginningAccum", label: "Beginning Accum. Depreciation", negative: true },
    { key: "depreciation", label: "+ Depreciation", paren: true },
    { key: "disposalsAccum", label: "− Disposals Accum.", negative: true },
    { key: "endingAccum", label: "Ending Accum. Depreciation", bold: true },
    { key: "sep", label: "", separator: true },
    { key: "beginningNbv", label: "Beginning NBV" },
    { key: "endingNbv", label: "Ending NBV", bold: true },
  ];

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">From:</span>
          <Select
            value={String(startMonth)}
            onValueChange={(v) => handleStartMonthChange(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {startMonthOptions.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(startYear)}
            onValueChange={(v) => handleStartYearChange(Number(v))}
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
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading roll-forward data...</p>
      ) : (
        GL_ACCOUNT_GROUPS.map((group) => {
          const groupData = rollForwardData[group.key] ?? [];
          if (groupData.length === 0) return null;

          return (
            <Card key={group.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{group.displayName}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="sticky left-0 bg-background text-left py-2 pr-4 min-w-[160px] font-medium">
                          &nbsp;
                        </th>
                        {months.map(({ year, month }) => (
                          <th
                            key={monthKey(year, month)}
                            className="text-right py-2 px-3 min-w-[120px] font-medium whitespace-nowrap"
                          >
                            {MONTH_LABELS[month - 1]} {year}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ROW_LABELS.map((rowDef, rowIdx) => {
                        if (rowDef.separator) {
                          return (
                            <tr key={`sep-${rowIdx}`}>
                              <td
                                colSpan={months.length + 1}
                                className="py-1"
                              />
                            </tr>
                          );
                        }
                        const { key, label, bold, negative, paren } = rowDef;
                        const wrap = negative || paren;
                        return (
                          <tr
                            key={`${key}-${rowIdx}`}
                            className={`${
                              bold ? "border-t border-foreground/30 font-semibold" : ""
                            }`}
                          >
                            <td
                              className={`sticky left-0 bg-background py-2 pr-4 ${
                                bold ? "font-semibold" : "text-muted-foreground"
                              }`}
                            >
                              {label}
                            </td>
                            {groupData.map((row, idx) => {
                              const value = row[
                                key as keyof MonthlyRollForward
                              ] as number;
                              const displayValue = wrap
                                ? value > 0
                                  ? `(${formatCurrency(value)})`
                                  : formatCurrency(0)
                                : formatCurrency(value);
                              return (
                                <td
                                  key={idx}
                                  className={`text-right py-2 px-3 tabular-nums whitespace-nowrap ${
                                    bold ? "font-semibold" : ""
                                  } ${
                                    negative && value > 0 ? "text-red-600" : ""
                                  }`}
                                >
                                  {displayValue}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
