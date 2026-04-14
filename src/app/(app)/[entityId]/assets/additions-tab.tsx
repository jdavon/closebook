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
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";

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
      </div>

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
