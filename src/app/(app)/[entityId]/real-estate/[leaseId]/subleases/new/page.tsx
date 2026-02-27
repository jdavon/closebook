"use client";

import { useState, useEffect } from "react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { generateSubleasePaymentSchedule } from "@/lib/utils/sublease-payments";
import type {
  SubleaseStatus,
  MaintenanceType,
  SubleasePaymentType,
} from "@/lib/types/database";

export default function NewSubleasePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const leaseId = params.leaseId as string;
  const router = useRouter();
  const supabase = createClient();

  const [creating, setCreating] = useState(false);

  // Sublease Identification
  const [subleaseName, setSubleaseName] = useState("");
  const [subtenantName, setSubtenantName] = useState("");
  const [subtenantContactInfo, setSubtenantContactInfo] = useState("");
  const [status, setStatus] = useState<SubleaseStatus>("draft");

  // Space
  const [subleasedSquareFootage, setSubleasedSquareFootage] = useState("");
  const [floorSuite, setFloorSuite] = useState("");

  // Dates & Term
  const [commencementDate, setCommencementDate] = useState("");
  const [rentCommencementDate, setRentCommencementDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [subleaseTermMonths, setSubleaseTermMonths] = useState("");

  // Income Terms
  const [baseRentMonthly, setBaseRentMonthly] = useState("");
  const [rentPerSf, setRentPerSf] = useState("");
  const [securityDepositHeld, setSecurityDepositHeld] = useState("");
  const [rentAbatementMonths, setRentAbatementMonths] = useState("0");
  const [rentAbatementAmount, setRentAbatementAmount] = useState("0");

  // Operating Cost Recoveries (Income)
  const [camRecoveryMonthly, setCamRecoveryMonthly] = useState("");
  const [insuranceRecoveryMonthly, setInsuranceRecoveryMonthly] = useState("");
  const [propertyTaxRecoveryMonthly, setPropertyTaxRecoveryMonthly] =
    useState("");
  const [utilitiesRecoveryMonthly, setUtilitiesRecoveryMonthly] = useState("");
  const [otherRecoveryMonthly, setOtherRecoveryMonthly] = useState("");
  const [otherRecoveryDescription, setOtherRecoveryDescription] = useState("");

  // Lease Structure
  const [maintenanceType, setMaintenanceType] =
    useState<MaintenanceType>("gross");
  const [permittedUse, setPermittedUse] = useState("");
  const [notes, setNotes] = useState("");

  // Auto-calculate sublease term from dates
  useEffect(() => {
    if (commencementDate && expirationDate) {
      const start = new Date(commencementDate + "T00:00:00");
      const end = new Date(expirationDate + "T00:00:00");
      const months =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());
      if (months > 0) setSubleaseTermMonths(String(months));
    }
  }, [commencementDate, expirationDate]);

  // Auto-calculate rent per SF
  useEffect(() => {
    const rent = parseFloat(baseRentMonthly);
    const sf = parseFloat(subleasedSquareFootage);
    if (rent > 0 && sf > 0) {
      setRentPerSf(((rent * 12) / sf).toFixed(2));
    }
  }, [baseRentMonthly, subleasedSquareFootage]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    if (
      !subleaseName ||
      !subtenantName ||
      !commencementDate ||
      !expirationDate ||
      !baseRentMonthly ||
      !subleaseTermMonths
    ) {
      toast.error(
        "Sublease name, subtenant name, dates, term, and base rent are required."
      );
      return;
    }

    setCreating(true);

    // 1. Insert sublease
    const { data: sublease, error: subleaseError } = await supabase
      .from("subleases")
      .insert({
        lease_id: leaseId,
        entity_id: entityId,
        sublease_name: subleaseName,
        subtenant_name: subtenantName,
        subtenant_contact_info: subtenantContactInfo || null,
        status,
        subleased_square_footage: subleasedSquareFootage
          ? parseFloat(subleasedSquareFootage)
          : null,
        floor_suite: floorSuite || null,
        commencement_date: commencementDate,
        rent_commencement_date: rentCommencementDate || null,
        expiration_date: expirationDate,
        sublease_term_months: parseInt(subleaseTermMonths) || 0,
        base_rent_monthly: parseFloat(baseRentMonthly) || 0,
        rent_per_sf: rentPerSf ? parseFloat(rentPerSf) : null,
        security_deposit_held: parseFloat(securityDepositHeld) || 0,
        rent_abatement_months: parseInt(rentAbatementMonths) || 0,
        rent_abatement_amount: parseFloat(rentAbatementAmount) || 0,
        cam_recovery_monthly: parseFloat(camRecoveryMonthly) || 0,
        insurance_recovery_monthly: parseFloat(insuranceRecoveryMonthly) || 0,
        property_tax_recovery_monthly:
          parseFloat(propertyTaxRecoveryMonthly) || 0,
        utilities_recovery_monthly: parseFloat(utilitiesRecoveryMonthly) || 0,
        other_recovery_monthly: parseFloat(otherRecoveryMonthly) || 0,
        other_recovery_description: otherRecoveryDescription || null,
        maintenance_type: maintenanceType,
        permitted_use: permittedUse || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (subleaseError) {
      toast.error(subleaseError.message);
      setCreating(false);
      return;
    }

    // 2. Generate sublease payment schedule
    const schedule = generateSubleasePaymentSchedule(
      {
        commencement_date: commencementDate,
        rent_commencement_date: rentCommencementDate || null,
        expiration_date: expirationDate,
        base_rent_monthly: parseFloat(baseRentMonthly) || 0,
        cam_recovery_monthly: parseFloat(camRecoveryMonthly) || 0,
        insurance_recovery_monthly: parseFloat(insuranceRecoveryMonthly) || 0,
        property_tax_recovery_monthly:
          parseFloat(propertyTaxRecoveryMonthly) || 0,
        utilities_recovery_monthly: parseFloat(utilitiesRecoveryMonthly) || 0,
        other_recovery_monthly: parseFloat(otherRecoveryMonthly) || 0,
        rent_abatement_months: parseInt(rentAbatementMonths) || 0,
        rent_abatement_amount: parseFloat(rentAbatementAmount) || 0,
      },
      [] // no escalations on initial creation
    );

    if (schedule.length > 0) {
      const paymentRows = schedule.map((entry) => ({
        sublease_id: sublease.id,
        period_year: entry.period_year,
        period_month: entry.period_month,
        payment_type: entry.payment_type,
        scheduled_amount: entry.scheduled_amount,
      }));

      // Insert in batches of 500 to avoid request size limits
      for (let i = 0; i < paymentRows.length; i += 500) {
        const batch = paymentRows.slice(i, i + 500);
        const { error: payError } = await supabase
          .from("sublease_payments")
          .insert(batch);
        if (payError) {
          toast.error(`Payment schedule error: ${payError.message}`);
        }
      }
    }

    toast.success("Sublease created successfully");
    router.push(
      `/${entityId}/real-estate/${leaseId}?tab=subleases`
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/${entityId}/real-estate/${leaseId}`)
          }
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Sublease</h1>
        <p className="text-muted-foreground">
          Add a new sublease with subtenant details and income terms
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Sublease Identification */}
            <Card>
              <CardHeader>
                <CardTitle>Sublease Identification</CardTitle>
                <CardDescription>
                  Name this sublease and identify the subtenant
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="subleaseName">Sublease Name *</Label>
                  <Input
                    id="subleaseName"
                    placeholder="e.g., Suite 200 - Acme Corp"
                    value={subleaseName}
                    onChange={(e) => setSubleaseName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subtenantName">Subtenant Name *</Label>
                  <Input
                    id="subtenantName"
                    placeholder="e.g., Acme Corporation"
                    value={subtenantName}
                    onChange={(e) => setSubtenantName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subtenantContactInfo">
                    Subtenant Contact Info
                  </Label>
                  <Textarea
                    id="subtenantContactInfo"
                    placeholder="Phone, email, address..."
                    value={subtenantContactInfo}
                    onChange={(e) => setSubtenantContactInfo(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as SubleaseStatus)}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Space */}
            <Card>
              <CardHeader>
                <CardTitle>Space</CardTitle>
                <CardDescription>
                  Subleased area within the master lease
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="subleasedSquareFootage">
                      Subleased Square Footage
                    </Label>
                    <Input
                      id="subleasedSquareFootage"
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={subleasedSquareFootage}
                      onChange={(e) =>
                        setSubleasedSquareFootage(e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="floorSuite">Floor / Suite</Label>
                    <Input
                      id="floorSuite"
                      placeholder="e.g., 2nd Floor, Suite 200"
                      value={floorSuite}
                      onChange={(e) => setFloorSuite(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Dates & Term */}
            <Card>
              <CardHeader>
                <CardTitle>Dates & Term</CardTitle>
                <CardDescription>
                  Sublease commencement, expiration, and term length
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="commencementDate">
                      Commencement Date *
                    </Label>
                    <Input
                      id="commencementDate"
                      type="date"
                      value={commencementDate}
                      onChange={(e) => setCommencementDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentCommencementDate">
                      Rent Commencement
                    </Label>
                    <Input
                      id="rentCommencementDate"
                      type="date"
                      value={rentCommencementDate}
                      onChange={(e) => setRentCommencementDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="expirationDate">Expiration Date *</Label>
                    <Input
                      id="expirationDate"
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subleaseTermMonths">
                      Sublease Term (months) *
                    </Label>
                    <Input
                      id="subleaseTermMonths"
                      type="number"
                      value={subleaseTermMonths}
                      onChange={(e) => setSubleaseTermMonths(e.target.value)}
                      className="bg-muted"
                      required
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Income Terms */}
            <Card>
              <CardHeader>
                <CardTitle>Income Terms</CardTitle>
                <CardDescription>
                  Base rent, security deposit, and abatement terms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="baseRentMonthly">
                      Base Rent (Monthly) *
                    </Label>
                    <Input
                      id="baseRentMonthly"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={baseRentMonthly}
                      onChange={(e) => setBaseRentMonthly(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentPerSf">Rent per SF (Annual)</Label>
                    <Input
                      id="rentPerSf"
                      type="number"
                      step="0.01"
                      value={rentPerSf}
                      className="bg-muted"
                      readOnly
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityDepositHeld">
                    Security Deposit Held
                  </Label>
                  <Input
                    id="securityDepositHeld"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={securityDepositHeld}
                    onChange={(e) => setSecurityDepositHeld(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rentAbatementMonths">
                      Abatement Months
                    </Label>
                    <Input
                      id="rentAbatementMonths"
                      type="number"
                      value={rentAbatementMonths}
                      onChange={(e) => setRentAbatementMonths(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentAbatementAmount">
                      Abatement Amount (Monthly)
                    </Label>
                    <Input
                      id="rentAbatementAmount"
                      type="number"
                      step="0.01"
                      placeholder="0 for free rent"
                      value={rentAbatementAmount}
                      onChange={(e) => setRentAbatementAmount(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Operating Cost Recoveries (Income) */}
            <Card>
              <CardHeader>
                <CardTitle>Operating Cost Recoveries (Income)</CardTitle>
                <CardDescription>
                  Monthly amounts recovered from the subtenant
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="camRecoveryMonthly">
                      CAM Recovery (Monthly)
                    </Label>
                    <Input
                      id="camRecoveryMonthly"
                      type="number"
                      step="0.01"
                      value={camRecoveryMonthly}
                      onChange={(e) => setCamRecoveryMonthly(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="insuranceRecoveryMonthly">
                      Insurance Recovery (Monthly)
                    </Label>
                    <Input
                      id="insuranceRecoveryMonthly"
                      type="number"
                      step="0.01"
                      value={insuranceRecoveryMonthly}
                      onChange={(e) =>
                        setInsuranceRecoveryMonthly(e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="propertyTaxRecoveryMonthly">
                      Property Tax Recovery (Monthly)
                    </Label>
                    <Input
                      id="propertyTaxRecoveryMonthly"
                      type="number"
                      step="0.01"
                      value={propertyTaxRecoveryMonthly}
                      onChange={(e) =>
                        setPropertyTaxRecoveryMonthly(e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="utilitiesRecoveryMonthly">
                      Utilities Recovery (Monthly)
                    </Label>
                    <Input
                      id="utilitiesRecoveryMonthly"
                      type="number"
                      step="0.01"
                      value={utilitiesRecoveryMonthly}
                      onChange={(e) =>
                        setUtilitiesRecoveryMonthly(e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="otherRecoveryMonthly">
                      Other Recovery (Monthly)
                    </Label>
                    <Input
                      id="otherRecoveryMonthly"
                      type="number"
                      step="0.01"
                      value={otherRecoveryMonthly}
                      onChange={(e) => setOtherRecoveryMonthly(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otherRecoveryDescription">
                      Other Recovery Description
                    </Label>
                    <Input
                      id="otherRecoveryDescription"
                      placeholder="Describe the other recovery"
                      value={otherRecoveryDescription}
                      onChange={(e) =>
                        setOtherRecoveryDescription(e.target.value)
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Lease Structure */}
            <Card>
              <CardHeader>
                <CardTitle>Lease Structure</CardTitle>
                <CardDescription>
                  Maintenance type, permitted use, and additional notes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maintenanceType">Maintenance Type</Label>
                    <Select
                      value={maintenanceType}
                      onValueChange={(v) =>
                        setMaintenanceType(v as MaintenanceType)
                      }
                    >
                      <SelectTrigger id="maintenanceType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gross">Gross</SelectItem>
                        <SelectItem value="modified_gross">
                          Modified Gross
                        </SelectItem>
                        <SelectItem value="triple_net">
                          Triple Net (NNN)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="permittedUse">Permitted Use</Label>
                    <Input
                      id="permittedUse"
                      placeholder="e.g., General office use"
                      value={permittedUse}
                      onChange={(e) => setPermittedUse(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Additional notes about this sublease..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={creating} size="lg">
            <Save className="mr-2 h-4 w-4" />
            {creating ? "Creating..." : "Create Sublease"}
          </Button>
        </div>
      </form>
    </div>
  );
}
