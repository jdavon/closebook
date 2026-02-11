"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { toast } from "sonner";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { formatCurrency, getPeriodShortLabel, getCurrentPeriod } from "@/lib/utils/dates";
import {
  generateDepreciationSchedule,
  type AssetForDepreciation,
} from "@/lib/utils/depreciation";

interface DepreciationRow {
  id: string;
  period_year: number;
  period_month: number;
  book_depreciation: number;
  book_accumulated: number;
  book_net_value: number;
  tax_depreciation: number;
  tax_accumulated: number;
  tax_net_value: number;
  is_manual_override: boolean;
  notes: string | null;
}

interface AssetSummary {
  id: string;
  asset_name: string;
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
}

export default function DepreciationSchedulePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const assetId = params.assetId as string;
  const router = useRouter();
  const supabase = createClient();

  const [asset, setAsset] = useState<AssetSummary | null>(null);
  const [entries, setEntries] = useState<DepreciationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    const [assetResult, entriesResult] = await Promise.all([
      supabase
        .from("fixed_assets")
        .select(
          "id, asset_name, acquisition_cost, in_service_date, book_useful_life_months, book_salvage_value, book_depreciation_method, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, status"
        )
        .eq("id", assetId)
        .single(),
      supabase
        .from("fixed_asset_depreciation")
        .select("*")
        .eq("fixed_asset_id", assetId)
        .order("period_year")
        .order("period_month"),
    ]);

    setAsset(assetResult.data as unknown as AssetSummary);
    setEntries((entriesResult.data as unknown as DepreciationRow[]) ?? []);
    setLoading(false);
  }, [supabase, assetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleGenerateThroughCurrent() {
    if (!asset) return;
    setGenerating(true);

    const currentPeriod = getCurrentPeriod();

    const assetForCalc: AssetForDepreciation = {
      acquisition_cost: asset.acquisition_cost,
      in_service_date: asset.in_service_date,
      book_useful_life_months: asset.book_useful_life_months,
      book_salvage_value: asset.book_salvage_value,
      book_depreciation_method: asset.book_depreciation_method,
      tax_cost_basis: asset.tax_cost_basis,
      tax_depreciation_method: asset.tax_depreciation_method,
      tax_useful_life_months: asset.tax_useful_life_months,
      section_179_amount: asset.section_179_amount,
      bonus_depreciation_amount: asset.bonus_depreciation_amount,
    };

    const schedule = generateDepreciationSchedule(
      assetForCalc,
      currentPeriod.year,
      currentPeriod.month
    );

    // Find which periods don't already have non-manual entries
    const existingManualPeriods = new Set(
      entries
        .filter((e) => e.is_manual_override)
        .map((e) => `${e.period_year}-${e.period_month}`)
    );

    // Delete existing non-manual entries
    await supabase
      .from("fixed_asset_depreciation")
      .delete()
      .eq("fixed_asset_id", assetId)
      .eq("is_manual_override", false);

    // Insert recalculated entries (skip manual override periods)
    const newEntries = schedule
      .filter(
        (entry) =>
          !existingManualPeriods.has(
            `${entry.period_year}-${entry.period_month}`
          )
      )
      .map((entry) => ({
        fixed_asset_id: assetId,
        period_year: entry.period_year,
        period_month: entry.period_month,
        book_depreciation: entry.book_depreciation,
        book_accumulated: entry.book_accumulated,
        book_net_value: entry.book_net_value,
        tax_depreciation: entry.tax_depreciation,
        tax_accumulated: entry.tax_accumulated,
        tax_net_value: entry.tax_net_value,
        is_manual_override: false,
      }));

    if (newEntries.length > 0) {
      const { error } = await supabase
        .from("fixed_asset_depreciation")
        .insert(newEntries);

      if (error) {
        toast.error(error.message);
        setGenerating(false);
        return;
      }
    }

    // Update accumulated depreciation on asset
    // Combine manual and calculated entries to find latest totals
    const allSchedule = schedule;
    if (allSchedule.length > 0) {
      const lastEntry = allSchedule[allSchedule.length - 1];
      await supabase
        .from("fixed_assets")
        .update({
          book_accumulated_depreciation: lastEntry.book_accumulated,
          tax_accumulated_depreciation: lastEntry.tax_accumulated,
        })
        .eq("id", assetId);
    }

    toast.success("Depreciation schedule regenerated");
    setGenerating(false);
    loadData();
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>;
  if (!asset) return <p className="text-muted-foreground p-6">Asset not found</p>;

  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/assets/${assetId}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Asset
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Depreciation Schedule
          </h1>
          <p className="text-muted-foreground">{asset.asset_name}</p>
        </div>
        {asset.status === "active" && (
          <Button
            onClick={handleGenerateThroughCurrent}
            disabled={generating}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${generating ? "animate-spin" : ""}`}
            />
            {generating ? "Generating..." : "Generate Through Current Period"}
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40">
        <div>
          <span className="text-sm text-muted-foreground">Book Cost</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.acquisition_cost)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Book Method</span>
          <p className="text-lg font-semibold capitalize">
            {asset.book_depreciation_method.replace("_", " ")}
          </p>
        </div>
        <div className="border-l pl-6">
          <span className="text-sm text-muted-foreground">Tax Cost</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(taxBasis)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Tax Method</span>
          <p className="text-lg font-semibold capitalize">
            {asset.tax_depreciation_method.replace("_", " ")}
          </p>
        </div>
      </div>

      {/* Schedule Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Monthly Depreciation ({entries.length} periods)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground text-center mb-4">
                No depreciation entries yet. Click &quot;Generate Through Current
                Period&quot; to calculate.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Book Depr</TableHead>
                    <TableHead className="text-right">Book Accum</TableHead>
                    <TableHead className="text-right">Book NBV</TableHead>
                    <TableHead className="text-right">Tax Depr</TableHead>
                    <TableHead className="text-right">Tax Accum</TableHead>
                    <TableHead className="text-right">Tax NBV</TableHead>
                    <TableHead className="text-center">Override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {getPeriodShortLabel(
                          entry.period_year,
                          entry.period_month
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.book_depreciation)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.book_accumulated)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.book_net_value)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.tax_depreciation)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.tax_accumulated)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(entry.tax_net_value)}
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.is_manual_override && (
                          <Badge variant="outline" className="text-xs">
                            Manual
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
