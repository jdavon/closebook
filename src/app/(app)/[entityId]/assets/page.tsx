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
import { Plus, ArrowRight, Car, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import type { AssetStatus } from "@/lib/types/database";

interface FixedAsset {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  in_service_date: string;
  acquisition_cost: number;
  book_net_value: number;
  tax_net_value: number;
  status: string;
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
  const [searchQuery, setSearchQuery] = useState("");

  const loadAssets = useCallback(async () => {
    let query = supabase
      .from("fixed_assets")
      .select(
        "id, asset_name, asset_tag, vehicle_year, vehicle_make, vehicle_model, vin, in_service_date, acquisition_cost, book_net_value, tax_net_value, status"
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

  const filteredAssets = searchQuery
    ? assets.filter((a) => {
        const q = searchQuery.toLowerCase();
        const name = a.asset_name.toLowerCase();
        const vin = (a.vin ?? "").toLowerCase();
        const desc = `${a.vehicle_year ?? ""} ${a.vehicle_make ?? ""} ${a.vehicle_model ?? ""}`.toLowerCase();
        return name.includes(q) || vin.includes(q) || desc.includes(q);
      })
    : assets;

  const totalCost = filteredAssets.reduce((s, a) => s + a.acquisition_cost, 0);
  const totalBookNbv = filteredAssets.reduce((s, a) => s + a.book_net_value, 0);
  const totalTaxNbv = filteredAssets.reduce((s, a) => s + a.tax_net_value, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fixed Assets</h1>
          <p className="text-muted-foreground">
            Vehicle asset register with book and tax basis tracking
          </p>
        </div>
        <Link href={`/${entityId}/assets/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Vehicle
          </Button>
        </Link>
      </div>

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
            <p className="text-sm text-muted-foreground">Active Assets</p>
            <p className="text-2xl font-semibold tabular-nums">
              {filteredAssets.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, VIN, or vehicle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
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
                {searchQuery || statusFilter !== "active"
                  ? "No assets match your current filters."
                  : "Add your first vehicle to start tracking fixed assets."}
              </p>
              {!searchQuery && statusFilter === "active" && (
                <Link href={`/${entityId}/assets/new`}>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Vehicle
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Tag</TableHead>
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
                {filteredAssets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell className="font-medium">
                      {asset.asset_tag ?? "---"}
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
