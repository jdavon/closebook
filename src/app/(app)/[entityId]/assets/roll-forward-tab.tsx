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

interface RollForwardTabProps {
  entityId: string;
}

interface AssetRecord {
  id: string;
  asset_name: string;
  vehicle_class: string | null;
  acquisition_cost: number;
  in_service_date: string;
  book_accumulated_depreciation: number;
  book_net_value: number;
  status: string;
  disposed_date: string | null;
  cost_account_id: string | null;
  master_type_override: string | null;
}

interface DeprEntry {
  fixed_asset_id: string;
  period_year: number;
  period_month: number;
  book_depreciation: number;
  book_accumulated: number;
  book_net_value: number;
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

function computeRollForward(
  group: GLAccountGroup,
  assets: AssetRecord[],
  deprEntries: DeprEntry[],
  months: { year: number; month: number }[],
  resolveGLGroup?: (asset: AssetRecord) => string | null
): MonthlyRollForward[] {
  // Filter assets to this group, using resolver if provided
  const groupAssets = assets.filter((a) => {
    const resolved = resolveGLGroup
      ? resolveGLGroup(a)
      : getAssetGLGroup(a.vehicle_class, a.master_type_override);
    return resolved === group.key;
  });

  // Build depreciation lookup: assetId -> monthKey -> entry
  const deprByAssetMonth: Record<string, Record<string, DeprEntry>> = {};
  for (const d of deprEntries) {
    if (!deprByAssetMonth[d.fixed_asset_id]) {
      deprByAssetMonth[d.fixed_asset_id] = {};
    }
    deprByAssetMonth[d.fixed_asset_id][monthKey(d.period_year, d.period_month)] = d;
  }

  // --- Helpers for asset lifecycle boundaries ---
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

  const result: MonthlyRollForward[] = [];

  for (const { year, month } of months) {
    const { year: py, month: pm } = prevPeriod(year, month);

    // Held at start of month = in service by end of prior month, not yet disposed
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

    // ---- ACCUMULATED DEPRECIATION ----
    // Beginning: each held asset's accumulated at end of prior month
    let beginningAccum = 0;
    for (const a of heldAtStart) {
      const prev = deprByAssetMonth[a.id]?.[monthKey(py, pm)];
      if (prev) beginningAccum += Number(prev.book_accumulated);
    }
    // Depreciation: sum of book_depreciation from this month's entries across
    // all group assets (held, added, and disposed-this-month).
    let depreciation = 0;
    for (const a of groupAssets) {
      const entry = deprByAssetMonth[a.id]?.[monthKey(year, month)];
      if (entry) depreciation += Number(entry.book_depreciation);
    }
    // Disposals accumulated: the disposed asset's accumulated at disposal
    // month (which already includes that month's depreciation). This keeps
    // Beginning + Depreciation − Disposals Accum = Ending Accum exactly.
    let disposalsAccum = 0;
    for (const a of disposalsAssets) {
      const entry = deprByAssetMonth[a.id]?.[monthKey(year, month)];
      if (entry) {
        disposalsAccum += Number(entry.book_accumulated);
      } else {
        const prev = deprByAssetMonth[a.id]?.[monthKey(py, pm)];
        if (prev) disposalsAccum += Number(prev.book_accumulated);
      }
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

  // Default range: month after opening balance → current month. Set once on
  // mount from the entity setting so the user can still adjust the pickers.
  const [startYear, setStartYear] = useState(now.getFullYear());
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(now.getFullYear());
  const [endMonth, setEndMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assets/settings?entityId=${entityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.rental_asset_opening_date) return;
        const [y, m] = data.rental_asset_opening_date.split("-").map(Number);
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

  const [rollForwardData, setRollForwardData] = useState<
    Record<string, MonthlyRollForward[]>
  >({});

  const loadData = useCallback(async () => {
    setLoading(true);

    // Fetch all assets (including GL override fields)
    const { data: assetsData } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, vehicle_class, acquisition_cost, in_service_date, book_accumulated_depreciation, book_net_value, status, disposed_date, cost_account_id, master_type_override"
      )
      .eq("entity_id", entityId);
    const assets = (assetsData ?? []) as AssetRecord[];

    // Fetch recon links so we can resolve GL overrides
    const linkRes = await fetch(`/api/assets/recon-links?entityId=${entityId}`);
    const linkData = linkRes.ok ? await linkRes.json() : [];
    const accountToParent: Record<string, string> = {};
    for (const m of linkData as { recon_group: string; account_id: string }[]) {
      const reconGroup = RECON_GROUPS.find((g) => g.key === m.recon_group);
      if (reconGroup) {
        accountToParent[m.account_id] = reconGroup.parentKey;
      }
    }

    // Build resolver: asset GL override → parent group, else vehicle_class
    const resolveGLGroup = (asset: AssetRecord): string | null => {
      if (asset.cost_account_id && accountToParent[asset.cost_account_id]) {
        return accountToParent[asset.cost_account_id];
      }
      return getAssetGLGroup(asset.vehicle_class, asset.master_type_override);
    };

    // Fetch ALL depreciation entries for these assets so we can look up the
    // beginning-of-month accumulated (which may predate the chosen range)
    // without another round trip.
    const assetIds = assets.map((a) => a.id);
    let allDepr: DeprEntry[] = [];
    if (assetIds.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < assetIds.length; i += batchSize) {
        const batch = assetIds.slice(i, i + batchSize);
        const { data: deprData } = await supabase
          .from("fixed_asset_depreciation")
          .select(
            "fixed_asset_id, period_year, period_month, book_depreciation, book_accumulated, book_net_value"
          )
          .in("fixed_asset_id", batch);
        allDepr = allDepr.concat((deprData ?? []) as DeprEntry[]);
      }
    }

    const months = generateMonthRange(startYear, startMonth, endYear, endMonth);

    const data: Record<string, MonthlyRollForward[]> = {};
    for (const group of GL_ACCOUNT_GROUPS) {
      data[group.key] = computeRollForward(
        group,
        assets,
        allDepr,
        months,
        resolveGLGroup
      );
    }
    setRollForwardData(data);
    setLoading(false);
  }, [supabase, entityId, startYear, startMonth, endYear, endMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const months = generateMonthRange(startYear, startMonth, endYear, endMonth);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i + 1);

  interface RowDef {
    key: keyof MonthlyRollForward | "sep";
    label: string;
    bold?: boolean;
    negative?: boolean;
    separator?: boolean;
  }

  const ROW_LABELS: RowDef[] = [
    { key: "beginningCost", label: "Beginning Cost" },
    { key: "additionsCost", label: "+ Additions" },
    { key: "disposalsCost", label: "− Disposals", negative: true },
    { key: "endingCost", label: "Ending Cost", bold: true },
    { key: "sep", label: "", separator: true },
    { key: "beginningAccum", label: "Beginning Accum. Depreciation" },
    { key: "depreciation", label: "+ Depreciation" },
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
                        const { key, label, bold, negative } = rowDef;
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
                              const displayValue = negative
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
