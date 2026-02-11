"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { generateDepreciationSchedule } from "@/lib/utils/depreciation";
import { getCurrentPeriod } from "@/lib/utils/dates";
import {
  getVehicleClassification,
  getClassesGroupedByMasterType,
  getClassLabel,
} from "@/lib/utils/vehicle-classification";
import type {
  BookDepreciationMethod,
  TaxDepreciationMethod,
  VehicleClass,
} from "@/lib/types/database";

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function NewAssetPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [creating, setCreating] = useState(false);

  // Vehicle Info
  const [assetName, setAssetName] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleTrim, setVehicleTrim] = useState("");
  const [vin, setVin] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | "">("");

  // Derive reporting group and master type from class selection
  const classification = vehicleClass ? getVehicleClassification(vehicleClass) : null;
  const [mileage, setMileage] = useState("");
  const [titleNumber, setTitleNumber] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [vehicleNotes, setVehicleNotes] = useState("");

  // Book Basis
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [inServiceDate, setInServiceDate] = useState("");
  const [bookUsefulLifeMonths, setBookUsefulLifeMonths] = useState("60");
  const [bookSalvageValue, setBookSalvageValue] = useState("0");
  const [bookMethod, setBookMethod] = useState<BookDepreciationMethod>("straight_line");

  // Tax Basis
  const [taxCostBasis, setTaxCostBasis] = useState("");
  const [taxMethod, setTaxMethod] = useState<TaxDepreciationMethod>("macrs_5");
  const [taxUsefulLifeMonths, setTaxUsefulLifeMonths] = useState("");
  const [section179, setSection179] = useState("0");
  const [bonusDepr, setBonusDepr] = useState("0");

  // GL Accounts
  const [costAccountId, setCostAccountId] = useState("");
  const [accumDeprAccountId, setAccumDeprAccountId] = useState("");
  const [deprExpenseAccountId, setDeprExpenseAccountId] = useState("");

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    setAccounts((data as Account[]) ?? []);
  }, [supabase, entityId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Auto-generate asset name from vehicle fields
  useEffect(() => {
    if (vehicleYear || vehicleMake || vehicleModel) {
      const parts = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean);
      setAssetName(parts.join(" "));
    }
  }, [vehicleYear, vehicleMake, vehicleModel]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!acquisitionDate || !acquisitionCost || !inServiceDate) {
      toast.error("Acquisition date, cost, and in-service date are required.");
      return;
    }

    setCreating(true);

    const cost = parseFloat(acquisitionCost);
    const salvage = parseFloat(bookSalvageValue) || 0;
    const taxBasis = taxCostBasis ? parseFloat(taxCostBasis) : null;

    const { data, error } = await supabase
      .from("fixed_assets")
      .insert({
        entity_id: entityId,
        asset_name: assetName || "Untitled Asset",
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
        acquisition_cost: cost,
        in_service_date: inServiceDate,
        book_useful_life_months: parseInt(bookUsefulLifeMonths) || 60,
        book_salvage_value: salvage,
        book_depreciation_method: bookMethod,
        tax_cost_basis: taxBasis,
        tax_depreciation_method: taxMethod,
        tax_useful_life_months: taxUsefulLifeMonths
          ? parseInt(taxUsefulLifeMonths)
          : null,
        section_179_amount: parseFloat(section179) || 0,
        bonus_depreciation_amount: parseFloat(bonusDepr) || 0,
        cost_account_id: costAccountId || null,
        accum_depr_account_id: accumDeprAccountId || null,
        depr_expense_account_id: deprExpenseAccountId || null,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }

    // Generate depreciation schedule through current period
    const currentPeriod = getCurrentPeriod();
    const schedule = generateDepreciationSchedule(
      {
        acquisition_cost: cost,
        in_service_date: inServiceDate,
        book_useful_life_months: parseInt(bookUsefulLifeMonths) || 60,
        book_salvage_value: salvage,
        book_depreciation_method: bookMethod,
        tax_cost_basis: taxBasis,
        tax_depreciation_method: taxMethod,
        tax_useful_life_months: taxUsefulLifeMonths
          ? parseInt(taxUsefulLifeMonths)
          : null,
        section_179_amount: parseFloat(section179) || 0,
        bonus_depreciation_amount: parseFloat(bonusDepr) || 0,
      },
      currentPeriod.year,
      currentPeriod.month
    );

    if (schedule.length > 0) {
      const deprEntries = schedule.map((entry) => ({
        fixed_asset_id: data.id,
        period_year: entry.period_year,
        period_month: entry.period_month,
        book_depreciation: entry.book_depreciation,
        book_accumulated: entry.book_accumulated,
        book_net_value: entry.book_net_value,
        tax_depreciation: entry.tax_depreciation,
        tax_accumulated: entry.tax_accumulated,
        tax_net_value: entry.tax_net_value,
      }));

      await supabase.from("fixed_asset_depreciation").insert(deprEntries);

      // Update accumulated depreciation on the asset
      const lastEntry = schedule[schedule.length - 1];
      await supabase
        .from("fixed_assets")
        .update({
          book_accumulated_depreciation: lastEntry.book_accumulated,
          tax_accumulated_depreciation: lastEntry.tax_accumulated,
        })
        .eq("id", data.id);
    }

    toast.success("Vehicle added successfully");
    router.push(`/${entityId}/assets/${data.id}`);
  }

  const assetAccounts = accounts.filter((a) => a.classification === "Asset");
  const expenseAccounts = accounts.filter((a) => a.classification === "Expense");

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
        <Select value={value} onValueChange={onChange}>
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
    <div className="space-y-6 max-w-3xl">
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

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Vehicle</h1>
        <p className="text-muted-foreground">
          Register a new vehicle with book and tax depreciation settings
        </p>
      </div>

      <form onSubmit={handleCreate}>
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
                <CardDescription>
                  Enter the vehicle details for this fixed asset
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="assetTag">Asset Tag</Label>
                    <Input
                      id="assetTag"
                      placeholder="e.g., VEH-001"
                      value={assetTag}
                      onChange={(e) => setAssetTag(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleClass">Vehicle Class</Label>
                    <Select
                      value={vehicleClass}
                      onValueChange={(v) => setVehicleClass(v as VehicleClass)}
                    >
                      <SelectTrigger id="vehicleClass">
                        <SelectValue placeholder="Select class..." />
                      </SelectTrigger>
                      <SelectContent>
                        {getClassesGroupedByMasterType().map((group) => (
                          <SelectGroup key={group.masterType}>
                            <SelectLabel>{group.masterType}s</SelectLabel>
                            {group.classes.map((c) => (
                              <SelectItem key={c.class} value={c.class}>
                                {getClassLabel(c.class)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Reporting Group</Label>
                    <Input
                      value={classification?.reportingGroup ?? "---"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Master Type</Label>
                    <Input
                      value={classification?.masterType ?? "---"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vehicleYear">Year</Label>
                    <Input
                      id="vehicleYear"
                      type="number"
                      placeholder="2024"
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleMake">Make</Label>
                    <Input
                      id="vehicleMake"
                      placeholder="Ford"
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleModel">Model</Label>
                    <Input
                      id="vehicleModel"
                      placeholder="F-150"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicleTrim">Trim</Label>
                    <Input
                      id="vehicleTrim"
                      placeholder="XLT"
                      value={vehicleTrim}
                      onChange={(e) => setVehicleTrim(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vin">VIN</Label>
                    <Input
                      id="vin"
                      placeholder="17-character VIN"
                      value={vin}
                      onChange={(e) => setVin(e.target.value.toUpperCase())}
                      maxLength={17}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mileage">Mileage at Acquisition</Label>
                    <Input
                      id="mileage"
                      type="number"
                      placeholder="0"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="licensePlate">License Plate</Label>
                    <Input
                      id="licensePlate"
                      value={licensePlate}
                      onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="licenseState">State</Label>
                    <Select value={licenseState} onValueChange={setLicenseState}>
                      <SelectTrigger id="licenseState">
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
                    <Label htmlFor="titleNumber">Title Number</Label>
                    <Input
                      id="titleNumber"
                      value={titleNumber}
                      onChange={(e) => setTitleNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registrationExpiry">Registration Expiry</Label>
                  <Input
                    id="registrationExpiry"
                    type="date"
                    value={registrationExpiry}
                    onChange={(e) => setRegistrationExpiry(e.target.value)}
                    className="max-w-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleNotes">Notes</Label>
                  <Textarea
                    id="vehicleNotes"
                    placeholder="Additional notes about this vehicle..."
                    value={vehicleNotes}
                    onChange={(e) => setVehicleNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Book Basis Tab */}
          <TabsContent value="book">
            <Card>
              <CardHeader>
                <CardTitle>Book Basis</CardTitle>
                <CardDescription>
                  Set the book depreciation parameters for GAAP reporting
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
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="acquisitionCost">Acquisition Cost</Label>
                    <Input
                      id="acquisitionCost"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={acquisitionCost}
                      onChange={(e) => setAcquisitionCost(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="inServiceDate">In-Service Date</Label>
                    <Input
                      id="inServiceDate"
                      type="date"
                      value={inServiceDate}
                      onChange={(e) => setInServiceDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bookMethod">Depreciation Method</Label>
                    <Select
                      value={bookMethod}
                      onValueChange={(v) =>
                        setBookMethod(v as BookDepreciationMethod)
                      }
                    >
                      <SelectTrigger id="bookMethod">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="straight_line">Straight-Line</SelectItem>
                        <SelectItem value="declining_balance">
                          Double Declining Balance
                        </SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bookUsefulLife">Useful Life (months)</Label>
                    <Input
                      id="bookUsefulLife"
                      type="number"
                      value={bookUsefulLifeMonths}
                      onChange={(e) => setBookUsefulLifeMonths(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bookSalvage">Salvage Value</Label>
                    <Input
                      id="bookSalvage"
                      type="number"
                      step="0.01"
                      value={bookSalvageValue}
                      onChange={(e) => setBookSalvageValue(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tax Basis Tab */}
          <TabsContent value="tax">
            <Card>
              <CardHeader>
                <CardTitle>Tax Basis</CardTitle>
                <CardDescription>
                  Configure tax depreciation settings (MACRS, Section 179, bonus)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="taxCostBasis">
                      Tax Cost Basis (leave blank to use acquisition cost)
                    </Label>
                    <Input
                      id="taxCostBasis"
                      type="number"
                      step="0.01"
                      placeholder={acquisitionCost || "Same as acquisition cost"}
                      value={taxCostBasis}
                      onChange={(e) => setTaxCostBasis(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taxMethod">Tax Depreciation Method</Label>
                    <Select
                      value={taxMethod}
                      onValueChange={(v) =>
                        setTaxMethod(v as TaxDepreciationMethod)
                      }
                    >
                      <SelectTrigger id="taxMethod">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="macrs_5">MACRS 5-Year</SelectItem>
                        <SelectItem value="macrs_7">MACRS 7-Year</SelectItem>
                        <SelectItem value="macrs_10">MACRS 10-Year</SelectItem>
                        <SelectItem value="section_179">Section 179</SelectItem>
                        <SelectItem value="bonus_100">100% Bonus</SelectItem>
                        <SelectItem value="bonus_80">80% Bonus</SelectItem>
                        <SelectItem value="bonus_60">60% Bonus</SelectItem>
                        <SelectItem value="straight_line_tax">
                          Straight-Line (Tax)
                        </SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="taxUsefulLife">
                      Tax Useful Life (months)
                    </Label>
                    <Input
                      id="taxUsefulLife"
                      type="number"
                      placeholder="Auto from MACRS"
                      value={taxUsefulLifeMonths}
                      onChange={(e) => setTaxUsefulLifeMonths(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="section179">Section 179 Amount</Label>
                    <Input
                      id="section179"
                      type="number"
                      step="0.01"
                      value={section179}
                      onChange={(e) => setSection179(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bonusDepr">Bonus Depreciation Amount</Label>
                    <Input
                      id="bonusDepr"
                      type="number"
                      step="0.01"
                      value={bonusDepr}
                      onChange={(e) => setBonusDepr(e.target.value)}
                    />
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
                  Link this asset to your chart of accounts for journal entry
                  posting
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

        <div className="flex justify-end pt-6">
          <Button type="submit" disabled={creating} size="lg">
            {creating ? "Creating..." : "Add Vehicle"}
          </Button>
        </div>
      </form>
    </div>
  );
}
