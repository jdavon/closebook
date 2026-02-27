"use client";

import { useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Upload, RefreshCw, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { generateLeasePaymentSchedule } from "@/lib/utils/lease-payments";
import type { PropertyTaxFrequency } from "@/lib/types/database";

/**
 * Upload a PDF lease and let AI extract all fields. Review and create the lease.
 */
export default function LeaseFromPDFPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [extracting, setExtracting] = useState(false);
  const [creating, setCreating] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [extractedData, setExtractedData] = useState<Record<string, any> | null>(null);
  const [fileName, setFileName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileSize, setFileSize] = useState(0);

  // Editable overrides — user can change extracted values
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [overrides, setOverrides] = useState<Record<string, any>>({});

  function getVal(key: string) {
    if (key in overrides) return overrides[key];
    return extractedData?.[key] ?? null;
  }

  function setVal(key: string, value: unknown) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      e.target.value = "";
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File too large. Maximum 25MB.");
      e.target.value = "";
      return;
    }

    setExtracting(true);
    setExtractedData(null);
    setOverrides({});

    try {
      // 1. Get a signed upload URL from the server (uses admin client, bypasses RLS)
      const timestamp = Date.now();
      const storagePath = `${entityId}/leases/${timestamp}_${file.name}`;
      const urlRes = await fetch("/api/storage/signed-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "lease-documents", path: storagePath }),
      });

      if (!urlRes.ok) {
        const urlData = await urlRes.json().catch(() => ({}));
        toast.error(urlData.error || "Failed to get upload URL");
        setExtracting(false);
        e.target.value = "";
        return;
      }

      const { signedUrl, token } = await urlRes.json();

      // 2. Upload PDF directly to Supabase Storage using the signed URL
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          ...(token ? { "x-upsert": "false" } : {}),
        },
        body: file,
      });

      if (!uploadRes.ok) {
        const uploadText = await uploadRes.text().catch(() => "");
        console.error("Storage upload failed:", uploadRes.status, uploadText);
        toast.error("Failed to upload PDF to storage");
        setExtracting(false);
        e.target.value = "";
        return;
      }

      // 3. Call API with just the storage path (small JSON payload)
      const res = await fetch("/api/leases/abstract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          storagePath,
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          const text = await res.text().catch(() => "");
          console.error("Non-JSON error response:", res.status, text.slice(0, 500));
        }
        toast.error(errorMsg);
        setExtracting(false);
        e.target.value = "";
        return;
      }

      const data = await res.json();
      setExtractedData(data.extracted);
      setFileName(data.file_name);
      setFilePath(data.file_path);
      setFileSize(data.file_size_bytes);
      toast.success("AI extraction complete — review and edit below");
    } catch (err) {
      console.error("Extraction fetch error:", err);
      toast.error(
        err instanceof TypeError
          ? "Network error — check your connection or server logs"
          : `Extraction failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
    setExtracting(false);
    e.target.value = "";
  }

  async function handleCreateLease() {
    if (!extractedData) return;
    setCreating(true);

    try {
      // 1. Create or find property
      const { data: property, error: propError } = await supabase
        .from("properties")
        .insert({
          entity_id: entityId,
          property_name: getVal("property_name") || getVal("lease_name") || "Unnamed Property",
          address_line1: getVal("address_line1"),
          address_line2: getVal("address_line2"),
          city: getVal("city"),
          state: getVal("state"),
          zip_code: getVal("zip_code"),
          property_type: getVal("property_type") || "office",
          total_square_footage: getVal("total_square_footage"),
          rentable_square_footage: getVal("rentable_square_footage"),
          usable_square_footage: getVal("usable_square_footage"),
        })
        .select("id")
        .single();

      if (propError) {
        toast.error(`Failed to create property: ${propError.message}`);
        setCreating(false);
        return;
      }

      // 2. Create lease
      const { data: lease, error: leaseError } = await supabase
        .from("leases")
        .insert({
          entity_id: entityId,
          property_id: property.id,
          lease_name: getVal("lease_name") || "Untitled Lease",
          lessor_name: getVal("lessor_name"),
          lessor_contact_info: getVal("lessor_contact_info"),
          lease_type: getVal("lease_type") || "operating",
          status: "active",
          commencement_date: getVal("commencement_date"),
          rent_commencement_date: getVal("rent_commencement_date"),
          expiration_date: getVal("expiration_date"),
          lease_term_months: getVal("lease_term_months") || 12,
          base_rent_monthly: getVal("base_rent_monthly") || 0,
          rent_per_sf: getVal("rent_per_sf"),
          security_deposit: getVal("security_deposit") || 0,
          tenant_improvement_allowance: getVal("tenant_improvement_allowance") || 0,
          rent_abatement_months: getVal("rent_abatement_months") || 0,
          rent_abatement_amount: getVal("rent_abatement_amount") || 0,
          discount_rate: getVal("discount_rate") || 0,
          initial_direct_costs: getVal("initial_direct_costs") || 0,
          lease_incentives_received: 0,
          prepaid_rent: 0,
          cam_monthly: getVal("cam_monthly") || 0,
          insurance_monthly: getVal("insurance_monthly") || 0,
          property_tax_annual: getVal("property_tax_annual") || 0,
          property_tax_frequency: getVal("property_tax_frequency") || "monthly",
          utilities_monthly: getVal("utilities_monthly") || 0,
          other_monthly_costs: getVal("other_monthly_costs") || 0,
          other_monthly_costs_description: getVal("other_monthly_costs_description"),
          maintenance_type: getVal("maintenance_type") || "gross",
          permitted_use: getVal("permitted_use"),
          notes: getVal("notes"),
        })
        .select("id")
        .single();

      if (leaseError) {
        toast.error(`Failed to create lease: ${leaseError.message}`);
        setCreating(false);
        return;
      }

      // 3. Insert escalations
      const escalations = extractedData.escalations || [];
      for (const esc of escalations) {
        if (esc.effective_date) {
          await supabase.from("lease_escalations").insert({
            lease_id: lease.id,
            escalation_type: esc.escalation_type || "fixed_percentage",
            effective_date: esc.effective_date,
            percentage_increase: esc.percentage_increase,
            amount_increase: esc.amount_increase,
            frequency: esc.frequency || "annual",
          });
        }
      }

      // 4. Insert options
      const options = extractedData.options || [];
      for (const opt of options) {
        await supabase.from("lease_options").insert({
          lease_id: lease.id,
          option_type: opt.option_type || "renewal",
          exercise_deadline: opt.exercise_deadline,
          notice_required_days: opt.notice_required_days,
          option_term_months: opt.option_term_months,
          option_rent_terms: opt.option_rent_terms,
          option_price: opt.option_price,
          penalty_amount: opt.penalty_amount,
          is_reasonably_certain: false,
        });
      }

      // 5. Insert critical dates
      const criticalDates = extractedData.critical_dates || [];
      for (const cd of criticalDates) {
        if (cd.critical_date) {
          await supabase.from("lease_critical_dates").insert({
            lease_id: lease.id,
            date_type: cd.date_type || "custom",
            critical_date: cd.critical_date,
            description: cd.description,
            alert_days_before: 90,
          });
        }
      }

      // 6. Generate payment schedule
      if (getVal("commencement_date") && getVal("expiration_date")) {
        const schedule = generateLeasePaymentSchedule(
          {
            commencement_date: getVal("commencement_date"),
            rent_commencement_date: getVal("rent_commencement_date"),
            expiration_date: getVal("expiration_date"),
            base_rent_monthly: getVal("base_rent_monthly") || 0,
            cam_monthly: getVal("cam_monthly") || 0,
            insurance_monthly: getVal("insurance_monthly") || 0,
            property_tax_annual: getVal("property_tax_annual") || 0,
            property_tax_frequency: (getVal("property_tax_frequency") || "monthly") as PropertyTaxFrequency,
            utilities_monthly: getVal("utilities_monthly") || 0,
            other_monthly_costs: getVal("other_monthly_costs") || 0,
            rent_abatement_months: getVal("rent_abatement_months") || 0,
            rent_abatement_amount: getVal("rent_abatement_amount") || 0,
          },
          escalations.map((esc: Record<string, unknown>) => ({
            escalation_type: (esc.escalation_type as string) || "fixed_percentage",
            effective_date: esc.effective_date as string,
            percentage_increase: esc.percentage_increase as number | null,
            amount_increase: esc.amount_increase as number | null,
            frequency: (esc.frequency as string) || "annual",
          }))
        );

        if (schedule.length > 0) {
          const rows = schedule.map((entry) => ({
            lease_id: lease.id,
            period_year: entry.period_year,
            period_month: entry.period_month,
            payment_type: entry.payment_type,
            scheduled_amount: entry.scheduled_amount,
          }));
          for (let i = 0; i < rows.length; i += 500) {
            await supabase.from("lease_payments").insert(rows.slice(i, i + 500));
          }
        }
      }

      // 7. Save the uploaded document record
      if (filePath) {
        await supabase.from("lease_documents").insert({
          lease_id: lease.id,
          document_type: "original_lease",
          file_name: fileName,
          file_path: filePath,
          file_size_bytes: fileSize,
        });
      }

      toast.success("Lease created from PDF");
      router.push(`/${entityId}/real-estate/${lease.id}`);
    } catch (err) {
      toast.error("Failed to create lease");
    }
    setCreating(false);
  }

  // Field groups for the review form
  const fieldGroups = [
    {
      title: "Lease Identification",
      fields: [
        { key: "lease_name", label: "Lease Name", type: "text" },
        { key: "lessor_name", label: "Lessor Name", type: "text" },
        { key: "lease_type", label: "Lease Type", type: "text" },
        { key: "maintenance_type", label: "Maintenance Type", type: "text" },
      ],
    },
    {
      title: "Property",
      fields: [
        { key: "property_name", label: "Property Name", type: "text" },
        { key: "address_line1", label: "Address", type: "text" },
        { key: "city", label: "City", type: "text" },
        { key: "state", label: "State", type: "text" },
        { key: "zip_code", label: "Zip", type: "text" },
        { key: "property_type", label: "Property Type", type: "text" },
        { key: "rentable_square_footage", label: "Rentable SF", type: "number" },
      ],
    },
    {
      title: "Dates & Term",
      fields: [
        { key: "commencement_date", label: "Commencement", type: "date" },
        { key: "rent_commencement_date", label: "Rent Commencement", type: "date" },
        { key: "expiration_date", label: "Expiration", type: "date" },
        { key: "lease_term_months", label: "Term (months)", type: "number" },
      ],
    },
    {
      title: "Financial Terms",
      fields: [
        { key: "base_rent_monthly", label: "Base Rent (monthly)", type: "number" },
        { key: "rent_per_sf", label: "Rent per SF", type: "number" },
        { key: "security_deposit", label: "Security Deposit", type: "number" },
        { key: "tenant_improvement_allowance", label: "TI Allowance", type: "number" },
        { key: "rent_abatement_months", label: "Abatement Months", type: "number" },
        { key: "discount_rate", label: "Discount Rate (IBR)", type: "number" },
      ],
    },
    {
      title: "Operating Costs",
      fields: [
        { key: "cam_monthly", label: "CAM (monthly)", type: "number" },
        { key: "insurance_monthly", label: "Insurance (monthly)", type: "number" },
        { key: "property_tax_annual", label: "Property Tax (annual)", type: "number" },
        { key: "utilities_monthly", label: "Utilities (monthly)", type: "number" },
        { key: "other_monthly_costs", label: "Other (monthly)", type: "number" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/real-estate`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Create Lease from PDF
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a lease agreement PDF and let AI extract the key terms.
          Review and edit before creating.
        </p>
      </div>

      {/* Upload section */}
      {!extractedData && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Lease Document</CardTitle>
            <CardDescription>
              Select a PDF lease agreement. AI will extract all relevant fields
              for your review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <label htmlFor="pdf-upload" className="cursor-pointer">
                <Button
                  size="lg"
                  asChild
                  disabled={extracting}
                  className="cursor-pointer"
                >
                  <span>
                    {extracting ? (
                      <>
                        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                        Analyzing lease...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-5 w-5" />
                        Upload PDF
                      </>
                    )}
                  </span>
                </Button>
              </label>
              <input
                id="pdf-upload"
                type="file"
                className="hidden"
                accept=".pdf"
                onChange={handleUpload}
                disabled={extracting}
              />
              {extracting && (
                <p className="text-sm text-muted-foreground">
                  This may take 15-30 seconds...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review section */}
      {extractedData && (
        <>
          {extractedData.confidence_notes && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50/50 p-4">
              <p className="text-sm text-yellow-800">
                <strong>AI Notes:</strong> {extractedData.confidence_notes}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review Extracted Data</h2>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleCreateLease}
                disabled={creating}
              >
                {creating ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Create Lease
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setExtractedData(null);
                  setOverrides({});
                }}
              >
                <X className="mr-2 h-4 w-4" />
                Start Over
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {fieldGroups.map((group) => (
              <Card key={group.title}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{group.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-xs">{field.label}</Label>
                      <Input
                        type={field.type}
                        step={field.type === "number" ? "0.01" : undefined}
                        value={getVal(field.key) ?? ""}
                        onChange={(e) =>
                          setVal(
                            field.key,
                            field.type === "number"
                              ? e.target.value === ""
                                ? null
                                : parseFloat(e.target.value)
                              : e.target.value || null
                          )
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Extracted arrays */}
          {extractedData.escalations?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Escalations ({extractedData.escalations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Increase</TableHead>
                      <TableHead>Frequency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extractedData.escalations.map(
                      (esc: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="capitalize">
                            {String(esc.escalation_type || "").replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>{esc.effective_date as string}</TableCell>
                          <TableCell className="tabular-nums">
                            {esc.percentage_increase != null
                              ? `${((esc.percentage_increase as number) * 100).toFixed(1)}%`
                              : esc.amount_increase != null
                              ? formatCurrency(esc.amount_increase as number)
                              : "CPI"}
                          </TableCell>
                          <TableCell className="capitalize">
                            {String(esc.frequency || "annual").replace(/_/g, " ")}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {extractedData.options?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Options ({extractedData.options.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Notice</TableHead>
                      <TableHead>Term</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extractedData.options.map(
                      (opt: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="capitalize">
                            {String(opt.option_type || "").replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>
                            {(opt.exercise_deadline as string) || "—"}
                          </TableCell>
                          <TableCell>
                            {opt.notice_required_days
                              ? `${opt.notice_required_days} days`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {opt.option_term_months
                              ? `${opt.option_term_months} mo`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {extractedData.critical_dates?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Critical Dates ({extractedData.critical_dates.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extractedData.critical_dates.map(
                      (cd: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="capitalize">
                            {String(cd.date_type || "").replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>{cd.critical_date as string}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {(cd.description as string) || "—"}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Bottom action bar */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setExtractedData(null);
                setOverrides({});
              }}
            >
              Start Over
            </Button>
            <Button
              onClick={handleCreateLease}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Lease"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
