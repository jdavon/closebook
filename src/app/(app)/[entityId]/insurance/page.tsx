"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  formatPolicyType,
  getPolicyTypeColor,
} from "@/lib/utils/insurance-calculations";
import {
  Shield,
  Plus,
  Upload,
  Loader2,
  Settings,
  FileText,
  DollarSign,
  Calendar,
  AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsurancePolicy {
  id: string;
  policy_type: string;
  line_of_business: string | null;
  named_insured: string | null;
  named_insured_entity: string | null;
  status: string;
  effective_date: string | null;
  expiration_date: string | null;
  annual_premium: number;
  prior_year_premium: number;
  premium_change_pct: number;
  payment_terms: string;
  installment_description: string | null;
  billing_company: string | null;
  deposit_held: number;
  is_auditable: boolean;
  coverage_territory: string | null;
  policy_number: string | null;
  carrier_id: string | null;
  broker_id: string | null;
  notes: string | null;
  renewal_notes: string | null;
  insurance_carriers: { name: string } | null;
  insurance_brokers: { name: string } | null;
}

interface Carrier {
  id: string;
  name: string;
}

interface Broker {
  id: string;
  name: string;
}

interface DashboardData {
  policies: InsurancePolicy[];
  carriers: Carrier[];
  brokers: Broker[];
  summary: {
    total_due: number;
    total_paid: number;
    remaining: number;
    claims_count: number;
    subjectivities_count: number;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ExtractedData {
  program_summary: {
    named_insured: string | null;
    broker_name: string | null;
    broker_license: string | null;
    effective_date: string | null;
    expiration_date: string | null;
    total_annual_premium: number | null;
    prior_year_premium: number | null;
    premium_change_pct: number | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  policies: Record<string, any>[];
  confidence_notes: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLICY_TYPES = [
  { value: "auto_liability", label: "Auto Liability" },
  { value: "auto_physical_damage", label: "Auto Physical Damage" },
  { value: "general_liability", label: "General Liability" },
  { value: "property", label: "Property" },
  { value: "excess_liability", label: "Excess Liability" },
  { value: "pollution", label: "Pollution" },
  { value: "management_liability", label: "Management Liability" },
  { value: "workers_comp", label: "Workers' Comp" },
  { value: "umbrella", label: "Umbrella" },
  { value: "inland_marine", label: "Inland Marine" },
  { value: "cyber", label: "Cyber" },
  { value: "epli", label: "EPLI" },
  { value: "crime", label: "Crime" },
  { value: "fiduciary", label: "Fiduciary" },
  { value: "side_a_dic", label: "Side A DIC" },
  { value: "renters_liability", label: "Renters Liability" },
  { value: "garagekeepers", label: "Garagekeepers" },
  { value: "hired_non_owned_auto", label: "Hired & Non-Owned Auto" },
  { value: "package", label: "Package" },
  { value: "other", label: "Other" },
];

const PAYMENT_TERMS = [
  { value: "annual", label: "Annual" },
  { value: "monthly_reporting", label: "Monthly Reporting" },
  { value: "installment", label: "Installment" },
  { value: "daily_rate", label: "Daily Rate" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
  { value: "non_renewed", label: "Non-Renewed" },
  { value: "pending_renewal", label: "Pending Renewal" },
  { value: "draft", label: "Draft" },
];

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-red-100 text-red-800",
  cancelled: "bg-red-100 text-red-800",
  non_renewed: "bg-orange-100 text-orange-800",
  pending_renewal: "bg-yellow-100 text-yellow-800",
  draft: "bg-gray-100 text-gray-800",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InsuranceDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;

  // Dashboard data
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [summary, setSummary] = useState({
    total_due: 0,
    total_paid: 0,
    remaining: 0,
    claims_count: 0,
    subjectivities_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Import from PDF dialog
  const [importOpen, setImportOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(
    null,
  );
  const [extractFileName, setExtractFileName] = useState("");

  // Add Policy dialog
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formPolicyType, setFormPolicyType] = useState("other");
  const [formLineOfBusiness, setFormLineOfBusiness] = useState("");
  const [formCarrierId, setFormCarrierId] = useState("");
  const [formNamedInsured, setFormNamedInsured] = useState("");
  const [formEffectiveDate, setFormEffectiveDate] = useState("");
  const [formExpirationDate, setFormExpirationDate] = useState("");
  const [formAnnualPremium, setFormAnnualPremium] = useState("");
  const [formPaymentTerms, setFormPaymentTerms] = useState("annual");
  const [formStatus, setFormStatus] = useState("active");

  // ─── Data Loading ─────────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_dashboard", entityId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to load (${res.status})`);
      }
      const data: DashboardData = await res.json();
      setPolicies(data.policies || []);
      setCarriers(data.carriers || []);
      setBrokers(data.brokers || []);
      setSummary(
        data.summary || {
          total_due: 0,
          total_paid: 0,
          remaining: 0,
          claims_count: 0,
          subjectivities_count: 0,
        },
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load dashboard";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ─── Summary Calculations ─────────────────────────────────────────────────

  const activePolicies = policies.filter((p) => p.status === "active");
  const totalAnnualPremium = activePolicies.reduce(
    (sum, p) => sum + (p.annual_premium || 0),
    0,
  );
  const totalPriorYearPremium = activePolicies.reduce(
    (sum, p) => sum + (p.prior_year_premium || 0),
    0,
  );
  const yoyChangePct =
    totalPriorYearPremium > 0
      ? ((totalAnnualPremium - totalPriorYearPremium) / totalPriorYearPremium) *
        100
      : 0;

  const now = new Date();
  const in90Days = new Date(now);
  in90Days.setDate(in90Days.getDate() + 90);

  const upcomingRenewals = activePolicies.filter((p) => {
    if (!p.expiration_date) return false;
    const exp = new Date(p.expiration_date + "T00:00:00");
    return exp >= now && exp <= in90Days;
  }).length;

  // ─── Import from PDF ──────────────────────────────────────────────────────

  function openImportDialog() {
    setImportOpen(true);
    setExtractedData(null);
    setExtractFileName("");
    setExtracting(false);
    setImporting(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      e.target.value = "";
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File too large. Maximum 25 MB.");
      e.target.value = "";
      return;
    }

    setExtracting(true);
    setExtractedData(null);
    setExtractFileName(file.name);

    try {
      // 1. Get a signed upload URL from the server
      const timestamp = Date.now();
      const storagePath = `${entityId}/insurance/${timestamp}_${file.name}`;
      const urlRes = await fetch("/api/storage/signed-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: "insurance-documents",
          path: storagePath,
        }),
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

      // 3. Call AI extraction API with storage path
      const extractRes = await fetch("/api/insurance/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          storagePath,
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      if (!extractRes.ok) {
        const extractErr = await extractRes.json().catch(() => ({}));
        toast.error(extractErr.error || "AI extraction failed");
        setExtracting(false);
        e.target.value = "";
        return;
      }

      const result = await extractRes.json();
      setExtractedData(result.extracted);
      toast.success("PDF extracted successfully");
    } catch (err) {
      console.error("Import error:", err);
      toast.error("Failed to process PDF");
    } finally {
      setExtracting(false);
      e.target.value = "";
    }
  }

  async function handleImportAll() {
    if (!extractedData) return;

    setImporting(true);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_extracted",
          entityId,
          extracted: extractedData,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(
          `Imported ${data.imported_count} ${data.imported_count === 1 ? "policy" : "policies"}`,
        );
        if (data.errors?.length > 0) {
          toast.warning(`${data.errors.length} error(s) during import`);
        }
        setImportOpen(false);
        setExtractedData(null);
        loadDashboard();
      } else {
        toast.error(data.error || "Import failed");
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  }

  // ─── Add Policy ───────────────────────────────────────────────────────────

  function openAddDialog() {
    setAddOpen(true);
    setFormPolicyType("other");
    setFormLineOfBusiness("");
    setFormCarrierId("");
    setFormNamedInsured("");
    setFormEffectiveDate("");
    setFormExpirationDate("");
    setFormAnnualPremium("");
    setFormPaymentTerms("annual");
    setFormStatus("active");
    setSaving(false);
  }

  async function handleSavePolicy() {
    if (!formPolicyType) {
      toast.error("Policy type is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_policy",
          entityId,
          policy: {
            policy_type: formPolicyType,
            line_of_business: formLineOfBusiness || null,
            carrier_id: formCarrierId || null,
            named_insured: formNamedInsured || null,
            effective_date: formEffectiveDate || null,
            expiration_date: formExpirationDate || null,
            annual_premium: parseFloat(formAnnualPremium) || 0,
            payment_terms: formPaymentTerms,
            status: formStatus,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Policy created");
        setAddOpen(false);
        loadDashboard();
        // Navigate to the new policy detail page
        if (data.policyId) {
          router.push(`/${entityId}/insurance/${data.policyId}`);
        }
      } else {
        toast.error(data.error || "Failed to save policy");
      }
    } catch {
      toast.error("Failed to save policy");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => { setLoading(true); loadDashboard(); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Insurance</h1>
            <p className="text-muted-foreground">
              Manage policies, premiums, and renewals
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/${entityId}/insurance/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={openImportDialog}>
            <Upload className="mr-2 h-4 w-4" />
            Import from PDF
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Policy
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Total Annual Premium
            </CardDescription>
            <CardTitle className="text-3xl">{fmt(totalAnnualPremium)}</CardTitle>
          </CardHeader>
          <CardContent>
            {totalPriorYearPremium > 0 && (
              <Badge
                variant="outline"
                className={
                  yoyChangePct > 0
                    ? "bg-red-50 text-red-700 border-red-200"
                    : yoyChangePct < 0
                      ? "bg-green-50 text-green-700 border-green-200"
                      : ""
                }
              >
                {yoyChangePct > 0 ? "+" : ""}
                {yoyChangePct.toFixed(1)}% YoY
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Active Policies
            </CardDescription>
            <CardTitle className="text-3xl">{activePolicies.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {policies.length} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Upcoming Renewals
            </CardDescription>
            <CardTitle className="text-3xl">{upcomingRenewals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Within 90 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Payment Status
            </CardDescription>
            <CardTitle className="text-3xl">
              {fmt(summary.total_paid)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              of {fmt(summary.total_due)} due &mdash;{" "}
              {fmt(summary.remaining)} remaining
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Policy List Table */}
      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
          <CardDescription>
            Click a row to view policy details, coverages, and documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="mx-auto h-10 w-10 mb-3 opacity-40" />
              <p>No insurance policies yet.</p>
              <p className="text-sm mt-1">
                Import from a PDF proposal or add a policy manually to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy Type</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Named Insured</TableHead>
                  <TableHead>Policy Period</TableHead>
                  <TableHead className="text-right">Annual Premium</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/${entityId}/insurance/${p.id}`)
                    }
                  >
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant="outline"
                          className={getPolicyTypeColor(p.policy_type)}
                        >
                          {formatPolicyType(p.policy_type)}
                        </Badge>
                        {p.line_of_business && (
                          <span className="text-xs text-muted-foreground">
                            {p.line_of_business}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.insurance_carriers?.name || (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.named_insured || (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(p.effective_date)} &rarr;{" "}
                      {formatDate(p.expiration_date)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(p.annual_premium)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusColors[p.status] || "bg-gray-100 text-gray-800"}
                      >
                        {formatStatusLabel(p.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Import from PDF Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import from PDF
            </DialogTitle>
            <DialogDescription>
              Upload an insurance proposal or renewal PDF. AI will extract policy
              details, coverages, and payment schedules automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* File Upload Input */}
            <div className="space-y-2">
              <Label htmlFor="pdf-upload">Insurance Proposal PDF</Label>
              <Input
                id="pdf-upload"
                type="file"
                accept=".pdf"
                disabled={extracting}
                onChange={handleFileUpload}
              />
              <p className="text-xs text-muted-foreground">
                Maximum file size: 25 MB. Supports insurance proposals,
                renewals, and binders.
              </p>
            </div>

            {/* Extracting State */}
            {extracting && (
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-medium">Extracting data from PDF...</p>
                  <p className="text-sm text-muted-foreground">
                    {extractFileName}. This may take up to 60 seconds.
                  </p>
                </div>
              </div>
            )}

            {/* Extracted Data Preview */}
            {extractedData && (
              <div className="space-y-4">
                {/* Program Summary */}
                {extractedData.program_summary && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        Program Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            Named Insured:{" "}
                          </span>
                          <span className="font-medium">
                            {extractedData.program_summary.named_insured ||
                              "\u2014"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Broker:{" "}
                          </span>
                          <span className="font-medium">
                            {extractedData.program_summary.broker_name ||
                              "\u2014"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Effective:{" "}
                          </span>
                          <span className="font-medium">
                            {formatDate(
                              extractedData.program_summary.effective_date,
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Expiration:{" "}
                          </span>
                          <span className="font-medium">
                            {formatDate(
                              extractedData.program_summary.expiration_date,
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Total Premium:{" "}
                          </span>
                          <span className="font-medium">
                            {extractedData.program_summary
                              .total_annual_premium != null
                              ? fmt(
                                  extractedData.program_summary
                                    .total_annual_premium,
                                )
                              : "\u2014"}
                          </span>
                        </div>
                        {extractedData.program_summary.premium_change_pct !=
                          null && (
                          <div>
                            <span className="text-muted-foreground">
                              Change:{" "}
                            </span>
                            <span className="font-medium">
                              {extractedData.program_summary
                                .premium_change_pct > 0
                                ? "+"
                                : ""}
                              {extractedData.program_summary.premium_change_pct.toFixed(
                                1,
                              )}
                              %
                            </span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Extracted Policies List */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Extracted Policies ({extractedData.policies?.length || 0})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {extractedData.policies?.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Policy Type</TableHead>
                            <TableHead>Line of Business</TableHead>
                            <TableHead>Carrier</TableHead>
                            <TableHead className="text-right">
                              Premium
                            </TableHead>
                            <TableHead className="text-right">
                              Coverages
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractedData.policies.map(
                            (
                              ep: Record<string, unknown>,
                              idx: number,
                            ) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={getPolicyTypeColor(
                                      (ep.policy_type as string) || "other",
                                    )}
                                  >
                                    {formatPolicyType(
                                      (ep.policy_type as string) || "other",
                                    )}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {(ep.line_of_business as string) || "\u2014"}
                                </TableCell>
                                <TableCell>
                                  {(ep.carrier_name as string) || "\u2014"}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {ep.annual_premium != null
                                    ? fmt(ep.annual_premium as number)
                                    : "\u2014"}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {Array.isArray(ep.coverages)
                                    ? ep.coverages.length
                                    : 0}
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No policies were extracted from the document.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Confidence Notes */}
                {extractedData.confidence_notes && (
                  <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p className="text-muted-foreground">
                      {extractedData.confidence_notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            {extractedData && (extractedData.policies?.length || 0) > 0 && (
              <Button onClick={handleImportAll} disabled={importing}>
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Import {extractedData.policies.length}{" "}
                {extractedData.policies.length === 1 ? "Policy" : "Policies"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Policy Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Policy</DialogTitle>
            <DialogDescription>
              Manually create a new insurance policy. You can add coverages and
              details on the policy page after saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Policy Type</Label>
              <Select value={formPolicyType} onValueChange={setFormPolicyType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {pt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Line of Business</Label>
              <Input
                placeholder="e.g. Commercial Auto Fleet"
                value={formLineOfBusiness}
                onChange={(e) => setFormLineOfBusiness(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Carrier</Label>
              <Select value={formCarrierId} onValueChange={setFormCarrierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select carrier..." />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {carriers.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No carriers yet. Add them in Settings.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Named Insured</Label>
              <Input
                placeholder="Primary named insured"
                value={formNamedInsured}
                onChange={(e) => setFormNamedInsured(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={formEffectiveDate}
                  onChange={(e) => setFormEffectiveDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Expiration Date</Label>
                <Input
                  type="date"
                  value={formExpirationDate}
                  onChange={(e) => setFormExpirationDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Annual Premium</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formAnnualPremium}
                onChange={(e) => setFormAnnualPremium(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Select
                  value={formPaymentTerms}
                  onValueChange={setFormPaymentTerms}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((pt) => (
                      <SelectItem key={pt.value} value={pt.value}>
                        {pt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePolicy} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
