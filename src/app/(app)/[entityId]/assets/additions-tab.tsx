"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ArrowRight, Car, Download, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  getVehicleClassification,
  getReportingGroup,
  getEffectiveMasterType,
  REPORTING_GROUPS,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";
import type { DepreciationRule } from "./depreciation-rules-settings";
import {
  addSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  NUMBER_FORMATS,
  parseIsoDate,
  type ColumnDef,
} from "@/lib/utils/excel";
import { toast } from "sonner";

interface AdditionsTabProps {
  entityId: string;
}

interface AddedAsset {
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
  book_net_value: number;
  tax_cost_basis: number | null;
  tax_net_value: number;
  status: string;
  master_type_override: string | null;
}

export function AdditionsTab({ entityId }: AdditionsTabProps) {
  const supabase = createClient();
  const currentYear = new Date().getFullYear();

  const [assets, setAssets] = useState<AddedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(currentYear));
  const [searchQuery, setSearchQuery] = useState("");
  const [masterTypeFilter, setMasterTypeFilter] = useState("all");
  const [reportingGroupFilter, setReportingGroupFilter] = useState("all");
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);

  // Export wizard
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAsOfDate, setExportAsOfDate] = useState("");
  const [exportIncludeTax, setExportIncludeTax] = useState(false);
  const [exportMasterType, setExportMasterType] = useState<"all" | "Vehicle" | "Trailer">("all");
  const [exporting, setExporting] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await fetch(`/api/assets/settings?entityId=${entityId}`);
    if (res.ok) {
      const data = await res.json();
      setOpeningDate(data.rental_asset_opening_date ?? null);
    }
  }, [entityId]);

  const loadCustomClasses = useCallback(async () => {
    const res = await fetch(`/api/assets/classes?entityId=${entityId}`);
    if (res.ok) {
      const rows: CustomVehicleClassRow[] = await res.json();
      setCustomClasses(customRowsToClassifications(rows));
    }
  }, [entityId]);

  const loadAdditions = useCallback(async () => {
    setLoading(true);
    // In-service date drives the "Additions" bucket to match the Roll Forward
    // (which uses the in-service month for +Additions). Pre-opening assets
    // are opening balances, not additions, so they're filtered out below.
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, acquisition_date, in_service_date, acquisition_cost, book_net_value, tax_cost_basis, tax_net_value, status, master_type_override"
      )
      .eq("entity_id", entityId)
      .gte("in_service_date", `${year}-01-01`)
      .lte("in_service_date", `${year}-12-31`)
      .order("in_service_date", { ascending: false });

    setAssets((data as unknown as AddedAsset[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, year]);

  useEffect(() => {
    loadSettings();
    loadCustomClasses();
  }, [loadSettings, loadCustomClasses]);

  useEffect(() => {
    loadAdditions();
  }, [loadAdditions]);

  const filteredAssets = assets.filter((a) => {
    // Exclude opening-balance assets — in-service on/before the opening date
    // belongs to the starting snapshot, not a roll-forward addition.
    if (openingDate && a.in_service_date <= openingDate) return false;

    if (masterTypeFilter !== "all") {
      const mt = getEffectiveMasterType(
        a.vehicle_class,
        a.master_type_override,
        customClasses
      );
      if (mt !== masterTypeFilter) return false;
    }
    if (reportingGroupFilter !== "all") {
      const rg = getReportingGroup(a.vehicle_class, customClasses);
      if (rg !== reportingGroupFilter) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = a.asset_name.toLowerCase();
      const tag = (a.asset_tag ?? "").toLowerCase();
      const vin = (a.vin ?? "").toLowerCase();
      const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
      const classification = getVehicleClassification(a.vehicle_class, customClasses);
      const classInfo = classification
        ? `${classification.className} ${classification.reportingGroup}`.toLowerCase()
        : "";
      if (
        !name.includes(q) &&
        !tag.includes(q) &&
        !vin.includes(q) &&
        !desc.includes(q) &&
        !classInfo.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalCost = filteredAssets.reduce((s, a) => s + a.acquisition_cost, 0);
  const totalBookNbv = filteredAssets.reduce(
    (s, a) => s + a.book_net_value,
    0
  );
  const totalTaxNbv = filteredAssets.reduce((s, a) => s + a.tax_net_value, 0);

  const yearOptions = Array.from({ length: 6 }, (_, i) =>
    String(currentYear - i + 1)
  );

  function formatDate(iso: string | null): string {
    if (!iso) return "---";
    // Parse the date parts directly so the display doesn't drift by a day in
    // UTC-negative timezones.
    const [y, m, d] = iso.split("T")[0].split("-");
    return `${m}/${d}/${y}`;
  }

  function openExportWizard() {
    if (filteredAssets.length === 0) {
      toast.error("No additions to export");
      return;
    }
    // Default closing period = December 31 of the selected year
    if (!exportAsOfDate) setExportAsOfDate(`${year}-12-31`);
    setExportOpen(true);
  }

  async function handleExportExcel() {
    if (filteredAssets.length === 0) {
      toast.error("No additions to export");
      return;
    }
    if (!exportAsOfDate) {
      toast.error("Pick a closing period");
      return;
    }
    setExporting(true);
    try {
      const [asOfYear, asOfMonth] = exportAsOfDate.split("-").map(Number);

      // Narrow to the selected master type + exclude assets not yet in
      // service by the as-of date. Assets still count as additions for the
      // selected reporting year, but their NBV is computed as of the user's
      // chosen close date.
      const toExport = filteredAssets.filter((a) => {
        if (a.in_service_date > exportAsOfDate) return false;
        if (exportMasterType !== "all") {
          const mt = getEffectiveMasterType(
            a.vehicle_class,
            a.master_type_override,
            customClasses
          );
          if (mt !== exportMasterType) return false;
        }
        return true;
      });

      if (toExport.length === 0) {
        toast.error("Nothing to export for the selected filters");
        setExporting(false);
        return;
      }

      // Pull rules + full asset schedule inputs so NBV is rule-driven,
      // matching Roll-Forward and Reconciliation.
      const [rulesRes, fullAssetsRes, entityRow] = await Promise.all([
        fetch(`/api/assets/depreciation-rules?entityId=${entityId}`),
        supabase
          .from("fixed_assets")
          .select(
            "id, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, disposed_date, vehicle_class"
          )
          .in(
            "id",
            toExport.map((a) => a.id)
          ),
        supabase
          .from("entities")
          .select("name")
          .eq("id", entityId)
          .single(),
      ]);
      const rules: DepreciationRule[] = rulesRes.ok ? await rulesRes.json() : [];
      const rulesMap = new Map<string, DepreciationRule>();
      for (const r of rules) rulesMap.set(r.reporting_group, r);
      const fullAssets = (fullAssetsRes.data ?? []) as Array<{
        id: string;
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
        disposed_date: string | null;
        vehicle_class: string | null;
      }>;
      const fullById = new Map(fullAssets.map((a) => [a.id, a]));

      // Opening balances
      const openingMap: Record<string, { book: number; tax: number }> = {};
      if (openingDate) {
        const [oy, om] = openingDate.split("-").map(Number);
        const ids = toExport.map((a) => a.id);
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

      // Per-asset NBV as of the chosen close date, rule-resolved
      const nbvMap: Record<string, { book: number; tax: number }> = {};
      for (const a of toExport) {
        const full = fullById.get(a.id);
        if (!full) continue;
        const group = getReportingGroup(a.vehicle_class, customClasses);
        const rule = group ? rulesMap.get(group) : undefined;
        const rulePct = rule?.book_salvage_pct ?? null;
        const ruleSalvage =
          rulePct != null && rulePct >= 0
            ? Math.round(
                Number(full.acquisition_cost) * (Number(rulePct) / 100) * 100
              ) / 100
            : null;
        const ul =
          rule?.book_useful_life_months != null &&
          rule.book_useful_life_months > 0
            ? rule.book_useful_life_months
            : full.book_useful_life_months;
        const salvage =
          ruleSalvage != null ? ruleSalvage : Number(full.book_salvage_value);
        const method =
          rule?.book_depreciation_method ?? full.book_depreciation_method;

        const assetForCalc: AssetForDepreciation = {
          acquisition_cost: Number(full.acquisition_cost),
          in_service_date: full.in_service_date,
          book_useful_life_months: ul,
          book_salvage_value: salvage,
          book_depreciation_method: method,
          tax_cost_basis:
            full.tax_cost_basis != null ? Number(full.tax_cost_basis) : null,
          tax_depreciation_method: full.tax_depreciation_method,
          tax_useful_life_months: full.tax_useful_life_months,
          section_179_amount: Number(full.section_179_amount ?? 0),
          bonus_depreciation_amount: Number(full.bonus_depreciation_amount ?? 0),
          disposed_date: full.disposed_date,
        };

        const op = openingMap[a.id];
        const opening = openingDate
          ? buildOpeningBalance(openingDate, op?.book ?? 0, op?.tax ?? 0)
          : undefined;

        const schedule = generateDepreciationSchedule(
          assetForCalc,
          asOfYear,
          asOfMonth,
          opening
        );

        // Walk to the latest entry on or before the as-of period. Disposed
        // assets stop emitting at disposal month, so the last emitted entry
        // is the correct snapshot for them.
        let last = schedule[schedule.length - 1];
        if (last) {
          nbvMap[a.id] = {
            book: last.book_net_value,
            tax: last.tax_net_value,
          };
        } else {
          // No entries (opening hasn't applied for this asset by as-of) —
          // fall back to acquisition cost minus opening book/tax accum.
          const cost = Number(full.acquisition_cost);
          const taxBasis =
            full.tax_cost_basis != null ? Number(full.tax_cost_basis) : cost;
          nbvMap[a.id] = {
            book: cost - (op?.book ?? 0),
            tax: taxBasis - (op?.tax ?? 0),
          };
        }
      }

      const entityName =
        (entityRow.data as { name?: string } | null)?.name ?? "";

      type Row = (typeof toExport)[number];
      const baseColumns: ColumnDef<Row>[] = [
        { header: "Asset Tag", width: 14, value: (r) => r.asset_tag ?? "" },
        {
          header: "Class",
          width: 8,
          align: "center",
          value: (r) =>
            getVehicleClassification(r.vehicle_class, customClasses)?.class ?? "",
        },
        {
          header: "Class Description",
          width: 26,
          value: (r) =>
            getVehicleClassification(r.vehicle_class, customClasses)?.className ??
            "",
        },
        {
          header: "Reporting Group",
          width: 18,
          value: (r) =>
            getVehicleClassification(r.vehicle_class, customClasses)
              ?.reportingGroup ?? "",
        },
        {
          header: "Master Type",
          width: 12,
          value: (r) =>
            getEffectiveMasterType(
              r.vehicle_class,
              r.master_type_override,
              customClasses
            ) ?? "",
        },
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
          header: `Book NBV (as of ${exportAsOfDate})`,
          width: 22,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => nbvMap[r.id]?.book ?? 0,
        },
      ];
      if (exportIncludeTax) {
        baseColumns.push({
          header: `Tax NBV (as of ${exportAsOfDate})`,
          width: 22,
          format: NUMBER_FORMATS.currency,
          total: "sum",
          value: (r) => nbvMap[r.id]?.tax ?? 0,
        });
      }
      baseColumns.push({ header: "Status", width: 14, value: (r) => r.status });

      const scopeLabel =
        exportMasterType === "Vehicle"
          ? "Vehicles"
          : exportMasterType === "Trailer"
            ? "Trailers"
            : "Vehicles & Trailers";

      const wb = createWorkbook({
        company: entityName,
        title: `Fixed Asset Additions — ${year}`,
      });
      addSheet(wb, {
        name: "Additions",
        columns: baseColumns,
        rows: toExport,
        title: {
          entityName,
          reportTitle: "Fixed Asset Additions",
          subtitle: `${scopeLabel} — Post-Opening Acquisitions`,
          period: `Year Ended December 31, ${year}`,
          asOf: `NBV as of ${formatLongDate(exportAsOfDate)}`,
        },
        groupBy: (r) =>
          getEffectiveMasterType(
            r.vehicle_class,
            r.master_type_override,
            customClasses
          ) ?? "Unallocated",
        sort: (a, b) => a.in_service_date.localeCompare(b.in_service_date),
        grandTotal: true,
        footnote:
          "Excludes assets in-service on or before the opening balance date (those are reported in the opening snapshot).",
      });

      await downloadWorkbook(
        wb,
        `fixed-asset-additions-${year}-${entityId.slice(0, 8)}`
      );
      toast.success("Excel export downloaded");
      setExportOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to export Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Assets Added</p>
            <p className="text-2xl font-semibold tabular-nums">
              {filteredAssets.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Original Cost</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalCost)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Book NBV</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalBookNbv)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Tax NBV</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalTaxNbv)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, tag, VIN, or class..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={masterTypeFilter} onValueChange={setMasterTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Vehicle">Vehicle</SelectItem>
            <SelectItem value="Trailer">Trailer</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={reportingGroupFilter}
          onValueChange={setReportingGroupFilter}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {REPORTING_GROUPS.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={openExportWizard}
          disabled={filteredAssets.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export Excel
        </Button>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Additions</DialogTitle>
            <DialogDescription>
              Choose the closing period and scope for the export. NBV is
              computed as of the closing date using rule-driven depreciation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="export-as-of">Closing Period (NBV as of)</Label>
              <Input
                id="export-as-of"
                type="date"
                value={exportAsOfDate}
                onChange={(e) => setExportAsOfDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Default is December 31 of the selected year.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select
                value={exportMasterType}
                onValueChange={(v: "all" | "Vehicle" | "Trailer") =>
                  setExportMasterType(v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vehicles & Trailers (default)</SelectItem>
                  <SelectItem value="Vehicle">Vehicles only</SelectItem>
                  <SelectItem value="Trailer">Trailers only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="export-include-tax"
                checked={exportIncludeTax}
                onCheckedChange={(c) => setExportIncludeTax(c === true)}
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="export-include-tax" className="cursor-pointer">
                  Include Tax NBV column
                </Label>
                <p className="text-xs text-muted-foreground">
                  Off by default. Book NBV is always included.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleExportExcel}
              disabled={exporting || !exportAsOfDate}
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Generating..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Additions Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Car className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Additions</h3>
              <p className="text-muted-foreground text-center">
                {searchQuery ||
                masterTypeFilter !== "all" ||
                reportingGroupFilter !== "all"
                  ? "No additions match your current filters."
                  : `No assets were added in ${year}.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Acquisition Date</TableHead>
                  <TableHead>In-Service Date</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Book NBV</TableHead>
                  <TableHead className="text-right">Tax NBV</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => {
                  const classification = getVehicleClassification(
                    asset.vehicle_class,
                    customClasses
                  );
                  return (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        {asset.asset_tag ?? "---"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {classification ? (
                          <div>
                            <span className="font-medium">
                              {classification.class}
                            </span>
                            <span className="text-muted-foreground ml-1">
                              {classification.className}
                            </span>
                          </div>
                        ) : (
                          "---"
                        )}
                      </TableCell>
                      <TableCell>
                        {asset.vehicle_year ||
                        asset.vehicle_make ||
                        asset.vehicle_model
                          ? `${asset.vehicle_year ?? ""} ${asset.vehicle_make ?? ""} ${asset.vehicle_model ?? ""}`.trim()
                          : asset.asset_name}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {asset.vin ?? "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(asset.acquisition_date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(asset.in_service_date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.acquisition_cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.book_net_value)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.tax_net_value)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/${entityId}/assets/${asset.id}`}>
                          <Button variant="ghost" size="sm">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="font-semibold border-t-2">
                  <TableCell colSpan={6}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalBookNbv)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totalTaxNbv)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
