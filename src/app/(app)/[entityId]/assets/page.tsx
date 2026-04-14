"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, ArrowRight, Car, Search, Upload, Trash2, DollarSign, ChevronsUpDown, Check, Settings, Calculator, Download, ChevronDown as ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { calculateDispositionGainLoss } from "@/lib/utils/depreciation";
import {
  getVehicleClassification,
  getReportingGroup,
  getEffectiveMasterType,
  REPORTING_GROUPS,
  getAllReportingGroups,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import type { VehicleClass } from "@/lib/types/database";
import { ReconciliationTab } from "./reconciliation-tab";
import { RollForwardTab } from "./roll-forward-tab";
import { SoldTab } from "./sold-tab";
import { ClassSettings } from "./class-settings";
import { DepreciationScheduleTab } from "./depreciation-schedule-tab";
import { DepreciationRulesSettings } from "./depreciation-rules-settings";
import { RegisterSettings } from "./register-settings";

interface FixedAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  acquisition_date: string;
  in_service_date: string;
  acquisition_cost: number;
  book_accumulated_depreciation: number;
  tax_cost_basis: number | null;
  tax_accumulated_depreciation: number;
  book_net_value: number;
  tax_net_value: number;
  status: string;
  disposed_date: string | null;
  master_type_override: string | null;
}

interface AsOfSnapshot {
  book_accumulated: number;
  tax_accumulated: number;
}

interface FullAssetData {
  id: string;
  asset_name: string;
  acquisition_cost: number;
  book_accumulated_depreciation: number;
  book_salvage_value: number;
  tax_cost_basis: number | null;
  tax_accumulated_depreciation: number;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  disposed: "Disposed",
  fully_depreciated: "Fully Depreciated",
  inactive: "Inactive",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  disposed: "destructive",
  fully_depreciated: "secondary",
  inactive: "outline",
};

export default function AssetsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [masterTypeFilter, setMasterTypeFilter] = useState<string>("all");
  const [reportingGroupFilter, setReportingGroupFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [asOfSnapshots, setAsOfSnapshots] = useState<
    Record<string, AsOfSnapshot>
  >({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Custom classes
  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deprRulesOpen, setDeprRulesOpen] = useState(false);
  const [registerSettingsOpen, setRegisterSettingsOpen] = useState(false);
  const [openingDate, setOpeningDate] = useState<string | null>(null);

  const loadCustomClasses = useCallback(async () => {
    const res = await fetch(`/api/assets/classes?entityId=${entityId}`);
    if (res.ok) {
      const rows: CustomVehicleClassRow[] = await res.json();
      setCustomClasses(customRowsToClassifications(rows));
    }
  }, [entityId]);

  const loadRegisterSettings = useCallback(async () => {
    const res = await fetch(`/api/assets/settings?entityId=${entityId}`);
    if (res.ok) {
      const data = await res.json();
      setOpeningDate(data.rental_asset_opening_date ?? null);
    }
  }, [entityId]);

  useEffect(() => {
    loadCustomClasses();
    loadRegisterSettings();
  }, [loadCustomClasses, loadRegisterSettings]);

  // Sold Vehicle dialog state
  const [soldOpen, setSoldOpen] = useState(false);
  const [soldAssetId, setSoldAssetId] = useState("");
  const [soldAssetData, setSoldAssetData] = useState<FullAssetData | null>(null);
  const [soldBuyer, setSoldBuyer] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [soldPrice, setSoldPrice] = useState("0");
  const [soldNotes, setSoldNotes] = useState("");
  const [selling, setSelling] = useState(false);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    // When an as-of date is active we need every asset regardless of its live
    // status — a currently-disposed asset may still have been active at the
    // as-of date, and a currently-active asset may not have existed yet.
    const effectiveStatus = asOfDate ? "all" : statusFilter;

    let query = supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, acquisition_date, in_service_date, acquisition_cost, book_accumulated_depreciation, tax_cost_basis, tax_accumulated_depreciation, book_net_value, tax_net_value, status, disposed_date, master_type_override"
      )
      .eq("entity_id", entityId)
      .order("asset_name")
      .range(0, 2999);

    if (effectiveStatus && effectiveStatus !== "all") {
      query = query.eq("status", effectiveStatus);
    }

    const { data } = await query;
    setAssets((data as unknown as FixedAsset[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, statusFilter, asOfDate]);

  // Fetch depreciation snapshot for the as-of date. For each asset we keep the
  // latest depreciation entry with period ≤ as-of month, giving us book/tax
  // accumulated at that point in time.
  const loadAsOfSnapshot = useCallback(async () => {
    if (!asOfDate || assets.length === 0) {
      setAsOfSnapshots({});
      return;
    }
    const [yStr, mStr] = asOfDate.split("-");
    const asOfYear = Number(yStr);
    const asOfMonth = Number(mStr);
    const ids = assets.map((a) => a.id);

    const { data } = await supabase
      .from("fixed_asset_depreciation")
      .select("fixed_asset_id, period_year, period_month, book_accumulated, tax_accumulated")
      .in("fixed_asset_id", ids)
      .or(
        `period_year.lt.${asOfYear},and(period_year.eq.${asOfYear},period_month.lte.${asOfMonth})`
      )
      .range(0, 99999);

    const latest = new Map<
      string,
      { period_year: number; period_month: number; book: number; tax: number }
    >();
    for (const e of data ?? []) {
      const existing = latest.get(e.fixed_asset_id);
      if (
        !existing ||
        e.period_year > existing.period_year ||
        (e.period_year === existing.period_year &&
          e.period_month > existing.period_month)
      ) {
        latest.set(e.fixed_asset_id, {
          period_year: e.period_year,
          period_month: e.period_month,
          book: Number(e.book_accumulated),
          tax: Number(e.tax_accumulated),
        });
      }
    }
    const snap: Record<string, AsOfSnapshot> = {};
    for (const [id, v] of latest.entries()) {
      snap[id] = { book_accumulated: v.book, tax_accumulated: v.tax };
    }
    setAsOfSnapshots(snap);
  }, [asOfDate, assets, supabase]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    loadAsOfSnapshot();
  }, [loadAsOfSnapshot]);

  // Project each asset through the as-of date lens. Returns the asset's
  // effective status, book/tax NBV, and accumulated depreciation at that
  // point in time. When no as-of date is set, returns the live values.
  const projectAsset = useCallback(
    (a: FixedAsset): FixedAsset & { _excluded?: boolean } => {
      if (!asOfDate) return a;

      const asOf = asOfDate;

      // Asset hadn't been acquired yet → exclude entirely
      if (a.acquisition_date && a.acquisition_date > asOf) {
        return { ...a, _excluded: true };
      }

      // Determine effective status: if disposed after as-of, treat as active
      let effectiveStatus = a.status;
      if (a.status === "disposed") {
        if (!a.disposed_date || a.disposed_date > asOf) {
          effectiveStatus = "active";
        }
      }

      // Depreciation snapshot at as-of
      const snap = asOfSnapshots[a.id];
      if (!snap) {
        // No entry ≤ as-of → asset was in-service but not yet depreciated to
        // that period. Treat as zero accumulated depreciation at as-of.
        return {
          ...a,
          status: effectiveStatus,
          book_accumulated_depreciation: 0,
          tax_accumulated_depreciation: 0,
          book_net_value: a.acquisition_cost,
          tax_net_value: a.tax_cost_basis ?? a.acquisition_cost,
        };
      }

      const taxBasis = a.tax_cost_basis ?? a.acquisition_cost;
      return {
        ...a,
        status: effectiveStatus,
        book_accumulated_depreciation: snap.book_accumulated,
        tax_accumulated_depreciation: snap.tax_accumulated,
        book_net_value:
          Math.round((a.acquisition_cost - snap.book_accumulated) * 100) / 100,
        tax_net_value:
          Math.round((taxBasis - snap.tax_accumulated) * 100) / 100,
      };
    },
    [asOfDate, asOfSnapshots]
  );

  const filteredAssets = assets
    .map(projectAsset)
    .filter((a) => !a._excluded)
    .filter((a) => {
      // Status filter (applied after as-of projection so the filter matches
      // the displayed status, not the stored one)
      if (asOfDate && statusFilter !== "all") {
        if (a.status !== statusFilter) return false;
      }

      // Master type filter
      if (masterTypeFilter !== "all") {
        const mt = getEffectiveMasterType(
          a.vehicle_class,
          a.master_type_override,
          customClasses
        );
        if (mt !== masterTypeFilter) return false;
      }

      // Reporting group filter
      if (reportingGroupFilter !== "all") {
        const rg = getReportingGroup(a.vehicle_class, customClasses);
        if (rg !== reportingGroupFilter) return false;
      }

      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const name = a.asset_name.toLowerCase();
        const vin = (a.vin ?? "").toLowerCase();
        const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
        const classification = getVehicleClassification(a.vehicle_class, customClasses);
        const classInfo = classification
          ? `${classification.className} ${classification.reportingGroup}`.toLowerCase()
          : "";
        if (
          !name.includes(q) &&
          !vin.includes(q) &&
          !desc.includes(q) &&
          !classInfo.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });

  const allFilteredSelected =
    filteredAssets.length > 0 &&
    filteredAssets.every((a) => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAssets.map((a) => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    setDeleting(true);
    // Delete depreciation records first (foreign key), then assets
    const ids = Array.from(selectedIds);
    await supabase
      .from("fixed_asset_depreciation")
      .delete()
      .in("asset_id", ids);
    await supabase
      .from("fixed_assets")
      .delete()
      .in("id", ids);
    setSelectedIds(new Set());
    setShowDeleteDialog(false);
    setDeleting(false);
    loadAssets();
  };

  // When a vehicle is selected in the sold dialog, fetch its full data
  const handleSoldAssetChange = async (assetId: string) => {
    setSoldAssetId(assetId);
    setSoldAssetData(null);
    if (!assetId) return;
    const { data } = await supabase
      .from("fixed_assets")
      .select("id, asset_name, acquisition_cost, book_accumulated_depreciation, book_salvage_value, tax_cost_basis, tax_accumulated_depreciation")
      .eq("id", assetId)
      .single();
    if (data) setSoldAssetData(data as unknown as FullAssetData);
  };

  const handleSoldSubmit = async () => {
    if (!soldAssetData || !soldDate) return;
    setSelling(true);

    const salePrice = parseFloat(soldPrice) || 0;
    const taxBasis = soldAssetData.tax_cost_basis ?? soldAssetData.acquisition_cost;

    const { bookGainLoss, taxGainLoss } = calculateDispositionGainLoss(
      soldAssetData.acquisition_cost,
      soldAssetData.book_accumulated_depreciation,
      soldAssetData.book_salvage_value,
      taxBasis,
      soldAssetData.tax_accumulated_depreciation,
      salePrice
    );

    const updateData: Record<string, unknown> = {
      status: "disposed",
      disposed_date: soldDate,
      disposed_sale_price: salePrice,
      disposed_book_gain_loss: bookGainLoss,
      disposed_tax_gain_loss: taxGainLoss,
      disposition_method: "sale",
      disposed_buyer: soldBuyer || null,
    };
    if (soldNotes.trim()) {
      updateData.vehicle_notes = soldNotes.trim();
    }

    const { error } = await supabase
      .from("fixed_assets")
      .update(updateData)
      .eq("id", soldAssetData.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${soldAssetData.asset_name} marked as sold`);
      setSoldOpen(false);
      setSoldAssetId("");
      setSoldAssetData(null);
      setSoldBuyer("");
      setSoldDate("");
      setSoldPrice("0");
      setSoldNotes("");
      loadAssets();
    }
    setSelling(false);
  };

  // Gain/loss preview for sold vehicle dialog
  const soldPreviewGainLoss = soldAssetData
    ? calculateDispositionGainLoss(
        soldAssetData.acquisition_cost,
        soldAssetData.book_accumulated_depreciation,
        soldAssetData.book_salvage_value,
        soldAssetData.tax_cost_basis ?? soldAssetData.acquisition_cost,
        soldAssetData.tax_accumulated_depreciation,
        parseFloat(soldPrice) || 0
      )
    : null;

  const activeAssets = assets.filter((a) => a.status === "active");

  const totalCost = filteredAssets.reduce((s, a) => s + a.acquisition_cost, 0);
  const totalBookNbv = filteredAssets.reduce((s, a) => s + a.book_net_value, 0);
  const totalTaxNbv = filteredAssets.reduce((s, a) => s + a.tax_net_value, 0);

  // Split by master type for the Vehicles / Trailers summary cards. Uses the
  // same effective-master-type resolver as the filter/grouping logic so an
  // Accounting Adjustment asset with a pinned override lands in the right
  // bucket instead of falling through to neither.
  const vehicleAssets = filteredAssets.filter(
    (a) =>
      getEffectiveMasterType(a.vehicle_class, a.master_type_override, customClasses) ===
      "Vehicle"
  );
  const trailerAssets = filteredAssets.filter(
    (a) =>
      getEffectiveMasterType(a.vehicle_class, a.master_type_override, customClasses) ===
      "Trailer"
  );
  const summarize = (list: typeof filteredAssets) => ({
    count: list.length,
    cost: list.reduce((s, a) => s + a.acquisition_cost, 0),
    accum: list.reduce((s, a) => s + a.book_accumulated_depreciation, 0),
    bookNbv: list.reduce((s, a) => s + a.book_net_value, 0),
    taxNbv: list.reduce((s, a) => s + a.tax_net_value, 0),
  });
  const vehicleSummary = summarize(vehicleAssets);
  const trailerSummary = summarize(trailerAssets);

  function downloadCSV(assetList: FixedAsset[], suffix: string) {
    const headers = [
      "Asset Tag",
      "Asset Name",
      "Class",
      "Class Name",
      "Reporting Group",
      "Vehicle Year",
      "Vehicle Make",
      "Vehicle Model",
      "VIN",
      "In Service Date",
      "Acquisition Cost",
      "Book NBV",
      "Tax NBV",
      "Status",
    ];

    const rows = assetList.map((asset) => {
      const classification = getVehicleClassification(asset.vehicle_class, customClasses);
      return [
        asset.asset_tag ?? "",
        asset.asset_name,
        classification?.class ?? "",
        classification?.className ?? "",
        classification?.reportingGroup ?? "",
        asset.vehicle_year ?? "",
        asset.vehicle_make ?? "",
        asset.vehicle_model ?? "",
        asset.vin ?? "",
        asset.in_service_date,
        asset.acquisition_cost.toFixed(2),
        asset.book_net_value.toFixed(2),
        asset.tax_net_value.toFixed(2),
        STATUS_LABELS[asset.status] ?? asset.status,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => {
          const str = String(cell);
          return str.includes(",") || str.includes('"')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rental-assets-${suffix}-${entityId.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportAll() {
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, in_service_date, acquisition_cost, book_net_value, tax_net_value, status"
      )
      .eq("entity_id", entityId)
      .order("asset_name")
      .range(0, 2999);
    downloadCSV((data as unknown as FixedAsset[]) ?? [], "all");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rental Assets</h1>
          <p className="text-muted-foreground">
            Vehicle asset register with book and tax basis tracking
          </p>
          {openingDate && (
            <button
              type="button"
              onClick={() => setRegisterSettingsOpen(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>
                Opening balance as of{" "}
                <span className="font-medium">
                  {new Date(openingDate + "T00:00:00").toLocaleDateString(
                    "en-US",
                    { year: "numeric", month: "long", day: "numeric" }
                  )}
                </span>
              </span>
              <span className="underline">change</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ({selectedIds.size})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
                <ChevronDownIcon className="ml-2 h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadCSV(filteredAssets, "filtered")}>
                Current View ({filteredAssets.length} assets)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportAll}>
                All Statuses (incl. Sold)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setDeprRulesOpen(true)}>
            <Calculator className="mr-2 h-4 w-4" />
            Depr Rules
          </Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Edit Settings
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Upload className="mr-2 h-4 w-4" />
                Import
                <ChevronDownIcon className="ml-2 h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <Link href={`/${entityId}/assets/import`}>
                <DropdownMenuItem>Import Assets</DropdownMenuItem>
              </Link>
              <Link href={`/${entityId}/assets/import-disposals`}>
                <DropdownMenuItem>Import Disposals</DropdownMenuItem>
              </Link>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setSoldOpen(true)}
          >
            <DollarSign className="mr-2 h-4 w-4" />
            Sold Vehicle
          </Button>
          <Link href={`/${entityId}/assets/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Vehicle
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="register" className="space-y-6">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
          <TabsTrigger value="sold">Sold</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="roll-forward">Roll-Forward</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-6">

      {/* Summary Cards — split by master type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {([
          { label: "Vehicles", data: vehicleSummary },
          { label: "Trailers", data: trailerSummary },
        ] as const).map(({ label, data }) => (
          <Card key={label}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{label}</h3>
                <Badge variant="secondary">
                  {data.count} asset{data.count === 1 ? "" : "s"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Cost</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatCurrency(data.cost)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Accum. Depreciation
                  </p>
                  <p className="text-xl font-semibold tabular-nums">
                    {data.accum > 0
                      ? `(${formatCurrency(data.accum)})`
                      : formatCurrency(0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Book NBV</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatCurrency(data.bookNbv)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tax NBV</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatCurrency(data.taxNbv)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, VIN, class, or vehicle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
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
        <Select value={reportingGroupFilter} onValueChange={setReportingGroupFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {getAllReportingGroups(customClasses).map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disposed">Disposed</SelectItem>
            <SelectItem value="fully_depreciated">Fully Depreciated</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            As of:
          </span>
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-[160px]"
            placeholder="Live"
          />
          {asOfDate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAsOfDate("")}
              className="h-9 px-2 text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {asOfDate && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Showing register state as of{" "}
          <span className="font-medium text-foreground">
            {new Date(asOfDate + "T00:00:00").toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          . Disposals after this date are ignored; assets acquired after this
          date are excluded.
        </div>
      )}

      {/* Asset Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Car className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Assets Found</h3>
              <p className="text-muted-foreground text-center mb-4">
                {searchQuery ||
                statusFilter !== "active" ||
                masterTypeFilter !== "all" ||
                reportingGroupFilter !== "all"
                  ? "No assets match your current filters."
                  : "Add your first vehicle to start tracking rental assets."}
              </p>
              {!searchQuery &&
                statusFilter === "active" &&
                masterTypeFilter === "all" &&
                reportingGroupFilter === "all" && (
                  <div className="flex items-center gap-2">
                    <Link href={`/${entityId}/assets/import`}>
                      <Button variant="outline">
                        <Upload className="mr-2 h-4 w-4" />
                        Import Wizard
                      </Button>
                    </Link>
                    <Link href={`/${entityId}/assets/new`}>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Vehicle
                      </Button>
                    </Link>
                  </div>
                )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all assets"
                    />
                  </TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>In Service</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Book NBV</TableHead>
                  <TableHead className="text-right">Tax NBV</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => {
                  const classification = getVehicleClassification(asset.vehicle_class, customClasses);
                  return (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(asset.id)}
                          onCheckedChange={() => toggleSelect(asset.id)}
                          aria-label={`Select ${asset.asset_name}`}
                        />
                      </TableCell>
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
                        {asset.vehicle_year || asset.vehicle_make || asset.vehicle_model
                          ? `${asset.vehicle_year ?? ""} ${asset.vehicle_make ?? ""} ${asset.vehicle_model ?? ""}`.trim()
                          : asset.asset_name}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {asset.vin ?? "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(asset.in_service_date).toLocaleDateString()}
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
                        <Badge variant={STATUS_VARIANTS[asset.status] ?? "outline"}>
                          {STATUS_LABELS[asset.status] ?? asset.status}
                        </Badge>
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
              </TableBody>
              <TableFooter>
                <TableRow className="font-semibold">
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell>Total ({filteredAssets.length})</TableCell>
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
                  <TableCell></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="depreciation">
          <DepreciationScheduleTab
            entityId={entityId}
            customClasses={customClasses}
          />
        </TabsContent>

        <TabsContent value="sold">
          <SoldTab entityId={entityId} />
        </TabsContent>

        <TabsContent value="reconciliation">
          <ReconciliationTab entityId={entityId} />
        </TabsContent>

        <TabsContent value="roll-forward">
          <RollForwardTab entityId={entityId} />
        </TabsContent>
      </Tabs>

      {/* Sold Vehicle Dialog */}
      <Dialog open={soldOpen} onOpenChange={(open) => {
        setSoldOpen(open);
        if (!open) {
          setSoldAssetId("");
          setSoldAssetData(null);
          setSoldBuyer("");
          setSoldDate("");
          setSoldPrice("0");
          setSoldNotes("");
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Vehicle Sale</DialogTitle>
            <DialogDescription>
              Select a vehicle and enter the sale details. This will mark the
              asset as disposed and update the roll forward.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="soldVehicle">Vehicle</Label>
              <Popover open={vehiclePickerOpen} onOpenChange={setVehiclePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={vehiclePickerOpen}
                    className="w-full justify-between"
                  >
                    {soldAssetId
                      ? activeAssets.find((a) => a.id === soldAssetId)?.asset_name ?? "Select a vehicle..."
                      : "Select a vehicle..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search vehicles..." />
                    <CommandList>
                      <CommandEmpty>No vehicles found.</CommandEmpty>
                      <CommandGroup>
                        {activeAssets.map((a) => (
                          <CommandItem
                            key={a.id}
                            value={a.asset_name}
                            onSelect={() => {
                              handleSoldAssetChange(a.id);
                              setVehiclePickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                soldAssetId === a.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {a.asset_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="soldBuyer">Buyer</Label>
              <Input
                id="soldBuyer"
                placeholder="Who purchased this vehicle?"
                value={soldBuyer}
                onChange={(e) => setSoldBuyer(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="soldDate">Sale Date</Label>
                <Input
                  id="soldDate"
                  type="date"
                  value={soldDate}
                  onChange={(e) => setSoldDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="soldPrice">Sale Price</Label>
                <Input
                  id="soldPrice"
                  type="number"
                  step="0.01"
                  value={soldPrice}
                  onChange={(e) => setSoldPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="soldNotes">Notes</Label>
              <Textarea
                id="soldNotes"
                placeholder="Additional details about the sale..."
                value={soldNotes}
                onChange={(e) => setSoldNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Gain/Loss Preview */}
            {soldAssetData && soldPreviewGainLoss && (
              <div className="rounded-lg border p-4 space-y-2 bg-muted/40">
                <p className="text-sm font-medium">Gain / (Loss) Preview</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Book NBV:</span>
                  <span className="tabular-nums text-right">
                    {formatCurrency(
                      soldAssetData.acquisition_cost -
                        soldAssetData.book_accumulated_depreciation
                    )}
                  </span>
                  <span className="text-muted-foreground">Book Gain/(Loss):</span>
                  <span
                    className={`tabular-nums text-right font-medium ${
                      soldPreviewGainLoss.bookGainLoss >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatCurrency(soldPreviewGainLoss.bookGainLoss)}
                  </span>
                  <span className="text-muted-foreground">Tax NBV:</span>
                  <span className="tabular-nums text-right">
                    {formatCurrency(
                      (soldAssetData.tax_cost_basis ?? soldAssetData.acquisition_cost) -
                        soldAssetData.tax_accumulated_depreciation
                    )}
                  </span>
                  <span className="text-muted-foreground">Tax Gain/(Loss):</span>
                  <span
                    className={`tabular-nums text-right font-medium ${
                      soldPreviewGainLoss.taxGainLoss >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatCurrency(soldPreviewGainLoss.taxGainLoss)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSoldOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleSoldSubmit}
              disabled={selling || !soldAssetId || !soldDate}
            >
              {selling ? "Processing..." : "Confirm Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} asset{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected asset{selectedIds.size !== 1 ? "s" : ""} and
              all associated depreciation records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClassSettings
        entityId={entityId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onClassesChanged={loadCustomClasses}
      />

      <DepreciationRulesSettings
        entityId={entityId}
        open={deprRulesOpen}
        onOpenChange={setDeprRulesOpen}
        onRulesChanged={() => {}}
        customClasses={customClasses}
      />

      <RegisterSettings
        entityId={entityId}
        open={registerSettingsOpen}
        onOpenChange={setRegisterSettingsOpen}
        onSaved={(newDate) => setOpeningDate(newDate)}
      />
    </div>
  );
}
