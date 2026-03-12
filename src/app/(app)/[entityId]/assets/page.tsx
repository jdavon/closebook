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
import { Plus, ArrowRight, Car, Search, Upload, Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import { calculateDispositionGainLoss } from "@/lib/utils/depreciation";
import {
  getVehicleClassification,
  getReportingGroup,
  getMasterType,
  REPORTING_GROUPS,
} from "@/lib/utils/vehicle-classification";
import type { VehicleClass } from "@/lib/types/database";
import { ReconciliationTab } from "./reconciliation-tab";
import { RollForwardTab } from "./roll-forward-tab";

interface FixedAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  in_service_date: string;
  acquisition_cost: number;
  book_net_value: number;
  tax_net_value: number;
  status: string;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sold Vehicle dialog state
  const [soldOpen, setSoldOpen] = useState(false);
  const [soldAssetId, setSoldAssetId] = useState("");
  const [soldAssetData, setSoldAssetData] = useState<FullAssetData | null>(null);
  const [soldBuyer, setSoldBuyer] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [soldPrice, setSoldPrice] = useState("0");
  const [soldNotes, setSoldNotes] = useState("");
  const [selling, setSelling] = useState(false);

  const loadAssets = useCallback(async () => {
    let query = supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, in_service_date, acquisition_cost, book_net_value, tax_net_value, status"
      )
      .eq("entity_id", entityId)
      .order("asset_name");

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data } = await query;
    setAssets((data as unknown as FixedAsset[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, statusFilter]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const filteredAssets = assets.filter((a) => {
    // Master type filter
    if (masterTypeFilter !== "all") {
      const mt = getMasterType(a.vehicle_class);
      if (mt !== masterTypeFilter) return false;
    }

    // Reporting group filter
    if (reportingGroupFilter !== "all") {
      const rg = getReportingGroup(a.vehicle_class);
      if (rg !== reportingGroupFilter) return false;
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = a.asset_name.toLowerCase();
      const vin = (a.vin ?? "").toLowerCase();
      const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
      const classification = getVehicleClassification(a.vehicle_class);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rental Assets</h1>
          <p className="text-muted-foreground">
            Vehicle asset register with book and tax basis tracking
          </p>
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
          <Link href={`/${entityId}/assets/import`}>
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Import Wizard
            </Button>
          </Link>
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
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="roll-forward">Roll-Forward</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-6">

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Cost</p>
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
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Assets</p>
            <p className="text-2xl font-semibold tabular-nums">
              {filteredAssets.length}
            </p>
          </CardContent>
        </Card>
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
            {REPORTING_GROUPS.map((group) => (
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
      </div>

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
                  const classification = getVehicleClassification(asset.vehicle_class);
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
            </Table>
          )}
        </CardContent>
      </Card>

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
              <Select value={soldAssetId} onValueChange={handleSoldAssetChange}>
                <SelectTrigger id="soldVehicle">
                  <SelectValue placeholder="Select a vehicle..." />
                </SelectTrigger>
                <SelectContent>
                  {activeAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.asset_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    </div>
  );
}
