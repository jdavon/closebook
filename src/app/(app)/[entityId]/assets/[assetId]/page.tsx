"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AccountCombobox } from "@/components/ui/account-combobox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Trash2,
  Calculator,
  FileText,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { calculateDispositionGainLoss } from "@/lib/utils/depreciation";
import {
  getVehicleClassification,
  getClassesGroupedByMasterType,
  getClassLabel,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";
import type {
  BookDepreciationMethod,
  TaxDepreciationMethod,
  VehicleClass,
  DispositionMethod,
} from "@/lib/types/database";

interface FixedAssetData {
  id: string;
  asset_name: string;
  asset_tag: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  mileage_at_acquisition: number | null;
  vehicle_class: string | null;
  title_number: string | null;
  registration_expiry: string | null;
  vehicle_notes: string | null;
  acquisition_date: string;
  acquisition_cost: number;
  in_service_date: string;
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  book_accumulated_depreciation: number;
  book_net_value: number;
  tax_cost_basis: number | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  tax_accumulated_depreciation: number;
  tax_net_value: number;
  section_179_amount: number;
  bonus_depreciation_amount: number;
  cost_account_id: string | null;
  accum_depr_account_id: string | null;
  depr_expense_account_id: string | null;
  status: string;
  disposed_date: string | null;
  disposed_sale_price: number | null;
  disposed_book_gain_loss: number | null;
  disposed_tax_gain_loss: number | null;
  disposition_method: string | null;
  disposed_buyer: string | null;
}

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

// Book opening-balance period. Depreciation schedules are generated from
// Jan 2026 onward using `fixed_assets.book_accumulated_depreciation` as the
// 12/31/2025 opening balance, so edits to NBV / Accum Depr are recorded as of
// this period.
const OPENING_YEAR = 2025;
const OPENING_MONTH = 12;
const OPENING_LABEL = "12/31/2025";
const OPENING_CUTOFF = "2025-12-31"; // ISO YYYY-MM-DD — safe for lexicographic compare

// An asset has an opening balance worth editing only if it existed on or
// before 12/31/2025 (i.e. acquired or placed in service by that date).
function hasOpeningBalance(
  acquisitionDate: string,
  inServiceDate: string
): boolean {
  const acqOk = !!acquisitionDate && acquisitionDate.slice(0, 10) <= OPENING_CUTOFF;
  const isOk = !!inServiceDate && inServiceDate.slice(0, 10) <= OPENING_CUTOFF;
  return acqOk || isOk;
}

export default function AssetDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const assetId = params.assetId as string;
  const router = useRouter();
  const supabase = createClient();

  const [asset, setAsset] = useState<FixedAssetData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [assetName, setAssetName] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleTrim, setVehicleTrim] = useState("");
  const [vin, setVin] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [vehicleClass, setVehicleClass] = useState<string>("");
  const [mileage, setMileage] = useState("");
  const [titleNumber, setTitleNumber] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [vehicleNotes, setVehicleNotes] = useState("");
  const [costAccountId, setCostAccountId] = useState("");
  const [accumDeprAccountId, setAccumDeprAccountId] = useState("");
  const [deprExpenseAccountId, setDeprExpenseAccountId] = useState("");

  // Book basis fields
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [inServiceDate, setInServiceDate] = useState("");
  const [bookMethod, setBookMethod] = useState("");
  const [bookUsefulLife, setBookUsefulLife] = useState("");
  const [bookSalvage, setBookSalvage] = useState("");
  // Opening-balance edits (as of 12/31/2025). NBV and Accum Depr are linked:
  // book_net_value = acquisition_cost - book_accumulated_depreciation.
  // Only book_accumulated_depreciation is persisted (book_net_value is a
  // GENERATED column in Postgres).
  const [bookAccumDepr, setBookAccumDepr] = useState("");
  const [bookNetValue, setBookNetValue] = useState("");
  const [openingDirty, setOpeningDirty] = useState(false);

  // Disposition
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposedDate, setDisposedDate] = useState("");
  const [disposedSalePrice, setDisposedSalePrice] = useState("0");
  const [dispositionMethod, setDispositionMethod] = useState<DispositionMethod>("sale");
  const [disposedBuyer, setDisposedBuyer] = useState("");
  const [disposing, setDisposing] = useState(false);

  const loadData = useCallback(async () => {
    const [assetResult, accountsResult] = await Promise.all([
      supabase
        .from("fixed_assets")
        .select("*")
        .eq("id", assetId)
        .single(),
      supabase
        .from("accounts")
        .select("id, name, account_number, classification")
        .eq("entity_id", entityId)
        .eq("is_active", true)
        .order("account_number")
        .order("name"),
    ]);

    const a = assetResult.data as unknown as FixedAssetData;
    if (a) {
      setAsset(a);
      setAssetName(a.asset_name);
      setAssetTag(a.asset_tag ?? "");
      setVehicleYear(a.vehicle_year?.toString() ?? "");
      setVehicleMake(a.vehicle_make ?? "");
      setVehicleModel(a.vehicle_model ?? "");
      setVehicleTrim(a.vehicle_trim ?? "");
      setVin(a.vin ?? "");
      setLicensePlate(a.license_plate ?? "");
      setLicenseState(a.license_state ?? "");
      setVehicleClass(a.vehicle_class ?? "");
      setMileage(a.mileage_at_acquisition?.toString() ?? "");
      setTitleNumber(a.title_number ?? "");
      setRegistrationExpiry(a.registration_expiry ?? "");
      setVehicleNotes(a.vehicle_notes ?? "");
      setCostAccountId(a.cost_account_id ?? "");
      setAccumDeprAccountId(a.accum_depr_account_id ?? "");
      setDeprExpenseAccountId(a.depr_expense_account_id ?? "");
      setAcquisitionDate(a.acquisition_date ?? "");
      setAcquisitionCost(a.acquisition_cost?.toString() ?? "0");
      setInServiceDate(a.in_service_date ?? "");
      setBookMethod(a.book_depreciation_method ?? "straight_line");
      setBookUsefulLife(a.book_useful_life_months?.toString() ?? "0");
      setBookSalvage(a.book_salvage_value?.toString() ?? "0");
      setBookAccumDepr((a.book_accumulated_depreciation ?? 0).toFixed(2));
      setBookNetValue((a.book_net_value ?? 0).toFixed(2));
      setOpeningDirty(false);
    }

    setAccounts((accountsResult.data as Account[]) ?? []);

    // Load custom classes
    const res = await fetch(`/api/assets/classes?entityId=${entityId}`);
    if (res.ok) {
      const rows: CustomVehicleClassRow[] = await res.json();
      setCustomClasses(customRowsToClassifications(rows));
    }

    setLoading(false);
  }, [supabase, assetId, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Linked NBV / Accumulated Depreciation editors. Changing either recomputes
  // the other using the pending acquisition cost (so edits remain consistent
  // if the user is also adjusting cost in the same save).
  function handleAccumDeprChange(value: string) {
    setBookAccumDepr(value);
    setOpeningDirty(true);
    const cost = parseFloat(acquisitionCost) || 0;
    const accum = parseFloat(value);
    if (!Number.isNaN(accum)) {
      setBookNetValue((cost - accum).toFixed(2));
    }
  }

  function handleNetValueChange(value: string) {
    setBookNetValue(value);
    setOpeningDirty(true);
    const cost = parseFloat(acquisitionCost) || 0;
    const nbv = parseFloat(value);
    if (!Number.isNaN(nbv)) {
      setBookAccumDepr((cost - nbv).toFixed(2));
    }
  }

  function handleAcquisitionCostChange(value: string) {
    setAcquisitionCost(value);
    // Rebalance NBV off the (unchanged) accumulated depreciation so the
    // identity NBV = cost − accum still holds after editing cost.
    const cost = parseFloat(value) || 0;
    const accum = parseFloat(bookAccumDepr);
    if (!Number.isNaN(accum)) {
      setBookNetValue((cost - accum).toFixed(2));
    }
  }

  async function handleSave() {
    if (!asset) return;
    setSaving(true);

    const parsedCost = parseFloat(acquisitionCost) || 0;
    const parsedAccum = Math.round((parseFloat(bookAccumDepr) || 0) * 100) / 100;
    const parsedNbv = Math.round((parsedCost - parsedAccum) * 100) / 100;

    const { error } = await supabase
      .from("fixed_assets")
      .update({
        asset_name: assetName,
        asset_tag: assetTag || null,
        vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_trim: vehicleTrim || null,
        vin: vin || null,
        license_plate: licensePlate || null,
        license_state: licenseState || null,
        mileage_at_acquisition: mileage ? parseInt(mileage) : null,
        vehicle_class: vehicleClass || null,
        title_number: titleNumber || null,
        registration_expiry: registrationExpiry || null,
        vehicle_notes: vehicleNotes || null,
        acquisition_date: acquisitionDate,
        acquisition_cost: parsedCost,
        in_service_date: inServiceDate,
        book_depreciation_method: bookMethod || "straight_line",
        book_useful_life_months: parseInt(bookUsefulLife) || 0,
        book_salvage_value: parseFloat(bookSalvage) || 0,
        book_accumulated_depreciation: parsedAccum,
        cost_account_id: costAccountId || null,
        accum_depr_account_id: accumDeprAccountId || null,
        depr_expense_account_id: deprExpenseAccountId || null,
      })
      .eq("id", assetId);

    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    // If the opening balance changed, write a Dec-2025 override row as an
    // audit-trail marker and clear any stale non-manual entries from Jan 2026
    // onward so the next "Generate" picks up the new opening balance.
    // Guard: only applies when the asset existed at the 12/31/2025 cutoff.
    if (openingDirty && hasOpeningBalance(acquisitionDate, inServiceDate)) {
      const previousAccum = asset.book_accumulated_depreciation ?? 0;
      const { error: upsertError } = await supabase
        .from("fixed_asset_depreciation")
        .upsert(
          {
            fixed_asset_id: assetId,
            period_year: OPENING_YEAR,
            period_month: OPENING_MONTH,
            book_depreciation: 0,
            book_accumulated: parsedAccum,
            book_net_value: parsedNbv,
            tax_depreciation: 0,
            tax_accumulated: asset.tax_accumulated_depreciation ?? 0,
            tax_net_value:
              (asset.tax_cost_basis ?? parsedCost) -
              (asset.tax_accumulated_depreciation ?? 0),
            is_manual_override: true,
            notes: `Book opening balance edited as of ${OPENING_LABEL}. Previous accumulated: ${previousAccum.toFixed(2)}, new accumulated: ${parsedAccum.toFixed(2)}.`,
          },
          { onConflict: "fixed_asset_id,period_year,period_month" }
        );

      if (upsertError) {
        toast.error(`Saved asset, but failed to log opening balance: ${upsertError.message}`);
        setSaving(false);
        loadData();
        return;
      }

      // Clear stale calculated entries from Jan 2026 onward; manual overrides
      // are preserved so prior adjustments remain.
      await supabase
        .from("fixed_asset_depreciation")
        .delete()
        .eq("fixed_asset_id", assetId)
        .eq("is_manual_override", false)
        .or(
          `period_year.gt.${OPENING_YEAR},and(period_year.eq.${OPENING_YEAR},period_month.gt.${OPENING_MONTH})`
        );

      toast.success(
        `Opening balance updated as of ${OPENING_LABEL}. Regenerate the depreciation schedule to roll forward.`
      );
    } else {
      toast.success("Asset updated");
    }

    loadData();
    setSaving(false);
  }

  async function handleDispose() {
    if (!asset || !disposedDate) return;
    setDisposing(true);

    const salePrice = parseFloat(disposedSalePrice) || 0;
    const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;

    const { bookGainLoss, taxGainLoss } = calculateDispositionGainLoss(
      asset.acquisition_cost,
      asset.book_accumulated_depreciation,
      asset.book_salvage_value,
      taxBasis,
      asset.tax_accumulated_depreciation,
      salePrice
    );

    const { error } = await supabase
      .from("fixed_assets")
      .update({
        status: "disposed",
        disposed_date: disposedDate,
        disposed_sale_price: salePrice,
        disposed_book_gain_loss: bookGainLoss,
        disposed_tax_gain_loss: taxGainLoss,
        disposition_method: dispositionMethod,
        disposed_buyer: disposedBuyer || null,
      })
      .eq("id", assetId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Asset disposed");
      setDisposeOpen(false);
      loadData();
    }
    setDisposing(false);
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>;
  if (!asset) return <p className="text-muted-foreground p-6">Asset not found</p>;

  const isDisposed = asset.status === "disposed";
  const openingEligible = hasOpeningBalance(acquisitionDate, inServiceDate);
  const openingLocked = isDisposed || !openingEligible;
  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;
  const assetAccounts = accounts.filter((a) => a.classification === "Asset");
  const expenseAccounts = accounts.filter((a) => a.classification === "Expense");

  // Preview gain/loss while filling disposition form
  const previewSalePrice = parseFloat(disposedSalePrice) || 0;
  const previewGainLoss = calculateDispositionGainLoss(
    asset.acquisition_cost,
    asset.book_accumulated_depreciation,
    asset.book_salvage_value,
    taxBasis,
    asset.tax_accumulated_depreciation,
    previewSalePrice
  );

  function renderAccountSelect(
    label: string,
    id: string,
    value: string,
    onChange: (v: string) => void,
    accountList: Account[]
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <AccountCombobox
          accounts={accountList.map((a) => ({
            id: a.id,
            account_number: a.account_number,
            name: a.name,
          }))}
          value={value}
          onValueChange={onChange}
          disabled={isDisposed}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/assets`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {asset.asset_name}
            </h1>
            <Badge variant={STATUS_VARIANTS[asset.status] ?? "outline"}>
              {STATUS_LABELS[asset.status] ?? asset.status}
            </Badge>
          </div>
          {asset.vin && (
            <p className="text-muted-foreground font-mono text-sm">
              VIN: {asset.vin}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/${entityId}/assets/${assetId}/depreciation`}>
            <Button variant="outline">
              <Calculator className="mr-2 h-4 w-4" />
              Depreciation Schedule
            </Button>
          </Link>
          {!isDisposed && (
            <>
              <Sheet open={disposeOpen} onOpenChange={setDisposeOpen}>
                <SheetTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Dispose
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Dispose Asset</SheetTitle>
                    <SheetDescription>
                      Record the sale, trade-in, or disposal of this vehicle
                    </SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 mt-6">
                    <div className="space-y-2">
                      <Label htmlFor="disposedDate">Disposition Date</Label>
                      <Input
                        id="disposedDate"
                        type="date"
                        value={disposedDate}
                        onChange={(e) => setDisposedDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dispositionMethod">Method</Label>
                      <Select
                        value={dispositionMethod}
                        onValueChange={(v) =>
                          setDispositionMethod(v as DispositionMethod)
                        }
                      >
                        <SelectTrigger id="dispositionMethod">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sale">Sale</SelectItem>
                          <SelectItem value="trade_in">Trade-In</SelectItem>
                          <SelectItem value="scrap">Scrap</SelectItem>
                          <SelectItem value="theft">Theft</SelectItem>
                          <SelectItem value="casualty">Casualty</SelectItem>
                          <SelectItem value="donation">Donation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="disposedBuyer">Buyer</Label>
                      <Input
                        id="disposedBuyer"
                        placeholder="Who purchased this vehicle?"
                        value={disposedBuyer}
                        onChange={(e) => setDisposedBuyer(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="salePrice">Sale / Proceeds Amount</Label>
                      <Input
                        id="salePrice"
                        type="number"
                        step="0.01"
                        value={disposedSalePrice}
                        onChange={(e) => setDisposedSalePrice(e.target.value)}
                      />
                    </div>

                    {/* Gain/Loss Preview */}
                    <div className="rounded-lg border p-4 space-y-2 bg-muted/40">
                      <p className="text-sm font-medium">Gain / (Loss) Preview</p>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <span className="text-muted-foreground">Book NBV:</span>
                        <span className="tabular-nums text-right">
                          {formatCurrency(asset.acquisition_cost - asset.book_accumulated_depreciation)}
                        </span>
                        <span className="text-muted-foreground">Book Gain/(Loss):</span>
                        <span
                          className={`tabular-nums text-right font-medium ${
                            previewGainLoss.bookGainLoss >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatCurrency(previewGainLoss.bookGainLoss)}
                        </span>
                        <span className="text-muted-foreground">Tax NBV:</span>
                        <span className="tabular-nums text-right">
                          {formatCurrency(taxBasis - asset.tax_accumulated_depreciation)}
                        </span>
                        <span className="text-muted-foreground">Tax Gain/(Loss):</span>
                        <span
                          className={`tabular-nums text-right font-medium ${
                            previewGainLoss.taxGainLoss >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatCurrency(previewGainLoss.taxGainLoss)}
                        </span>
                      </div>
                    </div>

                    <Button
                      onClick={handleDispose}
                      disabled={disposing || !disposedDate}
                      variant="destructive"
                      className="w-full"
                    >
                      {disposing ? "Processing..." : "Confirm Disposition"}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/40">
        <div>
          <span className="text-sm text-muted-foreground">Book Cost</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.acquisition_cost)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Book Accum Depr</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.book_accumulated_depreciation)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Book NBV</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.book_net_value)}
          </p>
        </div>
        <div className="border-l pl-6">
          <span className="text-sm text-muted-foreground">Tax Cost</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(taxBasis)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Tax Accum Depr</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.tax_accumulated_depreciation)}
          </p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">Tax NBV</span>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(asset.tax_net_value)}
          </p>
        </div>
      </div>

      {/* Disposition Details (if disposed) */}
      {isDisposed && asset.disposed_date && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Disposition Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Date</span>
                <p className="font-medium">
                  {new Date(asset.disposed_date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Method</span>
                <p className="font-medium capitalize">
                  {asset.disposition_method?.replace("_", " ") ?? "---"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Buyer</span>
                <p className="font-medium">
                  {asset.disposed_buyer ?? "---"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Sale Price</span>
                <p className="font-medium tabular-nums">
                  {formatCurrency(asset.disposed_sale_price ?? 0)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Book Gain/(Loss)</span>
                <p
                  className={`font-medium tabular-nums ${
                    (asset.disposed_book_gain_loss ?? 0) >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {formatCurrency(asset.disposed_book_gain_loss ?? 0)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Tax Gain/(Loss)</span>
                <p
                  className={`font-medium tabular-nums ${
                    (asset.disposed_tax_gain_loss ?? 0) >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {formatCurrency(asset.disposed_tax_gain_loss ?? 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Editable Tabs */}
      <Tabs defaultValue="vehicle" className="space-y-6">
        <TabsList>
          <TabsTrigger value="vehicle">Vehicle Info</TabsTrigger>
          <TabsTrigger value="book">Book Basis</TabsTrigger>
          <TabsTrigger value="tax">Tax Basis</TabsTrigger>
          <TabsTrigger value="gl">GL Accounts</TabsTrigger>
        </TabsList>

        {/* Vehicle Info Tab */}
        <TabsContent value="vehicle">
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Asset Name</Label>
                  <Input
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Asset Tag</Label>
                  <Input
                    value={assetTag}
                    onChange={(e) => setAssetTag(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Year</Label>
                  <Input
                    type="number"
                    value={vehicleYear}
                    onChange={(e) => setVehicleYear(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Make</Label>
                  <Input
                    value={vehicleMake}
                    onChange={(e) => setVehicleMake(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Trim</Label>
                  <Input
                    value={vehicleTrim}
                    onChange={(e) => setVehicleTrim(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>VIN</Label>
                  <Input
                    value={vin}
                    onChange={(e) => setVin(e.target.value.toUpperCase())}
                    disabled={isDisposed}
                    className="font-mono"
                    maxLength={17}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vehicle Class</Label>
                  <Select
                    value={vehicleClass}
                    onValueChange={setVehicleClass}
                    disabled={isDisposed}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select class..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getClassesGroupedByMasterType(customClasses).map((group) => (
                        <SelectGroup key={group.label}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.classes.map((c) => (
                            <SelectItem key={c.class} value={c.class}>
                              {getClassLabel(c.class, customClasses)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {vehicleClass && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Reporting Group</Label>
                    <Input
                      value={getVehicleClassification(vehicleClass, customClasses)?.reportingGroup ?? "---"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Master Type</Label>
                    <Input
                      value={getVehicleClassification(vehicleClass, customClasses)?.masterType ?? "---"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>License Plate</Label>
                  <Input
                    value={licensePlate}
                    onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Select
                    value={licenseState}
                    onValueChange={setLicenseState}
                    disabled={isDisposed}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((st) => (
                        <SelectItem key={st} value={st}>
                          {st}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Mileage at Acquisition</Label>
                  <Input
                    type="number"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Title Number</Label>
                  <Input
                    value={titleNumber}
                    onChange={(e) => setTitleNumber(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Registration Expiry</Label>
                  <Input
                    type="date"
                    value={registrationExpiry}
                    onChange={(e) => setRegistrationExpiry(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={vehicleNotes}
                  onChange={(e) => setVehicleNotes(e.target.value)}
                  disabled={isDisposed}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Book Basis Tab (read-only display of depreciation params) */}
        <TabsContent value="book">
          <Card>
            <CardHeader>
              <CardTitle>Book Basis</CardTitle>
              <CardDescription>
                Book depreciation parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="acquisitionDate">Acquisition Date</Label>
                  <Input
                    id="acquisitionDate"
                    type="date"
                    value={acquisitionDate}
                    onChange={(e) => setAcquisitionDate(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acquisitionCost">Acquisition Cost</Label>
                  <CurrencyInput
                    id="acquisitionCost"
                    value={acquisitionCost}
                    onValueChange={handleAcquisitionCostChange}
                    disabled={isDisposed}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inServiceDate">In-Service Date</Label>
                  <Input
                    id="inServiceDate"
                    type="date"
                    value={inServiceDate}
                    onChange={(e) => setInServiceDate(e.target.value)}
                    disabled={isDisposed}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bookMethod">Depreciation Method</Label>
                  <Select
                    value={bookMethod}
                    onValueChange={setBookMethod}
                    disabled={isDisposed}
                  >
                    <SelectTrigger id="bookMethod">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Straight Line</SelectItem>
                      <SelectItem value="declining_balance">Declining Balance</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bookUsefulLife">Useful Life (months)</Label>
                  <Input
                    id="bookUsefulLife"
                    type="number"
                    value={bookUsefulLife}
                    onChange={(e) => setBookUsefulLife(e.target.value)}
                    disabled={isDisposed}
                  />
                  {parseInt(bookUsefulLife) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {(parseInt(bookUsefulLife) / 12).toFixed(1)} years
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bookSalvage">Salvage Value</Label>
                  <CurrencyInput
                    id="bookSalvage"
                    value={bookSalvage}
                    onValueChange={setBookSalvage}
                    disabled={isDisposed}
                    className="tabular-nums"
                  />
                </div>
              </div>
              {!isDisposed && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    After changing book basis fields, regenerate the depreciation
                    schedule from the Depreciation tab to recalculate.
                  </p>
                </div>
              )}

              {/* Opening balance editor — as of 12/31/2025 */}
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Opening Balance</h3>
                    <p className="text-xs text-muted-foreground">
                      Book-basis carrying values carried forward from prior
                      close. Depreciation schedules roll forward from this
                      point.
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    As of {OPENING_LABEL}
                  </Badge>
                </div>

                {!openingEligible && !isDisposed && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      Opening balance editing is unavailable — this asset was
                      neither acquired nor placed in service on or before{" "}
                      {OPENING_LABEL}, so it has no prior-period book balance
                      to carry forward. Depreciation is calculated from the
                      in-service date.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bookAccumDepr">
                      Accumulated Depreciation (Book)
                    </Label>
                    <CurrencyInput
                      id="bookAccumDepr"
                      value={bookAccumDepr}
                      onValueChange={handleAccumDeprChange}
                      disabled={openingLocked}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bookNetValue">
                      Net Book Value (Book)
                    </Label>
                    <CurrencyInput
                      id="bookNetValue"
                      value={bookNetValue}
                      onValueChange={handleNetValueChange}
                      disabled={openingLocked}
                      className="tabular-nums"
                    />
                  </div>
                </div>

                {openingDirty && !openingLocked && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/30">
                    <p className="text-xs text-amber-900 dark:text-amber-200">
                      <strong>Pending opening-balance change.</strong> On save,
                      this will be recorded as the book opening balance as of{" "}
                      {OPENING_LABEL}, any non-manual depreciation entries
                      after that date will be cleared, and you'll need to
                      regenerate the schedule from the Depreciation tab to roll
                      forward.
                    </p>
                  </div>
                )}

                {openingEligible && (
                  <p className="text-xs text-muted-foreground">
                    Edit either field — the other is derived automatically from{" "}
                    <span className="font-mono">NBV = Cost − Accumulated</span>.
                    Only accumulated depreciation is stored; NBV is computed by
                    the database.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tax Basis Tab (read-only display) */}
        <TabsContent value="tax">
          <Card>
            <CardHeader>
              <CardTitle>Tax Basis</CardTitle>
              <CardDescription>
                Tax depreciation parameters (set at creation)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Tax Cost Basis</span>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(taxBasis)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tax Method</span>
                  <p className="font-medium capitalize">
                    {asset.tax_depreciation_method.replace("_", " ")}
                  </p>
                </div>
                {asset.tax_useful_life_months && (
                  <div>
                    <span className="text-muted-foreground">Tax Useful Life</span>
                    <p className="font-medium">
                      {asset.tax_useful_life_months} months
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Section 179</span>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(asset.section_179_amount)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Bonus Depreciation</span>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(asset.bonus_depreciation_amount)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* GL Accounts Tab */}
        <TabsContent value="gl">
          <Card>
            <CardHeader>
              <CardTitle>GL Accounts</CardTitle>
              <CardDescription>
                Chart of accounts linkage for journal entries
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {renderAccountSelect(
                "Rental Asset Cost Account",
                "costAccount",
                costAccountId,
                setCostAccountId,
                assetAccounts
              )}
              {renderAccountSelect(
                "Accumulated Depreciation Account",
                "accumDeprAccount",
                accumDeprAccountId,
                setAccumDeprAccountId,
                assetAccounts
              )}
              {renderAccountSelect(
                "Depreciation Expense Account",
                "deprExpenseAccount",
                deprExpenseAccountId,
                setDeprExpenseAccountId,
                expenseAccounts
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
