"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  formatPolicyType,
  getPolicyTypeColor,
} from "@/lib/utils/insurance-calculations";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PolicyData {
  id: string;
  policy_number: string | null;
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
  notes: string | null;
  renewal_notes: string | null;
  insurance_carriers: { name: string } | null;
  insurance_brokers: { name: string } | null;
}

interface Coverage {
  id: string;
  coverage_name: string;
  coverage_form: string | null;
  limit_per_occurrence: number | null;
  limit_aggregate: number | null;
  limit_description: string | null;
  deductible: number | null;
  deductible_description: string | null;
  self_insured_retention: number | null;
  coinsurance_pct: number | null;
  sub_limit: number | null;
  sub_limit_description: string | null;
  is_included: boolean;
  prior_year_limit: number | null;
  prior_year_deductible: number | null;
  notes: string | null;
}

interface Payment {
  id: string;
  period_month: number;
  period_year: number;
  due_date: string | null;
  amount_due: number;
  amount_paid: number | null;
  payment_status: string;
  is_estimate: boolean;
}

interface Location {
  id: string;
  location_code: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  occupancy_description: string | null;
  building_value: number;
  bpp_value: number;
  business_income_value: number;
  rental_income_value: number;
}

interface Exposure {
  id: string;
  exposure_type: string;
  exposure_value: number | null;
  rate: number | null;
  calculated_premium: number | null;
  is_reported: boolean;
  period_month: number | null;
  period_year: number | null;
  notes: string | null;
}

interface Allocation {
  id: string;
  target_entity_id: string;
  target_entity_name: string | null;
  allocation_method: string | null;
  allocation_pct: number;
  allocated_amount: number | null;
  gl_account_number: string | null;
}

interface Exclusion {
  id: string;
  exclusion_name: string;
  is_excluded: boolean;
  exception_description: string | null;
}

interface Subjectivity {
  id: string;
  description: string;
  due_date: string | null;
  status: string;
  completed_date: string | null;
}

interface Claim {
  id: string;
  claim_number: string | null;
  date_of_loss: string | null;
  claimant_name: string | null;
  status: string;
  reserved_amount: number | null;
  paid_amount: number | null;
  recovered_amount: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-red-100 text-red-800",
  cancelled: "bg-red-100 text-red-800",
  non_renewed: "bg-orange-100 text-orange-800",
  pending_renewal: "bg-yellow-100 text-yellow-800",
  draft: "bg-gray-100 text-gray-800",
};

const paymentStatusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  scheduled: "bg-blue-100 text-blue-800",
  overdue: "bg-red-100 text-red-800",
  partial: "bg-yellow-100 text-yellow-800",
};

const subjectivityStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  waived: "bg-gray-100 text-gray-800",
  overdue: "bg-red-100 text-red-800",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function InsurancePolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const policyId = params.policyId as string;

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [coverages, setCoverages] = useState<Coverage[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [exposures, setExposures] = useState<Exposure[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [subjectivities, setSubjectivities] = useState<Subjectivity[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [activeTab, setActiveTab] = useState("coverages");

  const tabs = [
    { id: "coverages", label: "Coverages", count: coverages.length },
    { id: "payments", label: "Payments", count: payments.length },
    { id: "locations", label: "Locations", count: locations.length },
    { id: "exposures", label: "Exposures", count: exposures.length },
    { id: "allocations", label: "Allocations", count: allocations.length },
    { id: "exclusions", label: "Exclusions", count: exclusions.length },
    { id: "subjectivities", label: "Subjectivities", count: subjectivities.length },
    { id: "claims", label: "Claims", count: claims.length },
  ];

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_policy", policyId }),
      });
      if (!res.ok) {
        toast.error("Failed to load policy");
        return;
      }
      const data = await res.json();
      setPolicy(data.policy);
      setCoverages(data.coverages || []);
      setPayments(data.payments || []);
      setLocations(data.locations || []);
      setExposures(data.exposures || []);
      setAllocations(data.allocations || []);
      setExclusions(data.exclusions || []);
      setSubjectivities(data.subjectivities || []);
      setClaims(data.claims || []);
    } catch {
      toast.error("Failed to load policy");
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeletePolicy = async () => {
    if (!confirm("Are you sure you want to delete this policy? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_policy", policyId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete policy");
        return;
      }
      toast.success("Policy deleted");
      router.push(`/${entityId}/insurance`);
    } catch {
      toast.error("Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  // ─── Loading / Not Found ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="p-6 space-y-4">
        <Link href={`/${entityId}/insurance`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Insurance
          </Button>
        </Link>
        <p className="text-muted-foreground">Policy not found.</p>
      </div>
    );
  }

  // ─── Derived Values ─────────────────────────────────────────────────────

  const policyDisplayName = policy.line_of_business || formatPolicyType(policy.policy_type);
  const carrierName = policy.insurance_carriers?.name || "Unknown Carrier";
  const totalDue = payments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
  const totalBalance = totalDue - totalPaid;
  const totalAllocationPct = allocations.reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);

  // ─── Tab Content Renderers ──────────────────────────────────────────────

  function renderCoverages() {
    if (coverages.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No coverages recorded for this policy.
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Coverage Name</TableHead>
            <TableHead>Form</TableHead>
            <TableHead className="text-right">Limit / Occurrence</TableHead>
            <TableHead className="text-right">Limit / Aggregate</TableHead>
            <TableHead className="text-right">Deductible</TableHead>
            <TableHead className="text-right">SIR</TableHead>
            <TableHead className="text-center">Included</TableHead>
            <TableHead className="text-right">Prior Year Limit</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {coverages.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.coverage_name}</TableCell>
              <TableCell>
                {c.coverage_form ? (
                  <Badge variant="outline" className="text-xs capitalize">
                    {c.coverage_form.replace("_", " ")}
                  </Badge>
                ) : (
                  "\u2014"
                )}
              </TableCell>
              <TableCell className="text-right">
                {c.limit_description || fmt(c.limit_per_occurrence)}
              </TableCell>
              <TableCell className="text-right">{fmt(c.limit_aggregate)}</TableCell>
              <TableCell className="text-right">
                {c.deductible_description || fmt(c.deductible)}
              </TableCell>
              <TableCell className="text-right">{fmt(c.self_insured_retention)}</TableCell>
              <TableCell className="text-center">
                {c.is_included ? (
                  <CheckCircle className="h-4 w-4 text-green-600 inline" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 inline" />
                )}
              </TableCell>
              <TableCell className="text-right">{fmt(c.prior_year_limit)}</TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                {c.notes || "\u2014"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function renderPayments() {
    if (payments.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No payment schedule recorded for this policy.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month / Year</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Amount Due</TableHead>
              <TableHead className="text-right">Amount Paid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => {
              const due = Number(p.amount_due) || 0;
              const paid = Number(p.amount_paid) || 0;
              const bal = due - paid;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {MONTH_NAMES[p.period_month]} {p.period_year}
                  </TableCell>
                  <TableCell>{fmtDate(p.due_date)}</TableCell>
                  <TableCell className="text-right">{fmt(due)}</TableCell>
                  <TableCell className="text-right">{fmt(paid)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs",
                        paymentStatusColors[p.payment_status] || "bg-gray-100 text-gray-800"
                      )}
                    >
                      {p.payment_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{fmt(bal)}</TableCell>
                </TableRow>
              );
            })}
            {/* Summary row */}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right">{fmt(totalDue)}</TableCell>
              <TableCell className="text-right">{fmt(totalPaid)}</TableCell>
              <TableCell />
              <TableCell className="text-right">{fmt(totalBalance)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderLocations() {
    if (locations.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No locations recorded for this policy.
        </div>
      );
    }

    const totals = locations.reduce(
      (acc, l) => ({
        building: acc.building + (Number(l.building_value) || 0),
        bpp: acc.bpp + (Number(l.bpp_value) || 0),
        bi: acc.bi + (Number(l.business_income_value) || 0),
        tiv:
          acc.tiv +
          (Number(l.building_value) || 0) +
          (Number(l.bpp_value) || 0) +
          (Number(l.business_income_value) || 0) +
          (Number(l.rental_income_value) || 0),
      }),
      { building: 0, bpp: 0, bi: 0, tiv: 0 }
    );

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>City / State</TableHead>
            <TableHead>Occupancy</TableHead>
            <TableHead className="text-right">Building Value</TableHead>
            <TableHead className="text-right">BPP Value</TableHead>
            <TableHead className="text-right">BI Value</TableHead>
            <TableHead className="text-right">TIV</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.map((l) => {
            const tiv =
              (Number(l.building_value) || 0) +
              (Number(l.bpp_value) || 0) +
              (Number(l.business_income_value) || 0) +
              (Number(l.rental_income_value) || 0);
            return (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-sm">
                  {l.location_code || "\u2014"}
                </TableCell>
                <TableCell className="font-medium">{l.address}</TableCell>
                <TableCell>
                  {[l.city, l.state].filter(Boolean).join(", ") || "\u2014"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                  {l.occupancy_description || "\u2014"}
                </TableCell>
                <TableCell className="text-right">{fmt(l.building_value)}</TableCell>
                <TableCell className="text-right">{fmt(l.bpp_value)}</TableCell>
                <TableCell className="text-right">{fmt(l.business_income_value)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(tiv)}</TableCell>
              </TableRow>
            );
          })}
          {/* Sum row */}
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right">{fmt(totals.building)}</TableCell>
            <TableCell className="text-right">{fmt(totals.bpp)}</TableCell>
            <TableCell className="text-right">{fmt(totals.bi)}</TableCell>
            <TableCell className="text-right">{fmt(totals.tiv)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  function renderExposures() {
    if (exposures.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No exposure data recorded for this policy.
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Calculated Premium</TableHead>
            <TableHead className="text-center">Reported</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exposures.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-medium capitalize">
                {e.exposure_type.replace(/_/g, " ")}
              </TableCell>
              <TableCell className="text-right">
                {e.exposure_value != null
                  ? new Intl.NumberFormat("en-US").format(e.exposure_value)
                  : "\u2014"}
              </TableCell>
              <TableCell className="text-right">
                {e.rate != null ? e.rate.toFixed(4) : "\u2014"}
              </TableCell>
              <TableCell className="text-right">{fmt(e.calculated_premium)}</TableCell>
              <TableCell className="text-center">
                {e.is_reported ? (
                  <CheckCircle className="h-4 w-4 text-green-600 inline" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground inline" />
                )}
              </TableCell>
              <TableCell>
                {e.period_month && e.period_year
                  ? `${MONTH_NAMES[e.period_month]} ${e.period_year}`
                  : "\u2014"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                {e.notes || "\u2014"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function renderAllocations() {
    if (allocations.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No entity allocations configured for this policy.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>GL Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  {a.target_entity_name || a.target_entity_id}
                </TableCell>
                <TableCell className="capitalize">
                  {a.allocation_method?.replace(/_/g, " ") || "\u2014"}
                </TableCell>
                <TableCell className="text-right">
                  {Number(a.allocation_pct).toFixed(2)}%
                </TableCell>
                <TableCell className="text-right">{fmt(a.allocated_amount)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {a.gl_account_number || "\u2014"}
                </TableCell>
              </TableRow>
            ))}
            {/* Total row */}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right">
                <span
                  className={cn(
                    Math.abs(totalAllocationPct - 100) > 0.01 && "text-red-600"
                  )}
                >
                  {totalAllocationPct.toFixed(2)}%
                </span>
              </TableCell>
              <TableCell className="text-right">
                {fmt(
                  allocations.reduce(
                    (s, a) => s + (Number(a.allocated_amount) || 0),
                    0
                  )
                )}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
        {Math.abs(totalAllocationPct - 100) > 0.01 && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" />
            Allocation percentages do not sum to 100% (currently {totalAllocationPct.toFixed(2)}%)
          </div>
        )}
      </div>
    );
  }

  function renderExclusions() {
    if (exclusions.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No exclusions recorded for this policy.
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Exclusion Name</TableHead>
            <TableHead className="text-center">Excluded</TableHead>
            <TableHead>Exception Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exclusions.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-medium">{e.exclusion_name}</TableCell>
              <TableCell className="text-center">
                {e.is_excluded ? (
                  <XCircle className="h-4 w-4 text-red-500 inline" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-600 inline" />
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {e.exception_description || "\u2014"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function renderSubjectivities() {
    if (subjectivities.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No subjectivities recorded for this policy.
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Completed Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subjectivities.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.description}</TableCell>
              <TableCell>{fmtDate(s.due_date)}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    subjectivityStatusColors[s.status] || "bg-gray-100 text-gray-800"
                  )}
                >
                  {s.status === "pending" && <Clock className="mr-1 h-3 w-3 inline" />}
                  {s.status === "completed" && <CheckCircle className="mr-1 h-3 w-3 inline" />}
                  {s.status === "overdue" && <AlertCircle className="mr-1 h-3 w-3 inline" />}
                  {s.status}
                </Badge>
              </TableCell>
              <TableCell>{fmtDate(s.completed_date)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function renderClaims() {
    if (claims.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No claims recorded for this policy.
        </div>
      );
    }

    const totals = claims.reduce(
      (acc, c) => ({
        reserved: acc.reserved + (Number(c.reserved_amount) || 0),
        paid: acc.paid + (Number(c.paid_amount) || 0),
        recovered: acc.recovered + (Number(c.recovered_amount) || 0),
      }),
      { reserved: 0, paid: 0, recovered: 0 }
    );
    const totalNetIncurred = totals.reserved + totals.paid - totals.recovered;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim #</TableHead>
            <TableHead>Date of Loss</TableHead>
            <TableHead>Claimant</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Reserved</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Recovered</TableHead>
            <TableHead className="text-right">Net Incurred</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((c) => {
            const netIncurred =
              (Number(c.reserved_amount) || 0) +
              (Number(c.paid_amount) || 0) -
              (Number(c.recovered_amount) || 0);
            return (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-sm">
                  {c.claim_number || "\u2014"}
                </TableCell>
                <TableCell>{fmtDate(c.date_of_loss)}</TableCell>
                <TableCell className="font-medium">{c.claimant_name || "\u2014"}</TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      c.status === "open" && "bg-red-100 text-red-800",
                      c.status === "closed" && "bg-green-100 text-green-800",
                      c.status === "pending" && "bg-yellow-100 text-yellow-800"
                    )}
                  >
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{fmt(c.reserved_amount)}</TableCell>
                <TableCell className="text-right">{fmt(c.paid_amount)}</TableCell>
                <TableCell className="text-right">{fmt(c.recovered_amount)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(netIncurred)}</TableCell>
              </TableRow>
            );
          })}
          {/* Total row */}
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right">{fmt(totals.reserved)}</TableCell>
            <TableCell className="text-right">{fmt(totals.paid)}</TableCell>
            <TableCell className="text-right">{fmt(totals.recovered)}</TableCell>
            <TableCell className="text-right">{fmt(totalNetIncurred)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  const tabContent: Record<string, () => React.ReactNode> = {
    coverages: renderCoverages,
    payments: renderPayments,
    locations: renderLocations,
    exposures: renderExposures,
    allocations: renderAllocations,
    exclusions: renderExclusions,
    subjectivities: renderSubjectivities,
    claims: renderClaims,
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/${entityId}/insurance`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{policyDisplayName}</h1>
              <Badge
                variant="secondary"
                className={cn("text-xs", getPolicyTypeColor(policy.policy_type))}
              >
                {formatPolicyType(policy.policy_type)}
              </Badge>
              <Badge variant="outline">{carrierName}</Badge>
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs",
                  statusColors[policy.status] || "bg-gray-100 text-gray-800"
                )}
              >
                {policy.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              {policy.policy_number && (
                <span>Policy # {policy.policy_number}</span>
              )}
              <span>
                {fmtDate(policy.effective_date)} &ndash; {fmtDate(policy.expiration_date)}
              </span>
              <span className="font-medium text-foreground">
                Premium: {fmt(policy.annual_premium)}
              </span>
              {policy.prior_year_premium > 0 && (
                <span>
                  Prior: {fmt(policy.prior_year_premium)}{" "}
                  <span
                    className={cn(
                      policy.premium_change_pct > 0 && "text-red-600",
                      policy.premium_change_pct < 0 && "text-green-600"
                    )}
                  >
                    ({policy.premium_change_pct > 0 ? "+" : ""}
                    {policy.premium_change_pct.toFixed(1)}%)
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={handleDeletePolicy}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {/* Policy Details Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Policy Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Named Insured</span>
              <p className="font-medium">{policy.named_insured || "\u2014"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Broker</span>
              <p className="font-medium">{policy.insurance_brokers?.name || "\u2014"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Payment Terms</span>
              <p className="font-medium capitalize">
                {policy.payment_terms.replace(/_/g, " ")}
                {policy.installment_description && (
                  <span className="text-muted-foreground ml-1">
                    ({policy.installment_description})
                  </span>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Billing Company</span>
              <p className="font-medium">{policy.billing_company || "\u2014"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Auditable</span>
              <p className="font-medium">{policy.is_auditable ? "Yes" : "No"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Deposit Held</span>
              <p className="font-medium">{fmt(policy.deposit_held)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Coverage Territory</span>
              <p className="font-medium">{policy.coverage_territory || "\u2014"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Named Insured Entity</span>
              <p className="font-medium">{policy.named_insured_entity || "\u2014"}</p>
            </div>
          </div>
          {policy.notes && (
            <div className="mt-4 pt-4 border-t">
              <span className="text-sm text-muted-foreground">Notes</span>
              <p className="text-sm mt-1 whitespace-pre-wrap">{policy.notes}</p>
            </div>
          )}
          {policy.renewal_notes && (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Renewal Notes</span>
              <p className="text-sm mt-1 whitespace-pre-wrap">{policy.renewal_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-1 border-b mb-4 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({tab.count})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="min-h-[200px]">{tabContent[activeTab]?.()}</div>
        </CardContent>
      </Card>
    </div>
  );
}
