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
import { toast } from "sonner";
import { ArrowLeft, Upload, RefreshCw, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import { generateSubleasePaymentSchedule } from "@/lib/utils/sublease-payments";

/**
 * Upload a PDF sublease agreement and let AI extract all fields.
 * Review and edit before creating the sublease.
 */
export default function SubleaseFromPDFPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const leaseId = params.leaseId as string;
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
      const storagePath = `${entityId}/subleases/${timestamp}_${file.name}`;
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
      const res = await fetch("/api/subleases/abstract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          leaseId,
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

  async function handleCreateSublease() {
    if (!extractedData) return;
    setCreating(true);

    try {
      // 1. Insert sublease
      const { data: sublease, error: subleaseError } = await supabase
        .from("subleases")
        .insert({
          lease_id: leaseId,
          entity_id: entityId,
          sublease_name: getVal("sublease_name") || "Untitled Sublease",
          subtenant_name: getVal("subtenant_name") || "Unknown Subtenant",
          subtenant_contact_info: getVal("subtenant_contact_info"),
          status: "active",
          commencement_date: getVal("commencement_date"),
          rent_commencement_date: getVal("rent_commencement_date"),
          expiration_date: getVal("expiration_date"),
          sublease_term_months: getVal("sublease_term_months") || 12,
          subleased_square_footage: getVal("subleased_square_footage"),
          floor_suite: getVal("floor_suite"),
          base_rent_monthly: getVal("base_rent_monthly") || 0,
          rent_per_sf: getVal("rent_per_sf"),
          security_deposit_held: getVal("security_deposit_held") || 0,
          rent_abatement_months: getVal("rent_abatement_months") || 0,
          rent_abatement_amount: getVal("rent_abatement_amount") || 0,
          cam_recovery_monthly: getVal("cam_recovery_monthly") || 0,
          insurance_recovery_monthly: getVal("insurance_recovery_monthly") || 0,
          property_tax_recovery_monthly: getVal("property_tax_recovery_monthly") || 0,
          utilities_recovery_monthly: getVal("utilities_recovery_monthly") || 0,
          other_recovery_monthly: getVal("other_recovery_monthly") || 0,
          other_recovery_description: getVal("other_recovery_description"),
          maintenance_type: getVal("maintenance_type") || "gross",
          permitted_use: getVal("permitted_use"),
          notes: getVal("notes"),
        })
        .select("id")
        .single();

      if (subleaseError) {
        toast.error(`Failed to create sublease: ${subleaseError.message}`);
        setCreating(false);
        return;
      }

      // 2. Insert escalations
      const escalations = extractedData.escalations || [];
      for (const esc of escalations) {
        if (esc.effective_date) {
          await supabase.from("sublease_escalations").insert({
            sublease_id: sublease.id,
            escalation_type: esc.escalation_type || "fixed_percentage",
            effective_date: esc.effective_date,
            percentage_increase: esc.percentage_increase,
            amount_increase: esc.amount_increase,
            frequency: esc.frequency || "annual",
          });
        }
      }

      // 3. Insert options
      const options = extractedData.options || [];
      for (const opt of options) {
        await supabase.from("sublease_options").insert({
          sublease_id: sublease.id,
          option_type: opt.option_type || "renewal",
          exercise_deadline: opt.exercise_deadline,
          notice_required_days: opt.notice_required_days,
          option_term_months: opt.option_term_months,
          option_rent_terms: opt.option_rent_terms,
          option_price: opt.option_price,
          penalty_amount: opt.penalty_amount,
          is_exercised: false,
        });
      }

      // 4. Insert critical dates
      const criticalDates = extractedData.critical_dates || [];
      for (const cd of criticalDates) {
        if (cd.critical_date) {
          await supabase.from("sublease_critical_dates").insert({
            sublease_id: sublease.id,
            date_type: cd.date_type || "custom",
            critical_date: cd.critical_date,
            description: cd.description,
            alert_days_before: 90,
          });
        }
      }

      // 5. Generate payment schedule
      if (getVal("commencement_date") && getVal("expiration_date")) {
        const schedule = generateSubleasePaymentSchedule(
          {
            commencement_date: getVal("commencement_date"),
            rent_commencement_date: getVal("rent_commencement_date"),
            expiration_date: getVal("expiration_date"),
            base_rent_monthly: getVal("base_rent_monthly") || 0,
            cam_recovery_monthly: getVal("cam_recovery_monthly") || 0,
            insurance_recovery_monthly: getVal("insurance_recovery_monthly") || 0,
            property_tax_recovery_monthly: getVal("property_tax_recovery_monthly") || 0,
            utilities_recovery_monthly: getVal("utilities_recovery_monthly") || 0,
            other_recovery_monthly: getVal("other_recovery_monthly") || 0,
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
            sublease_id: sublease.id,
            period_year: entry.period_year,
            period_month: entry.period_month,
            payment_type: entry.payment_type,
            scheduled_amount: entry.scheduled_amount,
          }));
          for (let i = 0; i < rows.length; i += 500) {
            await supabase.from("sublease_payments").insert(rows.slice(i, i + 500));
          }
        }
      }

      // 6. Save the uploaded document record
      if (filePath) {
        await supabase.from("sublease_documents").insert({
          sublease_id: sublease.id,
          document_type: "sublease_agreement",
          file_name: fileName,
          file_path: filePath,
          file_size_bytes: fileSize,
        });
      }

      toast.success("Sublease created from PDF");
      router.push(`/${entityId}/real-estate/${leaseId}?tab=subleases`);
    } catch {
      toast.error("Failed to create sublease");
    }
    setCreating(false);
  }

  // Field groups for the review form
  const fieldGroups = [
    {
      title: "Sublease Identification",
      fields: [
        { key: "sublease_name", label: "Sublease Name", type: "text" },
        { key: "subtenant_name", label: "Subtenant Name", type: "text" },
        { key: "subtenant_contact_info", label: "Subtenant Contact", type: "text" },
        { key: "maintenance_type", label: "Maintenance Type", type: "text" },
      ],
    },
    {
      title: "Space",
      fields: [
        { key: "subleased_square_footage", label: "Subleased SF", type: "number" },
        { key: "floor_suite", label: "Floor / Suite", type: "text" },
      ],
    },
    {
      title: "Dates & Term",
      fields: [
        { key: "commencement_date", label: "Commencement", type: "date" },
        { key: "rent_commencement_date", label: "Rent Commencement", type: "date" },
        { key: "expiration_date", label: "Expiration", type: "date" },
        { key: "sublease_term_months", label: "Term (months)", type: "number" },
      ],
    },
    {
      title: "Income Terms",
      fields: [
        { key: "base_rent_monthly", label: "Base Rent (monthly)", type: "number" },
        { key: "rent_per_sf", label: "Rent per SF (annual)", type: "number" },
        { key: "security_deposit_held", label: "Security Deposit Held", type: "number" },
        { key: "rent_abatement_months", label: "Abatement Months", type: "number" },
        { key: "rent_abatement_amount", label: "Abatement Amount", type: "number" },
      ],
    },
    {
      title: "Operating Cost Recoveries",
      fields: [
        { key: "cam_recovery_monthly", label: "CAM Recovery (monthly)", type: "number" },
        { key: "insurance_recovery_monthly", label: "Insurance Recovery (monthly)", type: "number" },
        { key: "property_tax_recovery_monthly", label: "Property Tax Recovery (monthly)", type: "number" },
        { key: "utilities_recovery_monthly", label: "Utilities Recovery (monthly)", type: "number" },
        { key: "other_recovery_monthly", label: "Other Recovery (monthly)", type: "number" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/real-estate/${leaseId}?tab=subleases`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Create Sublease from PDF
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a sublease agreement PDF and let AI extract the key terms.
          Review and edit before creating.
        </p>
      </div>

      {/* Upload section */}
      {!extractedData && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Sublease Document</CardTitle>
            <CardDescription>
              Select a PDF sublease agreement. AI will extract all relevant fields
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
                        Analyzing sublease...
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
                onClick={handleCreateSublease}
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
                    Create Sublease
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
                            {(opt.exercise_deadline as string) || "\u2014"}
                          </TableCell>
                          <TableCell>
                            {opt.notice_required_days
                              ? `${opt.notice_required_days} days`
                              : "\u2014"}
                          </TableCell>
                          <TableCell>
                            {opt.option_term_months
                              ? `${opt.option_term_months} mo`
                              : "\u2014"}
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
                            {(cd.description as string) || "\u2014"}
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
              onClick={handleCreateSublease}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Sublease"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
