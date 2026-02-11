"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import type {
  BookDepreciationMethod,
  TaxDepreciationMethod,
  VehicleType,
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
  vehicle_type: string | null;
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

export default function AssetDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const assetId = params.assetId as string;
  const router = useRouter();
  const supabase = createClient();

  const [asset, setAsset] = useState<FixedAssetData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
  const [vehicleType, setVehicleType] = useState<string>("sedan");
  const [mileage, setMileage] = useState("");
  const [titleNumber, setTitleNumber] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [vehicleNotes, setVehicleNotes] = useState("");
  const [costAccountId, setCostAccountId] = useState("");
  const [accumDeprAccountId, setAccumDeprAccountId] = useState("");
  const [deprExpenseAccountId, setDeprExpenseAccountId] = useState("");

  // Disposition
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposedDate, setDisposedDate] = useState("");
  const [disposedSalePrice, setDisposedSalePrice] = useState("0");
  const [dispositionMethod, setDispositionMethod] = useState<DispositionMethod>("sale");
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
      setVehicleType(a.vehicle_type ?? "sedan");
      setMileage(a.mileage_at_acquisition?.toString() ?? "");
      setTitleNumber(a.title_number ?? "");
      setRegistrationExpiry(a.registration_expiry ?? "");
      setVehicleNotes(a.vehicle_notes ?? "");
      setCostAccountId(a.cost_account_id ?? "");
      setAccumDeprAccountId(a.accum_depr_account_id ?? "");
      setDeprExpenseAccountId(a.depr_expense_account_id ?? "");
    }

    setAccounts((accountsResult.data as Account[]) ?? []);
    setLoading(false);
  }, [supabase, assetId, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSave() {
    if (!asset) return;
    setSaving(true);

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
        vehicle_type: vehicleType,
        title_number: titleNumber || null,
        registration_expiry: registrationExpiry || null,
        vehicle_notes: vehicleNotes || null,
        cost_account_id: costAccountId || null,
        accum_depr_account_id: accumDeprAccountId || null,
        depr_expense_account_id: deprExpenseAccountId || null,
      })
      .eq("id", assetId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Asset updated");
      loadData();
    }
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
        <Select value={value} onValueChange={onChange} disabled={isDisposed}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select account..." />
          </SelectTrigger>
          <SelectContent>
            {accountList.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.account_number
                  ? `${account.account_number} - ${account.name}`
                  : account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            <div className="grid grid-cols-5 gap-4 text-sm">
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
                  <Label>Vehicle Type</Label>
                  <Select
                    value={vehicleType}
                    onValueChange={setVehicleType}
                    disabled={isDisposed}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sedan">Sedan</SelectItem>
                      <SelectItem value="suv">SUV</SelectItem>
                      <SelectItem value="truck">Truck</SelectItem>
                      <SelectItem value="van">Van</SelectItem>
                      <SelectItem value="heavy_truck">Heavy Truck</SelectItem>
                      <SelectItem value="trailer">Trailer</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

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
                Book depreciation parameters (set at creation)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Acquisition Date</span>
                  <p className="font-medium">
                    {new Date(asset.acquisition_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Acquisition Cost</span>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(asset.acquisition_cost)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">In-Service Date</span>
                  <p className="font-medium">
                    {new Date(asset.in_service_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Depreciation Method</span>
                  <p className="font-medium capitalize">
                    {asset.book_depreciation_method.replace("_", " ")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Useful Life</span>
                  <p className="font-medium">
                    {asset.book_useful_life_months} months (
                    {(asset.book_useful_life_months / 12).toFixed(1)} years)
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Salvage Value</span>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(asset.book_salvage_value)}
                  </p>
                </div>
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
                "Fixed Asset Cost Account",
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
