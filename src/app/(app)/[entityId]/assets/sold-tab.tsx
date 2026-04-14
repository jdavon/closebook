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
import { ArrowRight, Car, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  getVehicleClassification,
  getReportingGroup,
  getEffectiveMasterType,
  REPORTING_GROUPS,
} from "@/lib/utils/vehicle-classification";

interface SoldTabProps {
  entityId: string;
}

interface SoldAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  vin: string | null;
  acquisition_cost: number;
  book_net_value: number;
  disposed_date: string | null;
  disposed_sale_price: number | null;
  disposed_book_gain_loss: number | null;
  disposed_tax_gain_loss: number | null;
  disposed_buyer: string | null;
  master_type_override: string | null;
}

export function SoldTab({ entityId }: SoldTabProps) {
  const supabase = createClient();
  const currentYear = new Date().getFullYear();

  const [assets, setAssets] = useState<SoldAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(currentYear));
  const [searchQuery, setSearchQuery] = useState("");
  const [masterTypeFilter, setMasterTypeFilter] = useState("all");
  const [reportingGroupFilter, setReportingGroupFilter] = useState("all");

  const loadSoldAssets = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vehicle_class, vin, acquisition_cost, book_net_value, disposed_date, disposed_sale_price, disposed_book_gain_loss, disposed_tax_gain_loss, disposed_buyer, master_type_override"
      )
      .eq("entity_id", entityId)
      .eq("status", "disposed")
      .gte("disposed_date", `${year}-01-01`)
      .lte("disposed_date", `${year}-12-31`)
      .order("disposed_date", { ascending: false });

    setAssets((data as unknown as SoldAsset[]) ?? []);
    setLoading(false);
  }, [supabase, entityId, year]);

  useEffect(() => {
    loadSoldAssets();
  }, [loadSoldAssets]);

  const filteredAssets = assets.filter((a) => {
    if (masterTypeFilter !== "all") {
      const mt = getEffectiveMasterType(a.vehicle_class, a.master_type_override);
      if (mt !== masterTypeFilter) return false;
    }
    if (reportingGroupFilter !== "all") {
      const rg = getReportingGroup(a.vehicle_class);
      if (rg !== reportingGroupFilter) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = a.asset_name.toLowerCase();
      const vin = (a.vin ?? "").toLowerCase();
      const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
      const buyer = (a.disposed_buyer ?? "").toLowerCase();
      const classification = getVehicleClassification(a.vehicle_class);
      const classInfo = classification
        ? `${classification.className} ${classification.reportingGroup}`.toLowerCase()
        : "";
      if (
        !name.includes(q) &&
        !vin.includes(q) &&
        !desc.includes(q) &&
        !buyer.includes(q) &&
        !classInfo.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalCost = filteredAssets.reduce((s, a) => s + a.acquisition_cost, 0);
  const totalProceeds = filteredAssets.reduce((s, a) => s + (a.disposed_sale_price ?? 0), 0);
  const totalBookGainLoss = filteredAssets.reduce((s, a) => s + (a.disposed_book_gain_loss ?? 0), 0);
  const totalTaxGainLoss = filteredAssets.reduce((s, a) => s + (a.disposed_tax_gain_loss ?? 0), 0);

  // Year options: current year and 4 years back
  const yearOptions = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Vehicles Sold</p>
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
            <p className="text-sm text-muted-foreground">Sale Proceeds</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(totalProceeds)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Book Gain/(Loss)</p>
            <p
              className={`text-2xl font-semibold tabular-nums ${
                totalBookGainLoss >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(totalBookGainLoss)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, VIN, buyer, or class..."
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
      </div>

      {/* Sold Assets Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Car className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Sold Assets</h3>
              <p className="text-muted-foreground text-center">
                {searchQuery || masterTypeFilter !== "all" || reportingGroupFilter !== "all"
                  ? "No sold assets match your current filters."
                  : `No vehicles were sold in ${year}.`}
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
                  <TableHead>Sale Date</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Sale Price</TableHead>
                  <TableHead className="text-right">Book Gain/(Loss)</TableHead>
                  <TableHead className="text-right">Tax Gain/(Loss)</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => {
                  const classification = getVehicleClassification(asset.vehicle_class);
                  return (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        {asset.asset_tag ?? "---"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {classification ? (
                          <div>
                            <span className="font-medium">{classification.class}</span>
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
                        {asset.disposed_date
                          ? new Date(asset.disposed_date).toLocaleDateString()
                          : "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.disposed_buyer ?? "---"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.acquisition_cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(asset.disposed_sale_price ?? 0)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          (asset.disposed_book_gain_loss ?? 0) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatCurrency(asset.disposed_book_gain_loss ?? 0)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          (asset.disposed_tax_gain_loss ?? 0) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatCurrency(asset.disposed_tax_gain_loss ?? 0)}
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
                    {formatCurrency(totalProceeds)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      totalBookGainLoss >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(totalBookGainLoss)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      totalTaxGainLoss >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(totalTaxGainLoss)}
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
