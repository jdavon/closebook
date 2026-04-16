"use client";

// Master Export Wizard — one dialog, one workbook, one sheet per selected
// schedule. All sheets share the same closing period, scope, and tax toggle,
// and every number comes through the rule-driven depreciation engine so the
// workbook stays internally consistent (Register cost + accum reconciles to
// Roll-Forward, Additions NBV matches Register snapshot, etc.).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  getVehicleClassification,
  getReportingGroup,
  getEffectiveMasterType,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
  type DepreciationEntry,
} from "@/lib/utils/depreciation";
import {
  RECON_GROUPS,
  GL_ACCOUNT_GROUPS,
} from "@/lib/utils/asset-gl-groups";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  NUMBER_FORMATS,
  parseIsoDate,
  type ColumnDef,
} from "@/lib/utils/excel";
import type { DepreciationRule } from "./depreciation-rules-settings";

type Scope = "all" | "Vehicle" | "Trailer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
}

interface SelectedSheets {
  register: boolean;
  depreciation: boolean;
  additions: boolean;
  sold: boolean;
  reconciliation: boolean;
  rollForward: boolean;
}

interface FullAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  acquisition_date: string | null;
  in_service_date: string;
  acquisition_cost: number;
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
  disposed_sale_price: number | null;
  disposed_book_gain_loss: number | null;
  disposed_tax_gain_loss: number | null;
  disposed_buyer: string | null;
  book_accumulated_depreciation: number;
  tax_accumulated_depreciation: number;
  master_type_override: string | null;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const monthKey = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")}`;

function matchesScope(
  a: FullAsset,
  scope: Scope,
  customClasses: VehicleClassification[]
): boolean {
  if (scope === "all") return true;
  const mt = getEffectiveMasterType(
    a.vehicle_class,
    a.master_type_override,
    customClasses
  );
  return mt === scope;
}

function resolveAssetForCalc(
  a: FullAsset,
  rulesMap: Map<string, DepreciationRule>,
  customClasses: VehicleClassification[]
): AssetForDepreciation {
  const group = getReportingGroup(a.vehicle_class, customClasses);
  const rule = group ? rulesMap.get(group) : undefined;
  const rulePct = rule?.book_salvage_pct ?? null;
  const ruleSalvage =
    rulePct != null && rulePct >= 0
      ? Math.round(Number(a.acquisition_cost) * (Number(rulePct) / 100) * 100) /
        100
      : null;
  const ul =
    rule?.book_useful_life_months != null && rule.book_useful_life_months > 0
      ? rule.book_useful_life_months
      : a.book_useful_life_months;
  const salvage =
    ruleSalvage != null ? ruleSalvage : Number(a.book_salvage_value);
  const method =
    rule?.book_depreciation_method ?? a.book_depreciation_method;
  return {
    acquisition_cost: Number(a.acquisition_cost),
    in_service_date: a.in_service_date,
    book_useful_life_months: ul,
    book_salvage_value: salvage,
    book_depreciation_method: method,
    tax_cost_basis:
      a.tax_cost_basis != null ? Number(a.tax_cost_basis) : null,
    tax_depreciation_method: a.tax_depreciation_method,
    tax_useful_life_months: a.tax_useful_life_months,
    section_179_amount: Number(a.section_179_amount ?? 0),
    bonus_depreciation_amount: Number(a.bonus_depreciation_amount ?? 0),
    disposed_date: a.disposed_date,
  };
}

export function MasterExportWizard({ open, onOpenChange, entityId }: Props) {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [asOfDate, setAsOfDate] = useState(today);
  const [scope, setScope] = useState<Scope>("all");
  const [includeTax, setIncludeTax] = useState(false);
  const [sheets, setSheets] = useState<SelectedSheets>({
    register: true,
    depreciation: true,
    additions: true,
    sold: true,
    reconciliation: true,
    rollForward: true,
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open && !asOfDate) setAsOfDate(today);
  }, [open, asOfDate, today]);

  const anySelected =
    sheets.register ||
    sheets.depreciation ||
    sheets.additions ||
    sheets.sold ||
    sheets.reconciliation ||
    sheets.rollForward;

  async function handleExport() {
    if (!asOfDate) {
      toast.error("Pick a closing period");
      return;
    }
    if (!anySelected) {
      toast.error("Select at least one schedule");
      return;
    }
    setExporting(true);
    try {
      const [asOfYear, asOfMonth] = asOfDate.split("-").map(Number);
      if (!Number.isFinite(asOfYear) || !Number.isFinite(asOfMonth)) {
        toast.error(`Invalid closing period: ${asOfDate}`);
        setExporting(false);
        return;
      }

      // Load every shared dependency once.
      const [
        assetsRes,
        rulesRes,
        classesRes,
        settingsRes,
        entityRes,
        reconsRes,
      ] = await Promise.all([
        supabase
          .from("fixed_assets")
          .select("*")
          .eq("entity_id", entityId)
          .range(0, 2999),
        fetch(`/api/assets/depreciation-rules?entityId=${entityId}`),
        fetch(`/api/assets/classes?entityId=${entityId}`),
        fetch(`/api/assets/settings?entityId=${entityId}`),
        supabase.from("entities").select("name").eq("id", entityId).single(),
        // Full history up to and including the closing period. The nested
        // and() inside .or() requires a specific PostgREST syntax — if the
        // JS client mangles it we fall back to a simpler filter later.
        supabase
          .from("asset_reconciliations")
          .select("*")
          .eq("entity_id", entityId)
          .or(
            `period_year.lt.${asOfYear},and(period_year.eq.${asOfYear},period_month.lte.${asOfMonth})`
          )
          .order("period_year", { ascending: true })
          .order("period_month", { ascending: true }),
      ]);

      if (assetsRes.error) {
        throw new Error(`Load assets failed: ${assetsRes.error.message}`);
      }
      if (entityRes.error) {
        throw new Error(`Load entity failed: ${entityRes.error.message}`);
      }
      if (reconsRes.error) {
        // Not fatal — skip the reconciliation sheet but keep everything else.
        console.warn(
          "Reconciliation history failed, sheet will be empty:",
          reconsRes.error
        );
      }

      const allAssets = (assetsRes.data ?? []) as FullAsset[];
      const rules: DepreciationRule[] = rulesRes.ok ? await rulesRes.json() : [];
      const rulesMap = new Map<string, DepreciationRule>();
      for (const r of rules) rulesMap.set(r.reporting_group, r);
      const classRows: CustomVehicleClassRow[] = classesRes.ok
        ? await classesRes.json()
        : [];
      const customClasses: VehicleClassification[] =
        customRowsToClassifications(classRows);
      const settings = settingsRes.ok ? await settingsRes.json() : null;
      const openingDateIso: string | null =
        (settings as { rental_asset_opening_date?: string } | null)
          ?.rental_asset_opening_date ?? null;

      // Opening balance per asset
      const openingMap: Record<string, { book: number; tax: number }> = {};
      if (openingDateIso && allAssets.length > 0) {
        const [oy, om] = openingDateIso.split("-").map(Number);
        const ids = allAssets.map((a) => a.id);
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ids.slice(i, i + 500);
          const { data: opRows } = await supabase
            .from("fixed_asset_depreciation")
            .select("fixed_asset_id, book_accumulated, tax_accumulated")
            .in("fixed_asset_id", batch)
            .eq("period_year", oy)
            .eq("period_month", om)
            .eq("is_manual_override", true);
          for (const r of (opRows ?? []) as {
            fixed_asset_id: string;
            book_accumulated: number | string;
            tax_accumulated: number | string;
          }[]) {
            openingMap[r.fixed_asset_id] = {
              book: Number(r.book_accumulated) || 0,
              tax: Number(r.tax_accumulated) || 0,
            };
          }
        }
      }

      // Rule-driven schedules per asset through the closing period. One
      // asset with bad data (e.g. missing in_service_date) shouldn't sink
      // the entire export — log and skip.
      const scheduleMap: Record<string, Record<string, DepreciationEntry>> = {};
      let scheduleSkips = 0;
      for (const a of allAssets) {
        if (!a.in_service_date) {
          scheduleSkips++;
          continue;
        }
        try {
          const assetForCalc = resolveAssetForCalc(a, rulesMap, customClasses);
          const op = openingMap[a.id];
          const opening = openingDateIso
            ? buildOpeningBalance(openingDateIso, op?.book ?? 0, op?.tax ?? 0)
            : undefined;
          const schedule = generateDepreciationSchedule(
            assetForCalc,
            asOfYear,
            asOfMonth,
            opening
          );
          const byMonth: Record<string, DepreciationEntry> = {};
          for (const e of schedule) {
            byMonth[monthKey(e.period_year, e.period_month)] = e;
          }
          scheduleMap[a.id] = byMonth;
        } catch (err) {
          scheduleSkips++;
          console.warn(
            `Skipping schedule for ${a.asset_tag ?? a.id}:`,
            err instanceof Error ? err.message : err
          );
          scheduleMap[a.id] = {};
        }
      }
      if (scheduleSkips > 0) {
        console.info(`Master export: ${scheduleSkips} asset(s) skipped due to schedule errors`);
      }

      // Helpers used by every sheet below
      const periodLastDay = asOfDate;
      const inScope = (a: FullAsset) => matchesScope(a, scope, customClasses);
      const mtOf = (a: FullAsset) =>
        getEffectiveMasterType(
          a.vehicle_class,
          a.master_type_override,
          customClasses
        ) ?? "Unallocated";
      const scopeLabel =
        scope === "Vehicle"
          ? "Vehicles"
          : scope === "Trailer"
            ? "Trailers"
            : "Vehicles & Trailers";

      const entityName =
        (entityRes.data as { name?: string } | null)?.name ?? "";
      const wb = createWorkbook({
        company: entityName,
        title: `Fixed Asset Package — as of ${asOfDate}`,
      });

      // ---- Register -------------------------------------------------------
      if (sheets.register) {
        const held = allAssets.filter((a) => {
          if (!inScope(a)) return false;
          const isd = a.in_service_date?.slice(0, 10) ?? null;
          if (!isd || isd > periodLastDay) return false;
          const dd = a.disposed_date?.slice(0, 10) ?? null;
          if (a.status === "disposed" && dd && dd <= periodLastDay) return false;
          return true;
        });

        const snap = (a: FullAsset) => {
          const e = scheduleMap[a.id]?.[monthKey(asOfYear, asOfMonth)];
          if (e) return e;
          const op = openingMap[a.id];
          const cost = Number(a.acquisition_cost);
          const taxBasis =
            a.tax_cost_basis != null ? Number(a.tax_cost_basis) : cost;
          return {
            period_year: asOfYear,
            period_month: asOfMonth,
            book_depreciation: 0,
            book_accumulated: op?.book ?? 0,
            book_net_value: cost - (op?.book ?? 0),
            tax_depreciation: 0,
            tax_accumulated: op?.tax ?? 0,
            tax_net_value: taxBasis - (op?.tax ?? 0),
          } as DepreciationEntry;
        };

        const cols: ColumnDef<FullAsset>[] = [
          { header: "Asset Tag", width: 14, value: (r) => r.asset_tag ?? "" },
          {
            header: "Class",
            width: 8,
            align: "center",
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)?.class ??
              "",
          },
          {
            header: "Class Description",
            width: 26,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.className ?? "",
          },
          {
            header: "Reporting Group",
            width: 18,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.reportingGroup ?? "",
          },
          { header: "Master Type", width: 12, value: mtOf },
          { header: "Year", width: 8, align: "center", value: (r) => r.vehicle_year ?? "" },
          { header: "Make", width: 14, value: (r) => r.vehicle_make ?? "" },
          { header: "Model", width: 16, value: (r) => r.vehicle_model ?? "" },
          { header: "VIN", width: 20, value: (r) => r.vin ?? "" },
          {
            header: "In-Service Date",
            width: 14,
            format: NUMBER_FORMATS.date,
            value: (r) => parseIsoDate(r.in_service_date) ?? "",
          },
          {
            header: "Acquisition Cost",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.acquisition_cost) || 0,
          },
          {
            header: `Accum. Depreciation (as of ${asOfDate})`,
            width: 26,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => snap(r).book_accumulated,
          },
          {
            header: `Book NBV (as of ${asOfDate})`,
            width: 22,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => snap(r).book_net_value,
          },
        ];
        if (includeTax) {
          cols.push(
            {
              header: `Tax Accum. Depreciation (as of ${asOfDate})`,
              width: 28,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) => snap(r).tax_accumulated,
            },
            {
              header: `Tax NBV (as of ${asOfDate})`,
              width: 22,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) => snap(r).tax_net_value,
            }
          );
        }

        addSheet(wb, {
          name: "Register",
          columns: cols,
          rows: held,
          title: {
            entityName,
            reportTitle: "Fixed Asset Register",
            period: `${scopeLabel} — As of ${formatLongDate(asOfDate)}`,
          },
          groupBy: mtOf,
          sort: (a, b) => a.asset_name.localeCompare(b.asset_name),
          grandTotal: true,
        });
      }

      // ---- Additions ------------------------------------------------------
      if (sheets.additions) {
        const yearStart = `${asOfYear}-01-01`;
        const additions = allAssets.filter((a) => {
          if (!inScope(a)) return false;
          const isd = a.in_service_date?.slice(0, 10) ?? null;
          if (!isd) return false;
          if (isd < yearStart || isd > periodLastDay) return false;
          if (openingDateIso && isd <= openingDateIso) return false;
          return true;
        });

        const nbv = (a: FullAsset) => {
          const e = scheduleMap[a.id]?.[monthKey(asOfYear, asOfMonth)];
          const cost = Number(a.acquisition_cost);
          const taxBasis =
            a.tax_cost_basis != null ? Number(a.tax_cost_basis) : cost;
          const op = openingMap[a.id];
          return {
            book: e?.book_net_value ?? cost - (op?.book ?? 0),
            tax: e?.tax_net_value ?? taxBasis - (op?.tax ?? 0),
          };
        };

        const cols: ColumnDef<FullAsset>[] = [
          { header: "Asset Tag", width: 14, value: (r) => r.asset_tag ?? "" },
          {
            header: "Class",
            width: 8,
            align: "center",
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)?.class ??
              "",
          },
          {
            header: "Class Description",
            width: 26,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.className ?? "",
          },
          {
            header: "Reporting Group",
            width: 18,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.reportingGroup ?? "",
          },
          { header: "Master Type", width: 12, value: mtOf },
          {
            header: "Vehicle",
            width: 28,
            value: (r) =>
              r.vehicle_year || r.vehicle_make || r.vehicle_model
                ? `${r.vehicle_year ?? ""} ${r.vehicle_make ?? ""} ${r.vehicle_model ?? ""}`.trim()
                : r.asset_name,
          },
          { header: "VIN", width: 20, value: (r) => r.vin ?? "" },
          {
            header: "Acquisition Date",
            width: 14,
            format: NUMBER_FORMATS.date,
            value: (r) => parseIsoDate(r.acquisition_date) ?? "",
          },
          {
            header: "In-Service Date",
            width: 14,
            format: NUMBER_FORMATS.date,
            value: (r) => parseIsoDate(r.in_service_date) ?? "",
          },
          {
            header: "Acquisition Cost",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.acquisition_cost) || 0,
          },
          {
            header: `Book NBV (as of ${asOfDate})`,
            width: 22,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => nbv(r).book,
          },
        ];
        if (includeTax) {
          cols.push({
            header: `Tax NBV (as of ${asOfDate})`,
            width: 22,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => nbv(r).tax,
          });
        }

        addSheet(wb, {
          name: "Additions",
          columns: cols,
          rows: additions,
          title: {
            entityName,
            reportTitle: "Fixed Asset Additions",
            period: `${scopeLabel} — ${asOfYear} through ${formatLongDate(asOfDate)}`,
          },
          groupBy: mtOf,
          sort: (a, b) => a.in_service_date.localeCompare(b.in_service_date),
          grandTotal: true,
        });
      }

      // ---- Sold -----------------------------------------------------------
      if (sheets.sold) {
        const yearStart = `${asOfYear}-01-01`;
        const sold = allAssets.filter((a) => {
          if (!inScope(a)) return false;
          if (a.status !== "disposed") return false;
          const dd = a.disposed_date?.slice(0, 10) ?? null;
          if (!dd || dd < yearStart || dd > periodLastDay) return false;
          return true;
        });

        const cols: ColumnDef<FullAsset>[] = [
          { header: "Asset Tag", width: 14, value: (r) => r.asset_tag ?? "" },
          {
            header: "Class",
            width: 8,
            align: "center",
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)?.class ??
              "",
          },
          {
            header: "Class Description",
            width: 26,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.className ?? "",
          },
          {
            header: "Reporting Group",
            width: 18,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.reportingGroup ?? "",
          },
          { header: "Master Type", width: 12, value: mtOf },
          {
            header: "Vehicle",
            width: 28,
            value: (r) =>
              r.vehicle_year || r.vehicle_make || r.vehicle_model
                ? `${r.vehicle_year ?? ""} ${r.vehicle_make ?? ""} ${r.vehicle_model ?? ""}`.trim()
                : r.asset_name,
          },
          { header: "VIN", width: 20, value: (r) => r.vin ?? "" },
          {
            header: "Sale Date",
            width: 12,
            format: NUMBER_FORMATS.date,
            value: (r) => parseIsoDate(r.disposed_date) ?? "",
          },
          { header: "Buyer", width: 22, value: (r) => r.disposed_buyer ?? "" },
          {
            header: "Original Cost",
            width: 16,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.acquisition_cost) || 0,
          },
          {
            header: "Accum. Depreciation",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.book_accumulated_depreciation) || 0,
          },
          {
            header: "Book NBV at Sale",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) =>
              Number(r.acquisition_cost) -
              Number(r.book_accumulated_depreciation),
          },
          {
            header: "Sale Price",
            width: 16,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.disposed_sale_price ?? 0) || 0,
          },
          {
            header: "Book Gain/(Loss)",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => Number(r.disposed_book_gain_loss ?? 0) || 0,
          },
        ];
        if (includeTax) {
          cols.push(
            {
              header: "Tax Cost Basis",
              width: 18,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) =>
                Number(r.tax_cost_basis ?? r.acquisition_cost) || 0,
            },
            {
              header: "Tax Accum. Depreciation",
              width: 20,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) => Number(r.tax_accumulated_depreciation) || 0,
            },
            {
              header: "Tax NBV at Sale",
              width: 18,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) =>
                Number(r.tax_cost_basis ?? r.acquisition_cost) -
                Number(r.tax_accumulated_depreciation),
            },
            {
              header: "Tax Gain/(Loss)",
              width: 18,
              format: NUMBER_FORMATS.currency,
              total: "sum",
              value: (r) => Number(r.disposed_tax_gain_loss ?? 0) || 0,
            }
          );
        }

        addSheet(wb, {
          name: "Sold",
          columns: cols,
          rows: sold,
          title: {
            entityName,
            reportTitle: "Disposed Assets Schedule",
            period: `${scopeLabel} — ${asOfYear} through ${formatLongDate(asOfDate)}`,
          },
          groupBy: mtOf,
          sort: (a, b) =>
            (b.disposed_date ?? "").localeCompare(a.disposed_date ?? ""),
          grandTotal: true,
        });
      }

      // ---- Depreciation (monthly matrix) ----------------------------------
      if (sheets.depreciation) {
        // Rows = assets in service by end of Jan..asOfMonth for this year and
        // in-scope. For each month column, emit that month's book depreciation
        // (0 if not yet active or past disposal).
        const monthsInView: number[] = [];
        for (let m = 1; m <= asOfMonth; m++) monthsInView.push(m);

        const rows = allAssets.filter((a) => {
          if (!inScope(a)) return false;
          if (!a.in_service_date) return false;
          const isd = a.in_service_date.slice(0, 10);
          if (isd > periodLastDay) return false;
          // Disposed before the whole period is irrelevant
          const dd = a.disposed_date?.slice(0, 10) ?? null;
          if (a.status === "disposed" && dd && dd < `${asOfYear}-01-01`) {
            return false;
          }
          return true;
        });

        const cols: ColumnDef<FullAsset>[] = [
          { header: "Asset Tag", width: 14, value: (r) => r.asset_tag ?? "" },
          {
            header: "Class",
            width: 8,
            align: "center",
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)?.class ??
              "",
          },
          {
            header: "Reporting Group",
            width: 18,
            value: (r) =>
              getVehicleClassification(r.vehicle_class, customClasses)
                ?.reportingGroup ?? "",
          },
          { header: "Master Type", width: 12, value: mtOf },
          { header: "Asset Name", width: 26, value: (r) => r.asset_name },
        ];
        for (const m of monthsInView) {
          cols.push({
            header: `${MONTH_SHORT[m - 1]} ${asOfYear}`,
            width: 12,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) =>
              scheduleMap[r.id]?.[monthKey(asOfYear, m)]?.book_depreciation ?? 0,
          });
        }
        cols.push({
          header: "YTD Depreciation",
          width: 16,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => {
            let sum = 0;
            for (const m of monthsInView) {
              sum +=
                scheduleMap[r.id]?.[monthKey(asOfYear, m)]?.book_depreciation ??
                0;
            }
            return sum;
          },
        });

        addSheet(wb, {
          name: "Depreciation",
          columns: cols,
          rows,
          title: {
            entityName,
            reportTitle: "Monthly Book Depreciation",
            period: `${scopeLabel} — Jan through ${formatLongDate(asOfDate)}`,
          },
          groupBy: mtOf,
          sort: (a, b) => a.asset_name.localeCompare(b.asset_name),
          grandTotal: true,
        });
      }

      // ---- Roll-Forward ---------------------------------------------------
      if (sheets.rollForward) {
        const rfScope = GL_ACCOUNT_GROUPS.filter(
          (g) =>
            scope === "all" ||
            (scope === "Vehicle" && g.masterType === "Vehicle") ||
            (scope === "Trailer" && g.masterType === "Trailer")
        );

        interface RfRow {
          groupLabel: string;
          periodYear: number;
          periodMonth: number;
          month: string;
          beginningCost: number;
          additionsCost: number;
          disposalsCost: number;
          endingCost: number;
          beginningAccum: number;
          depreciation: number;
          disposalsAccum: number;
          endingAccum: number;
          endingNbv: number;
        }
        const rfRows: RfRow[] = [];

        for (const g of rfScope) {
          const groupAssets = allAssets.filter(
            (a) =>
              getEffectiveMasterType(
                a.vehicle_class,
                a.master_type_override,
                customClasses
              ) === g.masterType
          );

          for (const m of Array.from({ length: asOfMonth }, (_, i) => i + 1)) {
            const y = asOfYear;
            const pm = m === 1 ? 12 : m - 1;
            const py = m === 1 ? y - 1 : y;
            const prevLastDay = new Date(py, pm, 0).toISOString().slice(0, 10);

            const heldAtStart = groupAssets.filter((a) => {
              const isd = a.in_service_date?.slice(0, 10) ?? null;
              if (!isd || isd > prevLastDay) return false;
              const dd = a.disposed_date?.slice(0, 10) ?? null;
              if (a.status === "disposed" && dd && dd <= prevLastDay)
                return false;
              return true;
            });
            const additions = groupAssets.filter((a) => {
              const isd = a.in_service_date?.slice(0, 10) ?? null;
              if (!isd) return false;
              const d = new Date(isd);
              return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m;
            });
            const disposals = heldAtStart.filter((a) => {
              if (a.status !== "disposed" || !a.disposed_date) return false;
              const d = new Date(a.disposed_date);
              return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m;
            });

            const beginningCost = heldAtStart.reduce(
              (s, a) => s + Number(a.acquisition_cost),
              0
            );
            const additionsCost = additions.reduce(
              (s, a) => s + Number(a.acquisition_cost),
              0
            );
            const disposalsCost = disposals.reduce(
              (s, a) => s + Number(a.acquisition_cost),
              0
            );
            const endingCost = beginningCost + additionsCost - disposalsCost;

            const accumAt = (a: FullAsset, yy: number, mm: number) => {
              const e = scheduleMap[a.id]?.[monthKey(yy, mm)];
              if (e) return e.book_accumulated;
              if (
                openingDateIso &&
                yy === Number(openingDateIso.split("-")[0]) &&
                mm === Number(openingDateIso.split("-")[1])
              ) {
                return openingMap[a.id]?.book ?? 0;
              }
              return 0;
            };

            const beginningAccum = heldAtStart.reduce(
              (s, a) => s + accumAt(a, py, pm),
              0
            );
            let depreciation = 0;
            for (const a of groupAssets) {
              const e = scheduleMap[a.id]?.[monthKey(y, m)];
              if (e) depreciation += e.book_depreciation;
            }
            const disposalsAccum = disposals.reduce(
              (s, a) => s + accumAt(a, y, m),
              0
            );
            const endingAccum = beginningAccum + depreciation - disposalsAccum;

            rfRows.push({
              groupLabel: g.displayName,
              periodYear: y,
              periodMonth: m,
              month: `${MONTH_SHORT[m - 1]} ${y}`,
              beginningCost,
              additionsCost,
              disposalsCost,
              endingCost,
              beginningAccum,
              depreciation,
              disposalsAccum,
              endingAccum,
              endingNbv: endingCost - endingAccum,
            });
          }
        }

        // Helpers for annual-summary rows: beginning comes from Jan's row,
        // ending from the last month's row, flows (additions / disposals /
        // depreciation) sum across the year.
        const firstMonthRow = (rows: RfRow[]) =>
          rows.slice().sort((a, b) => a.periodMonth - b.periodMonth)[0];
        const lastMonthRow = (rows: RfRow[]) =>
          rows.slice().sort((a, b) => b.periodMonth - a.periodMonth)[0];

        const rfCols: ColumnDef<RfRow>[] = [
          { header: "Group", width: 18, value: (r) => r.groupLabel },
          { header: "Month", width: 12, value: (r) => r.month },
          {
            header: "Beginning Cost",
            width: 16,
            format: NUMBER_FORMATS.currency,
            value: (r) => r.beginningCost,
            totalValue: (rows) => firstMonthRow(rows as RfRow[])?.beginningCost ?? 0,
          },
          {
            header: "+ Additions",
            width: 14,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.additionsCost,
          },
          {
            header: "− Disposals",
            width: 14,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.disposalsCost,
          },
          {
            header: "Ending Cost",
            width: 16,
            format: NUMBER_FORMATS.currency,
            value: (r) => r.endingCost,
            totalValue: (rows) => lastMonthRow(rows as RfRow[])?.endingCost ?? 0,
          },
          {
            header: "Beginning Accum.",
            width: 18,
            format: NUMBER_FORMATS.currency,
            value: (r) => r.beginningAccum,
            totalValue: (rows) => firstMonthRow(rows as RfRow[])?.beginningAccum ?? 0,
          },
          {
            header: "+ Depreciation",
            width: 16,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.depreciation,
          },
          {
            header: "+ Disposals Accum.",
            width: 18,
            format: NUMBER_FORMATS.currency,
            total: "sum",
            value: (r) => r.disposalsAccum,
          },
          {
            header: "Ending Accum.",
            width: 16,
            format: NUMBER_FORMATS.currency,
            value: (r) => r.endingAccum,
            totalValue: (rows) => lastMonthRow(rows as RfRow[])?.endingAccum ?? 0,
          },
          {
            header: "Ending NBV",
            width: 16,
            format: NUMBER_FORMATS.currency,
            value: (r) => r.endingNbv,
            totalValue: (rows) => lastMonthRow(rows as RfRow[])?.endingNbv ?? 0,
          },
        ];

        addSheet(wb, {
          name: "Roll-Forward",
          columns: rfCols,
          rows: rfRows,
          title: {
            entityName,
            reportTitle: "Fixed Asset Roll-Forward",
            period: `${scopeLabel} — Jan through ${formatLongDate(asOfDate)}`,
          },
          // One section per (group, year). Each section renders its months
          // Jan → Dec (clamped to the closing month) and gets a Total row —
          // which is the annual summary for that group/year.
          groupBy: (r) =>
            `${r.groupLabel} — ${r.periodYear}`,
          sort: (a, b) =>
            a.groupLabel.localeCompare(b.groupLabel) ||
            a.periodYear - b.periodYear ||
            a.periodMonth - b.periodMonth,
        });
      }

      // ---- Reconciliation history ----------------------------------------
      if (sheets.reconciliation) {
        interface ReconRow {
          period_year: number;
          period_month: number;
          gl_account_group: string;
          gl_balance: number | string | null;
          subledger_balance: number | string | null;
          variance: number | string | null;
          is_reconciled: boolean;
          reconciled_at: string | null;
          notes: string | null;
        }
        const reconRowsRaw = (reconsRes.data ?? []) as ReconRow[];

        // Scope filter: stored gl_account_group is one of the four subgroup
        // keys (vehicles_cost / vehicles_accum_depr / trailers_cost /
        // trailers_accum_depr) — plus legacy vehicles_net / trailers_net.
        // Keep only the groups matching the wizard's scope.
        const scopeMasterTypes: Array<"Vehicle" | "Trailer"> =
          scope === "all"
            ? ["Vehicle", "Trailer"]
            : scope === "Vehicle"
              ? ["Vehicle"]
              : ["Trailer"];
        const reconGroupLabel = (key: string): string => {
          const g = RECON_GROUPS.find((rg) => rg.key === key);
          if (g) return g.displayName;
          if (key === "vehicles_net") return "Vehicles (Net)";
          if (key === "trailers_net") return "Trailers (Net)";
          return key;
        };
        const reconGroupMasterType = (key: string): "Vehicle" | "Trailer" | null => {
          const g = RECON_GROUPS.find((rg) => rg.key === key);
          if (g) return g.masterType;
          if (key === "vehicles_net") return "Vehicle";
          if (key === "trailers_net") return "Trailer";
          return null;
        };
        const reconRows = reconRowsRaw.filter((r) => {
          const mt = reconGroupMasterType(r.gl_account_group);
          return mt != null && scopeMasterTypes.includes(mt);
        });

        const reconCols: ColumnDef<ReconRow>[] = [
          {
            header: "Period",
            width: 12,
            value: (r) =>
              `${MONTH_SHORT[r.period_month - 1]} ${r.period_year}`,
          },
          {
            header: "GL Group",
            width: 22,
            value: (r) => reconGroupLabel(r.gl_account_group),
          },
          {
            header: "GL Balance",
            width: 18,
            format: NUMBER_FORMATS.currency,
            value: (r) => Number(r.gl_balance ?? 0) || 0,
          },
          {
            header: "Subledger",
            width: 18,
            format: NUMBER_FORMATS.currency,
            value: (r) => Number(r.subledger_balance ?? 0) || 0,
          },
          {
            header: "Variance",
            width: 14,
            format: NUMBER_FORMATS.currency,
            value: (r) => Number(r.variance ?? 0) || 0,
          },
          {
            header: "Reconciled",
            width: 12,
            align: "center",
            value: (r) => (r.is_reconciled ? "Yes" : "No"),
          },
          {
            header: "Reconciled At",
            width: 16,
            value: (r) =>
              r.reconciled_at
                ? new Date(r.reconciled_at).toISOString().slice(0, 10)
                : "",
          },
          { header: "Notes", width: 40, value: (r) => r.notes ?? "" },
        ];

        addSheet(wb, {
          name: "Reconciliation",
          columns: reconCols,
          rows: reconRows,
          title: {
            entityName,
            reportTitle: "Asset Reconciliation History",
            period: `${scopeLabel} — ${asOfYear} through ${formatLongDate(asOfDate)}`,
          },
          sort: (a, b) =>
            a.period_year - b.period_year ||
            a.period_month - b.period_month ||
            a.gl_account_group.localeCompare(b.gl_account_group),
        });
      }

      await downloadWorkbook(
        wb,
        `fixed-asset-package-as-of-${asOfDate}-${entityId.slice(0, 8)}`
      );
      toast.success("Excel package downloaded");
      onOpenChange(false);
    } catch (err) {
      console.error("Master export failed:", err);
      const msg =
        err instanceof Error ? err.message : "Unknown error — check console";
      toast.error(`Export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  }

  const toggle = (k: keyof SelectedSheets) =>
    setSheets((s) => ({ ...s, [k]: !s[k] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export Rental Asset Package</DialogTitle>
          <DialogDescription>
            Builds a single Excel workbook with one sheet per selected schedule.
            All sheets share the same closing period, scope, and tax setting, so
            the numbers tie across tabs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="master-as-of">Closing Period</Label>
              <Input
                id="master-as-of"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v: Scope) => setScope(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vehicles & Trailers</SelectItem>
                  <SelectItem value="Vehicle">Vehicles only</SelectItem>
                  <SelectItem value="Trailer">Trailers only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="master-tax"
              checked={includeTax}
              onCheckedChange={(c) => setIncludeTax(c === true)}
            />
            <div className="grid gap-0.5 leading-none">
              <Label htmlFor="master-tax" className="cursor-pointer">
                Include tax basis columns
              </Label>
              <p className="text-xs text-muted-foreground">
                Adds Tax Accum., Tax NBV, and Tax Gain/(Loss) where applicable.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sheets to include</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {[
                ["register", "Register"],
                ["depreciation", "Depreciation"],
                ["additions", "Additions"],
                ["sold", "Sold"],
                ["reconciliation", "Reconciliation History"],
                ["rollForward", "Roll-Forward"],
              ].map(([k, label]) => (
                <label
                  key={k}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={sheets[k as keyof SelectedSheets]}
                    onCheckedChange={() => toggle(k as keyof SelectedSheets)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || !anySelected || !asOfDate}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Generating..." : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
