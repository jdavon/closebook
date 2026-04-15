"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import {
  addMatrixSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  type MatrixRow,
} from "@/lib/utils/excel";
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
  asset_tag: string | null;
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

interface AssetContribution {
  id: string;
  name: string;
  tag: string | null;
  amount: number;
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
  // Per-asset contributors for hover breakdowns on Additions / Disposals rows.
  additionsAssets: AssetContribution[];
  disposalsCostAssets: AssetContribution[];
  disposalsAccumAssets: AssetContribution[];
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
    disposed_date: asset.disposed_date,
  };
}

/**
 * Collapse month-grained roll-forward rows into one-per-year totals. The first
 * month of each year supplies the beginning balances; the last month supplies
 * the ending balances; flows (additions / disposals / depreciation) and
 * contributor lists accumulate across the year.
 */
function aggregateByYear(
  monthly: MonthlyRollForward[]
): MonthlyRollForward[] {
  const buckets = new Map<number, MonthlyRollForward[]>();
  for (const m of monthly) {
    const list = buckets.get(m.year);
    if (list) list.push(m);
    else buckets.set(m.year, [m]);
  }
  const result: MonthlyRollForward[] = [];
  const orderedYears = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const year of orderedYears) {
    const items = buckets.get(year)!;
    const first = items[0];
    const last = items[items.length - 1];
    const sumBy = (key: keyof MonthlyRollForward) =>
      items.reduce((s, i) => s + (i[key] as number), 0);
    const concat = <K extends "additionsAssets" | "disposalsCostAssets" | "disposalsAccumAssets">(
      key: K
    ): AssetContribution[] =>
      items.flatMap((i) => i[key]).sort((a, b) => b.amount - a.amount);

    result.push({
      year,
      // Use December as the tooltip/header anchor for yearly rows. The caller
      // formats based on viewMode, so the specific month here is inert.
      month: 12,
      beginningCost: first.beginningCost,
      additionsCost: sumBy("additionsCost"),
      disposalsCost: sumBy("disposalsCost"),
      endingCost: last.endingCost,
      beginningAccum: first.beginningAccum,
      depreciation: sumBy("depreciation"),
      disposalsAccum: sumBy("disposalsAccum"),
      endingAccum: last.endingAccum,
      beginningNbv: first.beginningNbv,
      endingNbv: last.endingNbv,
      additionsAssets: concat("additionsAssets"),
      disposalsCostAssets: concat("disposalsCostAssets"),
      disposalsAccumAssets: concat("disposalsAccumAssets"),
    });
  }
  return result;
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
        additionsAssets: [],
        disposalsCostAssets: [],
        disposalsAccumAssets: [],
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
    const monthAdditions = groupAssets.filter((a) =>
      isInServiceIn(a, year, month)
    );
    const additionsCost = monthAdditions.reduce(
      (s, a) => s + Number(a.acquisition_cost),
      0
    );
    const monthDisposals = heldAtStart.filter((a) =>
      isDisposedIn(a, year, month)
    );
    const disposalsCost = monthDisposals.reduce(
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
    const disposalsAccumAssets: AssetContribution[] = [];
    for (const a of monthDisposals) {
      const amount = accumAt(a, year, month);
      disposalsAccum += amount;
      disposalsAccumAssets.push({
        id: a.id,
        name: a.asset_name,
        tag: a.asset_tag,
        amount,
      });
    }
    const endingAccum = beginningAccum + depreciation - disposalsAccum;

    const beginningNbv = beginningCost - beginningAccum;
    const endingNbv = endingCost - endingAccum;

    // Sort contributors largest-first so the biggest movers show up top in the
    // hover breakdown.
    const additionsAssetsContrib: AssetContribution[] = monthAdditions
      .map((a) => ({
        id: a.id,
        name: a.asset_name,
        tag: a.asset_tag,
        amount: Number(a.acquisition_cost),
      }))
      .sort((a, b) => b.amount - a.amount);
    const disposalsCostAssets: AssetContribution[] = monthDisposals
      .map((a) => ({
        id: a.id,
        name: a.asset_name,
        tag: a.asset_tag,
        amount: Number(a.acquisition_cost),
      }))
      .sort((a, b) => b.amount - a.amount);
    disposalsAccumAssets.sort((a, b) => b.amount - a.amount);

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
      additionsAssets: additionsAssetsContrib,
      disposalsCostAssets,
      disposalsAccumAssets,
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
  const [viewMode, setViewMode] = useState<"monthly" | "yearly">("monthly");
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
        "id, asset_name, asset_tag, vehicle_class, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, status, disposed_date, cost_account_id, master_type_override"
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

    // In yearly mode the month pickers are hidden; the range always covers
    // full calendar years, clamped to the opening month on the first year and
    // to the current month on the ongoing year so we don't materialize empty
    // future months.
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    const effStartMonth =
      viewMode === "yearly"
        ? openingYear != null &&
          openingMonth != null &&
          startYear === openingYear
          ? openingMonth
          : 1
        : startMonth;
    const effEndMonth =
      viewMode === "yearly"
        ? endYear === nowYear
          ? nowMonth
          : 12
        : endMonth;
    const months = generateMonthRange(startYear, effStartMonth, endYear, effEndMonth);
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
      const monthly = computeRollForward(
        group,
        assets,
        scheduleMap,
        openingAccumMap,
        months,
        openY,
        openM,
        resolveGLGroup
      );
      data[group.key] = viewMode === "yearly" ? aggregateByYear(monthly) : monthly;
    }
    setRollForwardData(data);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    supabase,
    entityId,
    startYear,
    startMonth,
    endYear,
    endMonth,
    viewMode,
    openingYear,
    openingMonth,
    openingDate,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Mirror loadData's effective month window for the rendered column set.
  const effStartMonth =
    viewMode === "yearly"
      ? openingYear != null &&
        openingMonth != null &&
        startYear === openingYear
        ? openingMonth
        : 1
      : startMonth;
  const effEndMonth =
    viewMode === "yearly"
      ? endYear === now.getFullYear()
        ? now.getMonth() + 1
        : 12
      : endMonth;
  const monthsRaw = generateMonthRange(
    startYear,
    effStartMonth,
    endYear,
    effEndMonth
  );
  // In yearly mode, compress months to one column per year so the header
  // lines up with the aggregated data coming out of loadData.
  const months =
    viewMode === "yearly"
      ? Array.from(new Set(monthsRaw.map((m) => m.year))).map((y) => ({
          year: y,
          month: 12,
        }))
      : monthsRaw;
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
    /** When set, hover the cell to see per-asset contributors for that month. */
    contributorsKey?:
      | "additionsAssets"
      | "disposalsCostAssets"
      | "disposalsAccumAssets";
  }

  const ROW_LABELS: RowDef[] = [
    { key: "beginningCost", label: "Beginning Cost" },
    {
      key: "additionsCost",
      label: "+ Additions",
      contributorsKey: "additionsAssets",
    },
    {
      key: "disposalsCost",
      label: "− Disposals",
      negative: true,
      contributorsKey: "disposalsCostAssets",
    },
    { key: "endingCost", label: "Ending Cost", bold: true },
    { key: "sep", label: "", separator: true },
    { key: "beginningAccum", label: "Beginning Accum. Depreciation", negative: true },
    { key: "depreciation", label: "+ Depreciation", negative: true },
    {
      key: "disposalsAccum",
      // Disposals reduce the contra-asset accumulated-depr balance — they're
      // the "add back" in the contra view, so display as a positive number.
      label: "+ Disposals Accum.",
      contributorsKey: "disposalsAccumAssets",
    },
    { key: "endingAccum", label: "Ending Accum. Depreciation", bold: true },
    { key: "sep", label: "", separator: true },
    { key: "beginningNbv", label: "Beginning NBV" },
    { key: "endingNbv", label: "Ending NBV", bold: true },
  ];

  async function handleExportExcel() {
    if (Object.keys(rollForwardData).length === 0) {
      toast.error("No roll-forward data to export");
      return;
    }
    try {
      const { data: entityRow } = await supabase
        .from("entities")
        .select("name")
        .eq("id", entityId)
        .single();
      const entityName = (entityRow as { name?: string } | null)?.name ?? "";

      const wb = createWorkbook({
        company: entityName,
        title: `Fixed Asset Roll-Forward — ${viewMode === "yearly" ? "Yearly" : "Monthly"}`,
      });

      const firstCol = months[0];
      const lastCol = months[months.length - 1];
      const periodLabel =
        viewMode === "yearly"
          ? firstCol && lastCol
            ? firstCol.year === lastCol.year
              ? `Year ${firstCol.year}`
              : `Years ${firstCol.year}–${lastCol.year}`
            : ""
          : firstCol && lastCol
            ? firstCol.year === lastCol.year &&
              firstCol.month === lastCol.month
              ? `${MONTH_LABELS[firstCol.month - 1]} ${firstCol.year}`
              : `${MONTH_LABELS[firstCol.month - 1]} ${firstCol.year} – ${MONTH_LABELS[lastCol.month - 1]} ${lastCol.year}`
            : "";

      const periodColumns = months.map(({ year, month }) => ({
        header:
          viewMode === "yearly"
            ? String(year)
            : `${MONTH_LABELS[month - 1]} ${year}`,
        width: viewMode === "yearly" ? 16 : 14,
      }));

      // Row definitions mirror ROW_LABELS minus separators, with presentation
      // hints that translate to Excel number formats.
      interface ExportRowDef {
        key: keyof MonthlyRollForward;
        label: string;
        bold?: boolean;
        totalStyle?: boolean;
        presentation?: "positive" | "parenNegative" | "parenNegativeRed";
      }
      const exportRows: ExportRowDef[] = [
        { key: "beginningCost", label: "Beginning Cost" },
        { key: "additionsCost", label: "+ Additions" },
        {
          key: "disposalsCost",
          label: "− Disposals",
          presentation: "parenNegativeRed",
        },
        { key: "endingCost", label: "Ending Cost", bold: true, totalStyle: true },
        {
          key: "beginningAccum",
          label: "Beginning Accum. Depreciation",
          presentation: "parenNegativeRed",
        },
        {
          key: "depreciation",
          label: "+ Depreciation",
          presentation: "parenNegativeRed",
        },
        {
          key: "disposalsAccum",
          label: "+ Disposals Accum.",
          presentation: "positive",
        },
        {
          key: "endingAccum",
          label: "Ending Accum. Depreciation",
          bold: true,
          totalStyle: true,
          presentation: "parenNegativeRed",
        },
        { key: "beginningNbv", label: "Beginning NBV" },
        { key: "endingNbv", label: "Ending NBV", bold: true, totalStyle: true },
      ];

      const todayIso = new Date().toISOString().slice(0, 10);
      for (const group of GL_ACCOUNT_GROUPS) {
        const groupData = rollForwardData[group.key] ?? [];
        if (groupData.length === 0) continue;

        const matrixRows: MatrixRow[] = [];
        // Cost section
        matrixRows.push({
          label: "Cost",
          values: months.map(() => ""),
          bold: true,
        });
        for (const def of exportRows.slice(0, 4)) {
          matrixRows.push({
            label: def.label,
            values: groupData.map((r) => Number(r[def.key] as number) || 0),
            bold: def.bold,
            totalStyle: def.totalStyle,
            presentation: def.presentation,
            indent: def.bold ? 0 : 1,
          });
        }
        // Spacer
        matrixRows.push({ label: "", values: months.map(() => "") });
        // Accumulated depreciation section
        matrixRows.push({
          label: "Accumulated Depreciation",
          values: months.map(() => ""),
          bold: true,
        });
        for (const def of exportRows.slice(4, 8)) {
          matrixRows.push({
            label: def.label,
            values: groupData.map((r) => Number(r[def.key] as number) || 0),
            bold: def.bold,
            totalStyle: def.totalStyle,
            presentation: def.presentation,
            indent: def.bold ? 0 : 1,
          });
        }
        // Spacer
        matrixRows.push({ label: "", values: months.map(() => "") });
        // NBV section
        matrixRows.push({
          label: "Net Book Value",
          values: months.map(() => ""),
          bold: true,
        });
        for (const def of exportRows.slice(8)) {
          matrixRows.push({
            label: def.label,
            values: groupData.map((r) => Number(r[def.key] as number) || 0),
            bold: def.bold,
            totalStyle: def.totalStyle,
            presentation: def.presentation,
            indent: def.bold ? 0 : 1,
          });
        }

        addMatrixSheet(wb, {
          name: group.displayName,
          title: {
            entityName,
            reportTitle: "Fixed Asset Roll-Forward",
            subtitle: group.displayName,
            period: periodLabel,
            asOf: `Generated ${formatLongDate(todayIso)}`,
          },
          labelColumn: { header: "", width: 34 },
          periodColumns,
          rows: matrixRows,
        });
      }

      await downloadWorkbook(
        wb,
        `asset-roll-forward-${viewMode}-${entityId.slice(0, 8)}`
      );
      toast.success("Excel export downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Failed to export Excel");
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-6">
      {/* Date Range Selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">From:</span>
          {viewMode === "monthly" && (
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
          )}
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
          {viewMode === "monthly" && (
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
          )}
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
          <span className="text-sm font-medium">View:</span>
          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v as "monthly" | "yearly")}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={loading || Object.keys(rollForwardData).length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
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
                            {viewMode === "yearly"
                              ? String(year)
                              : `${MONTH_LABELS[month - 1]} ${year}`}
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
                        const { key, label, bold, negative, paren, contributorsKey } = rowDef;
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
                              const contributors = contributorsKey
                                ? row[contributorsKey]
                                : undefined;
                              const tdClassName = `text-right py-2 px-3 tabular-nums whitespace-nowrap ${
                                bold ? "font-semibold" : ""
                              } ${negative && value > 0 ? "text-red-600" : ""} ${
                                contributors && contributors.length > 0
                                  ? "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4"
                                  : ""
                              }`;
                              if (contributors && contributors.length > 0) {
                                return (
                                  <td key={idx} className={tdClassName}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>{displayValue}</span>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="max-w-[360px] p-0 bg-popover text-popover-foreground border shadow-md"
                                      >
                                        <div className="px-3 py-2 border-b text-xs font-medium">
                                          {label.replace(/^[+\−]\s*/, "")} —{" "}
                                          {viewMode === "yearly"
                                            ? String(row.year)
                                            : `${MONTH_LABELS[row.month - 1]} ${row.year}`}
                                        </div>
                                        <div className="max-h-[260px] overflow-y-auto">
                                          <table className="w-full text-xs tabular-nums">
                                            <tbody>
                                              {contributors.map((c) => (
                                                <tr
                                                  key={c.id}
                                                  className="border-b border-border/50 last:border-0"
                                                >
                                                  <td className="px-3 py-1.5 pr-4">
                                                    {c.tag ? (
                                                      <span className="text-muted-foreground mr-1">
                                                        {c.tag}
                                                      </span>
                                                    ) : null}
                                                    <span>{c.name}</span>
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                                    {formatCurrency(c.amount)}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                            <tfoot>
                                              <tr className="border-t font-semibold">
                                                <td className="px-3 py-1.5">
                                                  Total
                                                </td>
                                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                                  {formatCurrency(value)}
                                                </td>
                                              </tr>
                                            </tfoot>
                                          </table>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>
                                );
                              }
                              return (
                                <td key={idx} className={tdClassName}>
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
    </TooltipProvider>
  );
}
