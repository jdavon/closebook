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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Plus,
  RefreshCw,
  Upload,
  Calendar,
  Check,
  ChevronsUpDown,
  FileText,
  Users,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import { generateLeasePaymentSchedule } from "@/lib/utils/lease-payments";
import {
  generateASC842Schedule,
  generateInitialJournalEntries,
  generateMonthlyJournalEntry,
} from "@/lib/utils/lease-calculations";
import type {
  ASC842ScheduleEntry,
  ASC842Summary,
  ASC842JournalEntry,
  LeaseClassification,
  LeaseAccountMapping,
} from "@/lib/utils/lease-calculations";
import type {
  LeaseStatus,
  LeaseType,
  MaintenanceType,
  PropertyTaxFrequency,
  PaymentType,
  EscalationType,
  EscalationFrequency,
  OptionType,
  CriticalDateType,
  LeaseDocumentType,
  SubleaseStatus,
} from "@/lib/types/database";

// --- Interfaces ---

interface LeaseData {
  id: string;
  entity_id: string;
  property_id: string;
  lease_name: string;
  lessor_name: string | null;
  lessor_contact_info: string | null;
  lease_type: LeaseType;
  status: LeaseStatus;
  commencement_date: string;
  rent_commencement_date: string | null;
  expiration_date: string;
  lease_term_months: number;
  base_rent_monthly: number;
  base_rent_annual: number;
  rent_per_sf: number | null;
  security_deposit: number;
  tenant_improvement_allowance: number;
  rent_abatement_months: number;
  rent_abatement_amount: number;
  discount_rate: number;
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  fair_value_of_asset: number | null;
  remaining_economic_life_months: number | null;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  property_tax_frequency: PropertyTaxFrequency;
  utilities_monthly: number;
  other_monthly_costs: number;
  other_monthly_costs_description: string | null;
  maintenance_type: MaintenanceType;
  permitted_use: string | null;
  notes: string | null;
  rou_asset_account_id: string | null;
  lease_liability_account_id: string | null;
  lease_expense_account_id: string | null;
  interest_expense_account_id: string | null;
  cam_expense_account_id: string | null;
  asc842_adjustment_account_id: string | null;
  cash_ap_account_id: string | null;
  properties: {
    property_name: string;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    rentable_square_footage: number | null;
  } | null;
}

interface PaymentRow {
  id: string;
  period_year: number;
  period_month: number;
  payment_type: PaymentType;
  scheduled_amount: number;
  actual_amount: number | null;
  is_paid: boolean;
  payment_date: string | null;
}

interface EscalationRow {
  id: string;
  escalation_type: EscalationType;
  effective_date: string;
  percentage_increase: number | null;
  amount_increase: number | null;
  cpi_index_name: string | null;
  cpi_cap: number | null;
  cpi_floor: number | null;
  frequency: EscalationFrequency;
  notes: string | null;
}

interface OptionRow {
  id: string;
  option_type: OptionType;
  exercise_deadline: string | null;
  notice_required_days: number | null;
  option_term_months: number | null;
  option_rent_terms: string | null;
  option_price: number | null;
  penalty_amount: number | null;
  is_reasonably_certain: boolean;
  is_exercised: boolean;
  exercised_date: string | null;
  notes: string | null;
}

interface CriticalDateRow {
  id: string;
  date_type: CriticalDateType;
  critical_date: string;
  alert_days_before: number;
  description: string | null;
  is_resolved: boolean;
  resolved_date: string | null;
  notes: string | null;
}

interface DocumentRow {
  id: string;
  document_type: LeaseDocumentType;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
}

interface AmendmentRow {
  id: string;
  amendment_number: number;
  effective_date: string;
  description: string | null;
  changed_fields: Record<string, unknown> | null;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

interface SubleaseListItem {
  id: string;
  sublease_name: string;
  subtenant_name: string;
  status: SubleaseStatus;
  commencement_date: string;
  expiration_date: string;
  sublease_term_months: number;
  base_rent_monthly: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
  subleased_square_footage: number | null;
  floor_suite: string | null;
}

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

// --- Constants ---

const STATUS_LABELS: Record<LeaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

const STATUS_VARIANTS: Record<
  LeaseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  expired: "secondary",
  terminated: "destructive",
};

const TYPE_LABELS: Record<LeaseType, string> = {
  operating: "Operating",
  finance: "Finance",
};

const MAINTENANCE_LABELS: Record<MaintenanceType, string> = {
  triple_net: "Triple Net (NNN)",
  gross: "Gross",
  modified_gross: "Modified Gross",
};

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  base_rent: "Base Rent",
  cam: "CAM",
  property_tax: "Property Tax",
  insurance: "Insurance",
  utilities: "Utilities",
  other: "Other",
};

const OPTION_TYPE_LABELS: Record<OptionType, string> = {
  renewal: "Renewal",
  termination: "Termination",
  purchase: "Purchase",
  expansion: "Expansion",
};

const DATE_TYPE_LABELS: Record<CriticalDateType, string> = {
  lease_expiration: "Lease Expiration",
  renewal_deadline: "Renewal Deadline",
  termination_notice: "Termination Notice",
  rent_escalation: "Rent Escalation",
  rent_review: "Rent Review",
  cam_reconciliation: "CAM Reconciliation",
  insurance_renewal: "Insurance Renewal",
  custom: "Custom",
};

const DOC_TYPE_LABELS: Record<LeaseDocumentType, string> = {
  original_lease: "Original Lease",
  amendment: "Amendment",
  addendum: "Addendum",
  correspondence: "Correspondence",
  insurance_cert: "Insurance Certificate",
  other: "Other",
};

const SUBLEASE_STATUS_LABELS: Record<SubleaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

const SUBLEASE_STATUS_VARIANTS: Record<
  SubleaseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  expired: "secondary",
  terminated: "destructive",
};

function subleaseMonthlyIncome(s: SubleaseListItem): number {
  return (
    s.base_rent_monthly +
    s.cam_recovery_monthly +
    s.insurance_recovery_monthly +
    s.property_tax_recovery_monthly +
    s.utilities_recovery_monthly +
    s.other_recovery_monthly
  );
}

// --- Component ---

export default function LeaseDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const leaseId = params.leaseId as string;
  const router = useRouter();
  const supabase = createClient();

  const current = getCurrentPeriod();

  // Core data
  const [lease, setLease] = useState<LeaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Tab data
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [criticalDates, setCriticalDates] = useState<CriticalDateRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [amendments, setAmendments] = useState<AmendmentRow[]>([]);
  const [subleases, setSubleases] = useState<SubleaseListItem[]>([]);

  // Payment period selector
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);

  // GL account editing
  const [rouAssetAccountId, setRouAssetAccountId] = useState("");
  const [leaseLiabilityAccountId, setLeaseLiabilityAccountId] = useState("");
  const [leaseExpenseAccountId, setLeaseExpenseAccountId] = useState("");
  const [interestExpenseAccountId, setInterestExpenseAccountId] = useState("");
  const [camExpenseAccountId, setCamExpenseAccountId] = useState("");
  const [asc842AdjustmentAccountId, setAsc842AdjustmentAccountId] = useState("");
  const [cashApAccountId, setCashApAccountId] = useState("");

  // GL account combobox open states
  const [glPopoverOpen, setGlPopoverOpen] = useState<Record<string, boolean>>({});

  // Sheet states
  const [escalationSheetOpen, setEscalationSheetOpen] = useState(false);
  const [optionSheetOpen, setOptionSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  // New escalation form
  const [newEscType, setNewEscType] = useState<EscalationType>("fixed_percentage");
  const [newEscDate, setNewEscDate] = useState("");
  const [newEscPercent, setNewEscPercent] = useState("");
  const [newEscAmount, setNewEscAmount] = useState("");
  const [newEscFrequency, setNewEscFrequency] = useState<EscalationFrequency>("annual");

  // New option form
  const [newOptType, setNewOptType] = useState<OptionType>("renewal");
  const [newOptDeadline, setNewOptDeadline] = useState("");
  const [newOptNoticeDays, setNewOptNoticeDays] = useState("");
  const [newOptTermMonths, setNewOptTermMonths] = useState("");
  const [newOptRentTerms, setNewOptRentTerms] = useState("");
  const [newOptPrice, setNewOptPrice] = useState("");
  const [newOptPenalty, setNewOptPenalty] = useState("");
  const [newOptReasonablyCertain, setNewOptReasonablyCertain] = useState(false);

  // New critical date form
  const [newDateType, setNewDateType] = useState<CriticalDateType>("lease_expiration");
  const [newDateDate, setNewDateDate] = useState("");
  const [newDateAlertDays, setNewDateAlertDays] = useState("90");
  const [newDateDescription, setNewDateDescription] = useState("");

  // ASC 842 tab state
  const [asc842ShowJournalEntries, setAsc842ShowJournalEntries] = useState(false);
  const [discountRateInput, setDiscountRateInput] = useState("");
  const [savingDiscountRate, setSavingDiscountRate] = useState(false);

  // Document upload & AI extraction state
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [extracting, setExtracting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [extractedData, setExtractedData] = useState<Record<string, any> | null>(null);

  const years = Array.from({ length: 10 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const loadData = useCallback(async () => {
    // Fetch each query separately to avoid TS "excessively deep" type error with Promise.all + Supabase
    const leaseResult = await supabase
      .from("leases")
      .select(
        `id, entity_id, property_id, lease_name, lessor_name, lessor_contact_info,
        lease_type, status, commencement_date, rent_commencement_date, expiration_date,
        lease_term_months, base_rent_monthly, base_rent_annual, rent_per_sf,
        security_deposit, tenant_improvement_allowance, rent_abatement_months,
        rent_abatement_amount, discount_rate, initial_direct_costs, lease_incentives_received,
        prepaid_rent, fair_value_of_asset, remaining_economic_life_months,
        cam_monthly, insurance_monthly, property_tax_annual, property_tax_frequency,
        utilities_monthly, other_monthly_costs, other_monthly_costs_description,
        maintenance_type, permitted_use, notes,
        rou_asset_account_id, lease_liability_account_id, lease_expense_account_id,
        interest_expense_account_id, cam_expense_account_id,
        asc842_adjustment_account_id, cash_ap_account_id,
        properties(property_name, address_line1, city, state, rentable_square_footage)`
      )
      .eq("id", leaseId)
      .single();

    const paymentsResult = await supabase
      .from("lease_payments")
      .select("*")
      .eq("lease_id", leaseId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .order("payment_type");

    const escalationsResult = await supabase
      .from("lease_escalations")
      .select("*")
      .eq("lease_id", leaseId)
      .order("effective_date");

    const optionsResult = await supabase
      .from("lease_options")
      .select("*")
      .eq("lease_id", leaseId)
      .order("exercise_deadline");

    const criticalDatesResult = await supabase
      .from("lease_critical_dates")
      .select("*")
      .eq("lease_id", leaseId)
      .order("critical_date");

    const documentsResult = await supabase
      .from("lease_documents")
      .select("*")
      .eq("lease_id", leaseId)
      .order("created_at", { ascending: false });

    const amendmentsResult = await supabase
      .from("lease_amendments")
      .select("*")
      .eq("lease_id", leaseId)
      .order("amendment_number");

    const accountsResult = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    const subleasesResult = await supabase
      .from("subleases")
      .select(
        `id, sublease_name, subtenant_name, status,
        commencement_date, expiration_date, sublease_term_months,
        base_rent_monthly, cam_recovery_monthly, insurance_recovery_monthly,
        property_tax_recovery_monthly, utilities_recovery_monthly, other_recovery_monthly,
        subleased_square_footage, floor_suite`
      )
      .eq("lease_id", leaseId)
      .order("sublease_name");

    if (leaseResult.data) {
      const l = leaseResult.data as unknown as LeaseData;
      setLease(l);
      setRouAssetAccountId(l.rou_asset_account_id ?? "");
      setLeaseLiabilityAccountId(l.lease_liability_account_id ?? "");
      setLeaseExpenseAccountId(l.lease_expense_account_id ?? "");
      setInterestExpenseAccountId(l.interest_expense_account_id ?? "");
      setCamExpenseAccountId(l.cam_expense_account_id ?? "");
      setAsc842AdjustmentAccountId(l.asc842_adjustment_account_id ?? "");
      setCashApAccountId(l.cash_ap_account_id ?? "");
      setDiscountRateInput(l.discount_rate > 0 ? String(l.discount_rate * 100) : "");
    }

    setPayments((paymentsResult.data as unknown as PaymentRow[]) ?? []);
    setEscalations((escalationsResult.data as unknown as EscalationRow[]) ?? []);
    setOptions((optionsResult.data as unknown as OptionRow[]) ?? []);
    setCriticalDates((criticalDatesResult.data as unknown as CriticalDateRow[]) ?? []);
    setDocuments((documentsResult.data as unknown as DocumentRow[]) ?? []);
    setAmendments((amendmentsResult.data as unknown as AmendmentRow[]) ?? []);
    setSubleases((subleasesResult.data as unknown as SubleaseListItem[]) ?? []);
    setAccounts((accountsResult.data as Account[]) ?? []);
    setLoading(false);
  }, [supabase, leaseId, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Handlers ---

  async function handleSaveAccounts() {
    setSaving(true);
    const { error } = await supabase
      .from("leases")
      .update({
        rou_asset_account_id: rouAssetAccountId || null,
        lease_liability_account_id: leaseLiabilityAccountId || null,
        lease_expense_account_id: leaseExpenseAccountId || null,
        interest_expense_account_id: interestExpenseAccountId || null,
        cam_expense_account_id: camExpenseAccountId || null,
        asc842_adjustment_account_id: asc842AdjustmentAccountId || null,
        cash_ap_account_id: cashApAccountId || null,
      })
      .eq("id", leaseId);

    if (error) toast.error(error.message);
    else toast.success("GL accounts updated");
    setSaving(false);
  }

  async function handleSaveDiscountRate() {
    const pct = parseFloat(discountRateInput);
    if (isNaN(pct) || pct <= 0) {
      toast.error("Enter a valid discount rate (e.g. 5.5 for 5.5%)");
      return;
    }
    setSavingDiscountRate(true);
    const decimalRate = pct / 100;
    const { error } = await supabase
      .from("leases")
      .update({ discount_rate: decimalRate })
      .eq("id", leaseId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Discount rate updated");
      loadData();
    }
    setSavingDiscountRate(false);
  }

  async function handleTogglePaid(paymentId: string, isPaid: boolean) {
    const { error } = await supabase
      .from("lease_payments")
      .update({
        is_paid: isPaid,
        payment_date: isPaid ? new Date().toISOString().split("T")[0] : null,
      })
      .eq("id", paymentId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleRegenerateSchedule() {
    if (!lease) return;
    // Delete existing and regenerate
    await supabase.from("lease_payments").delete().eq("lease_id", leaseId);

    const schedule = generateLeasePaymentSchedule(
      {
        commencement_date: lease.commencement_date,
        rent_commencement_date: lease.rent_commencement_date,
        expiration_date: lease.expiration_date,
        base_rent_monthly: lease.base_rent_monthly,
        cam_monthly: lease.cam_monthly,
        insurance_monthly: lease.insurance_monthly,
        property_tax_annual: lease.property_tax_annual,
        property_tax_frequency: lease.property_tax_frequency,
        utilities_monthly: lease.utilities_monthly,
        other_monthly_costs: lease.other_monthly_costs,
        rent_abatement_months: lease.rent_abatement_months,
        rent_abatement_amount: lease.rent_abatement_amount,
      },
      escalations.map((e) => ({
        escalation_type: e.escalation_type,
        effective_date: e.effective_date,
        percentage_increase: e.percentage_increase,
        amount_increase: e.amount_increase,
        frequency: e.frequency,
      }))
    );

    if (schedule.length > 0) {
      const rows = schedule.map((entry) => ({
        lease_id: leaseId,
        period_year: entry.period_year,
        period_month: entry.period_month,
        payment_type: entry.payment_type,
        scheduled_amount: entry.scheduled_amount,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("lease_payments").insert(rows.slice(i, i + 500));
      }
    }

    toast.success("Payment schedule regenerated");
    loadData();
  }

  async function handleAddEscalation() {
    const { error } = await supabase.from("lease_escalations").insert({
      lease_id: leaseId,
      escalation_type: newEscType,
      effective_date: newEscDate,
      percentage_increase: newEscPercent ? parseFloat(newEscPercent) : null,
      amount_increase: newEscAmount ? parseFloat(newEscAmount) : null,
      frequency: newEscFrequency,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Escalation added");
      setEscalationSheetOpen(false);
      setNewEscDate("");
      setNewEscPercent("");
      setNewEscAmount("");
      loadData();
    }
  }

  async function handleAddOption() {
    const { error } = await supabase.from("lease_options").insert({
      lease_id: leaseId,
      option_type: newOptType,
      exercise_deadline: newOptDeadline || null,
      notice_required_days: newOptNoticeDays ? parseInt(newOptNoticeDays) : null,
      option_term_months: newOptTermMonths ? parseInt(newOptTermMonths) : null,
      option_rent_terms: newOptRentTerms || null,
      option_price: newOptPrice ? parseFloat(newOptPrice) : null,
      penalty_amount: newOptPenalty ? parseFloat(newOptPenalty) : null,
      is_reasonably_certain: newOptReasonablyCertain,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Option added");
      setOptionSheetOpen(false);
      setNewOptDeadline("");
      setNewOptNoticeDays("");
      setNewOptTermMonths("");
      setNewOptRentTerms("");
      setNewOptPrice("");
      setNewOptPenalty("");
      setNewOptReasonablyCertain(false);
      loadData();
    }
  }

  async function handleAddCriticalDate() {
    const { error } = await supabase.from("lease_critical_dates").insert({
      lease_id: leaseId,
      date_type: newDateType,
      critical_date: newDateDate,
      alert_days_before: parseInt(newDateAlertDays) || 90,
      description: newDateDescription || null,
    });

    if (error) toast.error(error.message);
    else {
      toast.success("Critical date added");
      setDateSheetOpen(false);
      setNewDateDate("");
      setNewDateDescription("");
      loadData();
    }
  }

  async function handleResolveCriticalDate(dateId: string) {
    const { error } = await supabase
      .from("lease_critical_dates")
      .update({
        is_resolved: true,
        resolved_date: new Date().toISOString().split("T")[0],
      })
      .eq("id", dateId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteEscalation(id: string) {
    const { error } = await supabase.from("lease_escalations").delete().eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteOption(id: string) {
    const { error } = await supabase.from("lease_options").delete().eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);

    const timestamp = Date.now();
    const storagePath = `${entityId}/leases/${leaseId}/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("lease-documents")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      toast.error(`Upload failed: ${uploadError.message}`);
      setUploadingDoc(false);
      e.target.value = "";
      return;
    }

    const { error: dbError } = await supabase.from("lease_documents").insert({
      lease_id: leaseId,
      document_type: "other" as const,
      file_name: file.name,
      file_path: storagePath,
      file_size_bytes: file.size,
    });

    if (dbError) toast.error(dbError.message);
    else toast.success("Document uploaded");
    setUploadingDoc(false);
    e.target.value = "";
    loadData();
  }

  async function handleAIExtract(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("AI extraction requires a PDF file");
      e.target.value = "";
      return;
    }

    setExtracting(true);
    setExtractedData(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", entityId);

    try {
      const res = await fetch("/api/leases/abstract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Extraction failed");
        setExtracting(false);
        e.target.value = "";
        return;
      }

      setExtractedData(data.extracted);

      // Also save the document record
      if (data.file_path) {
        await supabase.from("lease_documents").insert({
          lease_id: leaseId,
          document_type: "original_lease" as const,
          file_name: data.file_name,
          file_path: data.file_path,
          file_size_bytes: data.file_size_bytes,
        });
        loadData();
      }

      toast.success("AI extraction complete — review the results below");
    } catch (err) {
      toast.error("Network error during extraction");
    }
    setExtracting(false);
    e.target.value = "";
  }

  async function handleApplyExtraction() {
    if (!extractedData || !lease) return;
    setSaving(true);

    // Build update object with only non-null extracted values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      lease_name: "lease_name",
      lessor_name: "lessor_name",
      lessor_contact_info: "lessor_contact_info",
      lease_type: "lease_type",
      commencement_date: "commencement_date",
      rent_commencement_date: "rent_commencement_date",
      expiration_date: "expiration_date",
      lease_term_months: "lease_term_months",
      base_rent_monthly: "base_rent_monthly",
      rent_per_sf: "rent_per_sf",
      security_deposit: "security_deposit",
      tenant_improvement_allowance: "tenant_improvement_allowance",
      rent_abatement_months: "rent_abatement_months",
      rent_abatement_amount: "rent_abatement_amount",
      cam_monthly: "cam_monthly",
      insurance_monthly: "insurance_monthly",
      property_tax_annual: "property_tax_annual",
      property_tax_frequency: "property_tax_frequency",
      utilities_monthly: "utilities_monthly",
      other_monthly_costs: "other_monthly_costs",
      other_monthly_costs_description: "other_monthly_costs_description",
      maintenance_type: "maintenance_type",
      permitted_use: "permitted_use",
      discount_rate: "discount_rate",
      initial_direct_costs: "initial_direct_costs",
      notes: "notes",
    };

    for (const [extKey, dbKey] of Object.entries(fieldMap)) {
      if (extractedData[extKey] != null) {
        update[dbKey] = extractedData[extKey];
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("leases")
        .update(update)
        .eq("id", leaseId);

      if (error) {
        toast.error(`Failed to update lease: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    // Insert extracted escalations
    if (extractedData.escalations?.length > 0) {
      for (const esc of extractedData.escalations) {
        await supabase.from("lease_escalations").insert({
          lease_id: leaseId,
          escalation_type: esc.escalation_type,
          effective_date: esc.effective_date,
          percentage_increase: esc.percentage_increase,
          amount_increase: esc.amount_increase,
          frequency: esc.frequency || "annual",
        });
      }
    }

    // Insert extracted options
    if (extractedData.options?.length > 0) {
      for (const opt of extractedData.options) {
        await supabase.from("lease_options").insert({
          lease_id: leaseId,
          option_type: opt.option_type,
          exercise_deadline: opt.exercise_deadline,
          notice_required_days: opt.notice_required_days,
          option_term_months: opt.option_term_months,
          option_rent_terms: opt.option_rent_terms,
          option_price: opt.option_price,
          penalty_amount: opt.penalty_amount,
          is_reasonably_certain: false,
        });
      }
    }

    // Insert extracted critical dates
    if (extractedData.critical_dates?.length > 0) {
      for (const cd of extractedData.critical_dates) {
        await supabase.from("lease_critical_dates").insert({
          lease_id: leaseId,
          date_type: cd.date_type,
          critical_date: cd.critical_date,
          description: cd.description,
          alert_days_before: 90,
        });
      }
    }

    // Update property if extracted
    if (
      extractedData.property_name ||
      extractedData.address_line1 ||
      extractedData.city
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propUpdate: Record<string, any> = {};
      if (extractedData.property_name) propUpdate.property_name = extractedData.property_name;
      if (extractedData.address_line1) propUpdate.address_line1 = extractedData.address_line1;
      if (extractedData.address_line2) propUpdate.address_line2 = extractedData.address_line2;
      if (extractedData.city) propUpdate.city = extractedData.city;
      if (extractedData.state) propUpdate.state = extractedData.state;
      if (extractedData.zip_code) propUpdate.zip_code = extractedData.zip_code;
      if (extractedData.property_type) propUpdate.property_type = extractedData.property_type;
      if (extractedData.total_square_footage) propUpdate.total_square_footage = extractedData.total_square_footage;
      if (extractedData.rentable_square_footage) propUpdate.rentable_square_footage = extractedData.rentable_square_footage;
      if (extractedData.usable_square_footage) propUpdate.usable_square_footage = extractedData.usable_square_footage;

      if (Object.keys(propUpdate).length > 0) {
        await supabase
          .from("properties")
          .update(propUpdate)
          .eq("id", lease.property_id);
      }
    }

    toast.success("Extracted data applied to lease");
    setExtractedData(null);
    setSaving(false);
    loadData();
  }

  // --- Helpers ---

  const totalMonthly = lease
    ? lease.base_rent_monthly +
      lease.cam_monthly +
      lease.insurance_monthly +
      lease.property_tax_annual / 12 +
      lease.utilities_monthly +
      lease.other_monthly_costs
    : 0;

  const assetAccounts = accounts.filter((a) => a.classification === "Asset");
  const liabilityAccounts = accounts.filter((a) => a.classification === "Liability");
  const expenseAccounts = accounts.filter((a) => a.classification === "Expense");
  const cashApAccounts = accounts.filter(
    (a) => a.classification === "Asset" || a.classification === "Liability"
  );

  // ASC 842 computed schedule
  const asc842Data = (() => {
    if (!lease || lease.discount_rate <= 0 || lease.lease_term_months <= 0) {
      return null;
    }

    // Build variable payment array from actual payment schedule if escalations exist
    // For now, use base rent; when escalations exist, generate the array from the payment schedule
    let monthlyPayments: number[] | undefined;
    if (escalations.length > 0) {
      const paymentSchedule = generateLeasePaymentSchedule(
        {
          commencement_date: lease.commencement_date,
          rent_commencement_date: lease.rent_commencement_date,
          expiration_date: lease.expiration_date,
          base_rent_monthly: lease.base_rent_monthly,
          cam_monthly: 0, // Only base rent for ASC 842 liability
          insurance_monthly: 0,
          property_tax_annual: 0,
          property_tax_frequency: lease.property_tax_frequency,
          utilities_monthly: 0,
          other_monthly_costs: 0,
          rent_abatement_months: lease.rent_abatement_months,
          rent_abatement_amount: lease.rent_abatement_amount,
        },
        escalations.map((e) => ({
          escalation_type: e.escalation_type,
          effective_date: e.effective_date,
          percentage_increase: e.percentage_increase,
          amount_increase: e.amount_increase,
          frequency: e.frequency,
        }))
      );
      // Extract monthly base_rent amounts in order
      const baseRentByPeriod = new Map<string, number>();
      for (const entry of paymentSchedule) {
        if (entry.payment_type === "base_rent") {
          baseRentByPeriod.set(
            `${entry.period_year}-${entry.period_month}`,
            entry.scheduled_amount
          );
        }
      }
      // Build array matching lease term months from commencement
      const start = new Date(lease.commencement_date + "T00:00:00");
      monthlyPayments = [];
      for (let i = 0; i < lease.lease_term_months; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        monthlyPayments.push(baseRentByPeriod.get(key) ?? lease.base_rent_monthly);
      }
    }

    return generateASC842Schedule({
      lease_type: lease.lease_type as LeaseClassification,
      lease_term_months: lease.lease_term_months,
      discount_rate: lease.discount_rate,
      commencement_date: lease.commencement_date,
      initial_direct_costs: lease.initial_direct_costs,
      lease_incentives_received: lease.lease_incentives_received,
      prepaid_rent: lease.prepaid_rent,
      base_rent_monthly: lease.base_rent_monthly,
      monthly_payments: monthlyPayments,
    });
  })();

  const asc842InitialJE = (() => {
    if (!lease || lease.discount_rate <= 0 || lease.lease_term_months <= 0) {
      return [];
    }
    return generateInitialJournalEntries(
      {
        lease_type: lease.lease_type as LeaseClassification,
        lease_term_months: lease.lease_term_months,
        discount_rate: lease.discount_rate,
        commencement_date: lease.commencement_date,
        initial_direct_costs: lease.initial_direct_costs,
        lease_incentives_received: lease.lease_incentives_received,
        prepaid_rent: lease.prepaid_rent,
        base_rent_monthly: lease.base_rent_monthly,
      },
      {
        rouAssetAccountId: lease.rou_asset_account_id ?? undefined,
        leaseLiabilityAccountId: lease.lease_liability_account_id ?? undefined,
        leaseExpenseAccountId: lease.lease_expense_account_id ?? undefined,
        interestExpenseAccountId: lease.interest_expense_account_id ?? undefined,
        asc842AdjustmentAccountId: lease.asc842_adjustment_account_id ?? undefined,
        cashApAccountId: lease.cash_ap_account_id ?? undefined,
      }
    );
  })();

  function renderAccountSelect(
    label: string,
    id: string,
    value: string,
    onChange: (v: string) => void,
    accountList: Account[]
  ) {
    const selected = accountList.find((a) => a.id === value);
    const open = glPopoverOpen[id] ?? false;
    const setOpen = (v: boolean) =>
      setGlPopoverOpen((prev) => ({ ...prev, [id]: v }));
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              {selected
                ? selected.account_number
                  ? `${selected.account_number} - ${selected.name}`
                  : selected.name
                : "Select account..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search accounts..." />
              <CommandList>
                <CommandEmpty>No account found.</CommandEmpty>
                <CommandGroup>
                  {accountList.map((account) => {
                    const display = account.account_number
                      ? `${account.account_number} - ${account.name}`
                      : account.name;
                    return (
                      <CommandItem
                        key={account.id}
                        value={display}
                        onSelect={() => {
                          onChange(account.id === value ? "" : account.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === account.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {display}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  function getCriticalDateUrgency(dateStr: string, isResolved: boolean): string {
    if (isResolved) return "";
    const today = new Date();
    const date = new Date(dateStr + "T00:00:00");
    const daysUntil = Math.ceil(
      (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil < 0) return "text-red-600 font-semibold";
    if (daysUntil <= 30) return "text-red-500";
    if (daysUntil <= 90) return "text-yellow-600";
    return "";
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading lease...</p>
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Lease not found.</p>
      </div>
    );
  }

  const paymentScheduledTotal = payments.reduce(
    (s, p) => s + p.scheduled_amount,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {lease.lease_name}
          </h1>
          <Badge variant={STATUS_VARIANTS[lease.status]}>
            {STATUS_LABELS[lease.status]}
          </Badge>
          <Badge variant="outline">{TYPE_LABELS[lease.lease_type]}</Badge>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="grid grid-cols-6 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Base Rent</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(lease.base_rent_monthly)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Monthly</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(totalMonthly)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lease Term</p>
            <p className="text-lg font-semibold">{lease.lease_term_months} mo</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commencement</p>
            <p className="text-lg font-semibold">
              {new Date(lease.commencement_date + "T00:00:00").toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiration</p>
            <p className="text-lg font-semibold">
              {new Date(lease.expiration_date + "T00:00:00").toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Discount Rate</p>
            <p className="text-lg font-semibold">
              {lease.discount_rate
                ? formatPercentage(lease.discount_rate)
                : "---"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="escalations">Escalations</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="dates">Critical Dates</TabsTrigger>
          <TabsTrigger value="subleases">
            <Users className="mr-1 h-3.5 w-3.5" />
            Subleases
          </TabsTrigger>
          <TabsTrigger value="asc842">ASC 842</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="amendments">Amendments</TabsTrigger>
        </TabsList>

        {/* === Summary Tab === */}
        <TabsContent value="summary">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Property & Lease Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Property</span>
                  <span>{lease.properties?.property_name ?? "---"}</span>
                  <span className="text-muted-foreground">Address</span>
                  <span>
                    {[
                      lease.properties?.address_line1,
                      lease.properties?.city,
                      lease.properties?.state,
                    ]
                      .filter(Boolean)
                      .join(", ") || "---"}
                  </span>
                  <span className="text-muted-foreground">Lessor</span>
                  <span>{lease.lessor_name ?? "---"}</span>
                  <span className="text-muted-foreground">Maintenance</span>
                  <span>{MAINTENANCE_LABELS[lease.maintenance_type]}</span>
                  <span className="text-muted-foreground">Rentable SF</span>
                  <span>
                    {lease.properties?.rentable_square_footage
                      ? lease.properties.rentable_square_footage.toLocaleString()
                      : "---"}
                  </span>
                  <span className="text-muted-foreground">Rent / SF</span>
                  <span>
                    {lease.rent_per_sf
                      ? formatCurrency(lease.rent_per_sf)
                      : "---"}
                  </span>
                  <span className="text-muted-foreground">Security Deposit</span>
                  <span>{formatCurrency(lease.security_deposit)}</span>
                  <span className="text-muted-foreground">TI Allowance</span>
                  <span>
                    {formatCurrency(lease.tenant_improvement_allowance)}
                  </span>
                </div>

                {lease.notes && (
                  <div className="pt-3 border-t">
                    <p className="text-muted-foreground mb-1">Notes</p>
                    <p className="whitespace-pre-wrap">{lease.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>GL Accounts</CardTitle>
                  <Button
                    size="sm"
                    onClick={handleSaveAccounts}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderAccountSelect(
                  "ROU Asset",
                  "rouAsset",
                  rouAssetAccountId,
                  setRouAssetAccountId,
                  assetAccounts
                )}
                {renderAccountSelect(
                  "Lease Liability",
                  "leaseLiability",
                  leaseLiabilityAccountId,
                  setLeaseLiabilityAccountId,
                  liabilityAccounts
                )}
                {renderAccountSelect(
                  "Lease Expense",
                  "leaseExpense",
                  leaseExpenseAccountId,
                  setLeaseExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Interest Expense",
                  "interestExpense",
                  interestExpenseAccountId,
                  setInterestExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "CAM / OpEx",
                  "camExpense",
                  camExpenseAccountId,
                  setCamExpenseAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "ASC 842 Adjustment",
                  "asc842Adjustment",
                  asc842AdjustmentAccountId,
                  setAsc842AdjustmentAccountId,
                  expenseAccounts
                )}
                {renderAccountSelect(
                  "Cash / AP",
                  "cashAp",
                  cashApAccountId,
                  setCashApAccountId,
                  cashApAccounts
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Payments Tab === */}
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Payment Schedule</CardTitle>
                  <CardDescription>
                    {getPeriodLabel(periodYear, periodMonth)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(periodYear)}
                    onValueChange={(v) => setPeriodYear(Number(v))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(periodMonth)}
                    onValueChange={(v) => setPeriodMonth(Number(v))}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {getPeriodLabel(current.year, m).split(" ")[0]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateSchedule}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No payments scheduled for this period.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment Type</TableHead>
                      <TableHead className="text-right">Scheduled</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-center">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {PAYMENT_TYPE_LABELS[p.payment_type]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(p.scheduled_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.actual_amount != null
                            ? formatCurrency(p.actual_amount)
                            : "---"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={p.is_paid}
                            onCheckedChange={(checked) =>
                              handleTogglePaid(p.id, checked === true)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(paymentScheduledTotal)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Escalations Tab === */}
        <TabsContent value="escalations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Rent Escalations</CardTitle>
                <Sheet
                  open={escalationSheetOpen}
                  onOpenChange={setEscalationSheetOpen}
                >
                  <SheetTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Escalation
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add Escalation</SheetTitle>
                      <SheetDescription>
                        Define a rent escalation rule
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={newEscType}
                          onValueChange={(v) =>
                            setNewEscType(v as EscalationType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed_percentage">
                              Fixed Percentage
                            </SelectItem>
                            <SelectItem value="fixed_amount">
                              Fixed Amount
                            </SelectItem>
                            <SelectItem value="cpi">CPI-Linked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Effective Date</Label>
                        <Input
                          type="date"
                          value={newEscDate}
                          onChange={(e) => setNewEscDate(e.target.value)}
                        />
                      </div>
                      {newEscType === "fixed_percentage" && (
                        <div className="space-y-2">
                          <Label>Percentage Increase (decimal)</Label>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="e.g., 0.03 for 3%"
                            value={newEscPercent}
                            onChange={(e) => setNewEscPercent(e.target.value)}
                          />
                        </div>
                      )}
                      {newEscType === "fixed_amount" && (
                        <div className="space-y-2">
                          <Label>Amount Increase</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newEscAmount}
                            onChange={(e) => setNewEscAmount(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Frequency</Label>
                        <Select
                          value={newEscFrequency}
                          onValueChange={(v) =>
                            setNewEscFrequency(v as EscalationFrequency)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="annual">Annual</SelectItem>
                            <SelectItem value="biennial">Biennial</SelectItem>
                            <SelectItem value="at_renewal">At Renewal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleAddEscalation} className="w-full">
                        Add Escalation
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardHeader>
            <CardContent>
              {escalations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No escalation rules defined.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Increase</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {escalations.map((esc) => (
                      <TableRow key={esc.id}>
                        <TableCell className="capitalize">
                          {esc.escalation_type.replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          {new Date(
                            esc.effective_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {esc.percentage_increase != null
                            ? formatPercentage(esc.percentage_increase)
                            : esc.amount_increase != null
                            ? formatCurrency(esc.amount_increase)
                            : "CPI"}
                        </TableCell>
                        <TableCell className="capitalize">
                          {esc.frequency.replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEscalation(esc.id)}
                          >
                            &times;
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Options Tab === */}
        <TabsContent value="options">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Lease Options</CardTitle>
                <Sheet open={optionSheetOpen} onOpenChange={setOptionSheetOpen}>
                  <SheetTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Option
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add Option</SheetTitle>
                      <SheetDescription>
                        Define a lease option (renewal, termination, etc.)
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Option Type</Label>
                        <Select
                          value={newOptType}
                          onValueChange={(v) =>
                            setNewOptType(v as OptionType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="renewal">Renewal</SelectItem>
                            <SelectItem value="termination">
                              Termination
                            </SelectItem>
                            <SelectItem value="purchase">Purchase</SelectItem>
                            <SelectItem value="expansion">Expansion</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Exercise Deadline</Label>
                        <Input
                          type="date"
                          value={newOptDeadline}
                          onChange={(e) => setNewOptDeadline(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Notice (days)</Label>
                          <Input
                            type="number"
                            value={newOptNoticeDays}
                            onChange={(e) =>
                              setNewOptNoticeDays(e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Term (months)</Label>
                          <Input
                            type="number"
                            value={newOptTermMonths}
                            onChange={(e) =>
                              setNewOptTermMonths(e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Rent Terms</Label>
                        <Textarea
                          placeholder="Description of rent during option period"
                          value={newOptRentTerms}
                          onChange={(e) => setNewOptRentTerms(e.target.value)}
                          rows={2}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Price / Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newOptPrice}
                            onChange={(e) => setNewOptPrice(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Penalty</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newOptPenalty}
                            onChange={(e) => setNewOptPenalty(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="reasonablyCertain"
                          checked={newOptReasonablyCertain}
                          onCheckedChange={(c) =>
                            setNewOptReasonablyCertain(c === true)
                          }
                        />
                        <Label htmlFor="reasonablyCertain">
                          Reasonably certain to exercise (ASC 842)
                        </Label>
                      </div>
                      <Button onClick={handleAddOption} className="w-full">
                        Add Option
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardHeader>
            <CardContent>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No lease options defined.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Notice</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Certain</TableHead>
                      <TableHead>Exercised</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {options.map((opt) => (
                      <TableRow key={opt.id}>
                        <TableCell>
                          {OPTION_TYPE_LABELS[opt.option_type]}
                        </TableCell>
                        <TableCell>
                          {opt.exercise_deadline
                            ? new Date(
                                opt.exercise_deadline + "T00:00:00"
                              ).toLocaleDateString()
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.notice_required_days
                            ? `${opt.notice_required_days} days`
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.option_term_months
                            ? `${opt.option_term_months} mo`
                            : "---"}
                        </TableCell>
                        <TableCell>
                          {opt.is_reasonably_certain ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            "---"
                          )}
                        </TableCell>
                        <TableCell>
                          {opt.is_exercised ? (
                            <Badge variant="default">Exercised</Badge>
                          ) : (
                            <Badge variant="outline">Open</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteOption(opt.id)}
                          >
                            &times;
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Critical Dates Tab === */}
        <TabsContent value="dates">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Critical Dates</CardTitle>
                <Sheet open={dateSheetOpen} onOpenChange={setDateSheetOpen}>
                  <SheetTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Date
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Add Critical Date</SheetTitle>
                      <SheetDescription>
                        Track an important lease milestone
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Date Type</Label>
                        <Select
                          value={newDateType}
                          onValueChange={(v) =>
                            setNewDateType(v as CriticalDateType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(DATE_TYPE_LABELS) as [
                                CriticalDateType,
                                string,
                              ][]
                            ).map(([key, label]) => (
                              <SelectItem key={key} value={key}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={newDateDate}
                          onChange={(e) => setNewDateDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Alert Days Before</Label>
                        <Input
                          type="number"
                          value={newDateAlertDays}
                          onChange={(e) => setNewDateAlertDays(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={newDateDescription}
                          onChange={(e) =>
                            setNewDateDescription(e.target.value)
                          }
                          rows={2}
                        />
                      </div>
                      <Button
                        onClick={handleAddCriticalDate}
                        className="w-full"
                      >
                        Add Date
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardHeader>
            <CardContent>
              {criticalDates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No critical dates tracked.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Alert</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criticalDates.map((cd) => (
                      <TableRow key={cd.id}>
                        <TableCell>
                          {DATE_TYPE_LABELS[cd.date_type]}
                        </TableCell>
                        <TableCell
                          className={getCriticalDateUrgency(
                            cd.critical_date,
                            cd.is_resolved
                          )}
                        >
                          {new Date(
                            cd.critical_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {cd.alert_days_before} days
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {cd.description ?? "---"}
                        </TableCell>
                        <TableCell>
                          {cd.is_resolved ? (
                            <Badge variant="secondary">Resolved</Badge>
                          ) : (
                            <Badge variant="outline">Open</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!cd.is_resolved && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleResolveCriticalDate(cd.id)
                              }
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === Subleases Tab === */}
        <TabsContent value="subleases">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Subleases</CardTitle>
                  <CardDescription>
                    Subtenants renting space under this lease — track income, escalations, and critical dates
                  </CardDescription>
                </div>
                <Link href={`/${entityId}/real-estate/${leaseId}/subleases/new`}>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    New Sublease
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {subleases.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-muted-foreground/40" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No subleases yet. Add a sublease to track rental income from subtenants.
                  </p>
                </div>
              ) : (
                <>
                  {/* Sublease income summary */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Active Subleases</p>
                      <p className="text-2xl font-bold">
                        {subleases.filter((s) => s.status === "active").length}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Monthly Income</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(
                          subleases
                            .filter((s) => s.status === "active")
                            .reduce((sum, s) => sum + subleaseMonthlyIncome(s), 0)
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Subleased SF</p>
                      <p className="text-2xl font-bold">
                        {subleases
                          .filter((s) => s.status === "active")
                          .reduce((sum, s) => sum + (s.subleased_square_footage ?? 0), 0)
                          .toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sublease</TableHead>
                        <TableHead>Subtenant</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Space</TableHead>
                        <TableHead className="text-right">Monthly Rent</TableHead>
                        <TableHead className="text-right">Total Monthly</TableHead>
                        <TableHead>Expiration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subleases.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <Link
                              href={`/${entityId}/real-estate/${leaseId}/subleases/${s.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {s.sublease_name}
                            </Link>
                          </TableCell>
                          <TableCell>{s.subtenant_name}</TableCell>
                          <TableCell>
                            <Badge variant={SUBLEASE_STATUS_VARIANTS[s.status]}>
                              {SUBLEASE_STATUS_LABELS[s.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {s.floor_suite ?? "---"}
                            {s.subleased_square_footage
                              ? ` (${s.subleased_square_footage.toLocaleString()} SF)`
                              : ""}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(s.base_rent_monthly)}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {formatCurrency(subleaseMonthlyIncome(s))}
                          </TableCell>
                          <TableCell>
                            {new Date(s.expiration_date + "T00:00:00").toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === ASC 842 Tab === */}
        <TabsContent value="asc842">
          {!asc842Data ? (
            <Card>
              <CardHeader>
                <CardTitle>Set Discount Rate (IBR)</CardTitle>
                <CardDescription>
                  ASC 842 calculations require a discount rate to generate the
                  amortization schedule. Enter your incremental borrowing rate below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3 max-w-sm">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="discountRateSetup">Discount Rate (%)</Label>
                    <Input
                      id="discountRateSetup"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 5.5"
                      value={discountRateInput}
                      onChange={(e) => setDiscountRateInput(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleSaveDiscountRate}
                    disabled={savingDiscountRate || !discountRateInput}
                  >
                    {savingDiscountRate ? "Saving..." : "Generate Schedule"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Discount Rate adjuster */}
              <div className="flex items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="discountRateEdit">Discount Rate / IBR (%)</Label>
                  <Input
                    id="discountRateEdit"
                    type="number"
                    step="0.01"
                    className="w-40"
                    value={discountRateInput}
                    onChange={(e) => setDiscountRateInput(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveDiscountRate}
                  disabled={savingDiscountRate || !discountRateInput || parseFloat(discountRateInput) === lease.discount_rate * 100}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {savingDiscountRate ? "Recalculating..." : "Recalculate"}
                </Button>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Initial Lease Liability</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.initial_lease_liability)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Initial ROU Asset</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.initial_rou_asset)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Lease Cost</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(asc842Data.summary.total_lease_cost)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>
                      {lease.lease_type === "operating"
                        ? "Monthly Straight-Line Expense"
                        : "Total Interest Expense"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(
                        lease.lease_type === "operating"
                          ? asc842Data.summary.monthly_straight_line_expense
                          : asc842Data.summary.total_interest_expense
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Classification info */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>
                        {lease.lease_type === "operating"
                          ? "Operating Lease"
                          : "Finance Lease"}{" "}
                        — ASC 842 Amortization Schedule
                      </CardTitle>
                      <CardDescription>
                        {lease.lease_type === "operating"
                          ? "Single straight-line lease expense with liability effective-interest amortization. ROU amortization is the plug."
                          : "Separate interest expense (effective interest) and ROU amortization (straight-line). Front-loaded total expense."}
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setAsc842ShowJournalEntries(!asc842ShowJournalEntries)
                      }
                    >
                      {asc842ShowJournalEntries
                        ? "Hide Journal Entries"
                        : "Show Journal Entries"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">#</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead className="text-right">
                            Liability Beg.
                          </TableHead>
                          <TableHead className="text-right">Payment</TableHead>
                          <TableHead className="text-right">
                            Interest
                          </TableHead>
                          <TableHead className="text-right">
                            Principal
                          </TableHead>
                          <TableHead className="text-right">
                            Liability End.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU Beg.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU Amort.
                          </TableHead>
                          <TableHead className="text-right">
                            ROU End.
                          </TableHead>
                          <TableHead className="text-right font-semibold">
                            Total Expense
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {asc842Data.schedule.map((row) => (
                          <TableRow key={row.period}>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {row.period}
                            </TableCell>
                            <TableCell>
                              {getPeriodLabel(
                                row.period_year,
                                row.period_month
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_liability_beginning)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_payment)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.interest_expense)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.principal_reduction)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.lease_liability_ending)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.rou_asset_beginning)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.amortization_expense)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(row.rou_asset_ending)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {formatCurrency(row.total_expense)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="font-semibold border-t-2">
                          <TableCell />
                          <TableCell>Total</TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.lease_payment,
                                0
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.summary.total_interest_expense
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.principal_reduction,
                                0
                              )
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.summary.total_amortization_expense
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(
                              asc842Data.schedule.reduce(
                                (s, r) => s + r.total_expense,
                                0
                              )
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Journal Entries */}
              {asc842ShowJournalEntries && (
                <Card>
                  <CardHeader>
                    <CardTitle>Journal Entries</CardTitle>
                    <CardDescription>
                      Initial recognition and sample monthly entries per ASC 842
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Initial Recognition */}
                    {asc842InitialJE.map((je, idx) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {new Date(
                              je.date + "T00:00:00"
                            ).toLocaleDateString()}
                          </Badge>
                          <span className="text-sm font-medium">
                            {je.description}
                          </span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">
                                Debit
                              </TableHead>
                              <TableHead className="text-right">
                                Credit
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {je.debits.map((d, di) => (
                              <TableRow key={`d-${di}`}>
                                <TableCell>{d.account}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(d.amount)}
                                </TableCell>
                                <TableCell />
                              </TableRow>
                            ))}
                            {je.credits.map((c, ci) => (
                              <TableRow key={`c-${ci}`}>
                                <TableCell className="pl-8">
                                  {c.account}
                                </TableCell>
                                <TableCell />
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(c.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}

                    {/* Sample monthly entries (first 3 periods) */}
                    {asc842Data.schedule.slice(0, 3).map((row) => {
                      const monthlyJE = generateMonthlyJournalEntry(
                        row,
                        lease.lease_type as LeaseClassification,
                        {
                          rouAssetAccountId: lease.rou_asset_account_id ?? undefined,
                          leaseLiabilityAccountId: lease.lease_liability_account_id ?? undefined,
                          leaseExpenseAccountId: lease.lease_expense_account_id ?? undefined,
                          interestExpenseAccountId: lease.interest_expense_account_id ?? undefined,
                          asc842AdjustmentAccountId: lease.asc842_adjustment_account_id ?? undefined,
                          cashApAccountId: lease.cash_ap_account_id ?? undefined,
                        }
                      );
                      return (
                        <div key={row.period} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {getPeriodLabel(
                                row.period_year,
                                row.period_month
                              )}
                            </Badge>
                            <span className="text-sm font-medium">
                              {monthlyJE.description}
                            </span>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead className="text-right">
                                  Debit
                                </TableHead>
                                <TableHead className="text-right">
                                  Credit
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {monthlyJE.debits.map((d, di) => (
                                <TableRow key={`d-${di}`}>
                                  <TableCell>{d.account}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(d.amount)}
                                  </TableCell>
                                  <TableCell />
                                </TableRow>
                              ))}
                              {monthlyJE.credits.map((c, ci) => (
                                <TableRow key={`c-${ci}`}>
                                  <TableCell className="pl-8">
                                    {c.account}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className="text-right tabular-nums">
                                    {formatCurrency(c.amount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      );
                    })}

                    {asc842Data.schedule.length > 3 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">
                        Showing first 3 of {asc842Data.schedule.length} monthly
                        entries. Full entries follow the same pattern.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* === Documents Tab === */}
        <TabsContent value="documents">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Documents</CardTitle>
                    <CardDescription>
                      Upload lease documents. Use AI Extract to auto-fill lease fields from a PDF.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="doc-upload">
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        className="cursor-pointer"
                      >
                        <span>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload File
                        </span>
                      </Button>
                    </label>
                    <input
                      id="doc-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.jpg,.png"
                      onChange={handleDocumentUpload}
                    />
                    <label htmlFor="ai-extract-upload">
                      <Button
                        size="sm"
                        asChild
                        className="cursor-pointer"
                        disabled={extracting}
                      >
                        <span>
                          {extracting ? (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                              Extracting...
                            </>
                          ) : (
                            <>
                              <FileText className="mr-2 h-4 w-4" />
                              AI Extract from PDF
                            </>
                          )}
                        </span>
                      </Button>
                    </label>
                    <input
                      id="ai-extract-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf"
                      onChange={handleAIExtract}
                      disabled={extracting}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {uploadingDoc && (
                  <p className="text-sm text-muted-foreground py-2">
                    Uploading document...
                  </p>
                )}
                {documents.length === 0 && !uploadingDoc ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No documents uploaded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Uploaded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium">
                            {doc.file_name}
                          </TableCell>
                          <TableCell>
                            {DOC_TYPE_LABELS[doc.document_type]}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {doc.file_size_bytes
                              ? `${(doc.file_size_bytes / 1024).toFixed(0)} KB`
                              : "---"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* AI Extraction Review */}
            {extractedData && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>AI Extracted Fields</CardTitle>
                      <CardDescription>
                        Review the extracted data below. Click &quot;Apply to
                        Lease&quot; to update this lease with the extracted
                        values, or dismiss to ignore.
                        {extractedData.confidence_notes && (
                          <span className="block mt-1 text-yellow-700">
                            AI Notes: {extractedData.confidence_notes}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleApplyExtraction}
                        disabled={saving}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Apply to Lease
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExtractedData(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    {Object.entries(extractedData)
                      .filter(
                        ([k]) =>
                          k !== "escalations" &&
                          k !== "options" &&
                          k !== "critical_dates" &&
                          k !== "confidence_notes"
                      )
                      .map(([key, value]) => (
                        <div key={key} className="grid grid-cols-2 gap-2">
                          <span className="text-muted-foreground">
                            {key.replace(/_/g, " ")}
                          </span>
                          <span className="font-mono text-xs">
                            {value === null
                              ? "—"
                              : typeof value === "number"
                              ? value.toLocaleString()
                              : String(value)}
                          </span>
                        </div>
                      ))}
                  </div>

                  {extractedData.escalations?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">
                        Escalations ({extractedData.escalations.length})
                      </p>
                      <div className="text-xs space-y-1">
                        {extractedData.escalations.map(
                          (esc: Record<string, unknown>, i: number) => (
                            <p key={i} className="font-mono">
                              {esc.effective_date as string} —{" "}
                              {esc.escalation_type as string}:{" "}
                              {esc.percentage_increase != null
                                ? `${((esc.percentage_increase as number) * 100).toFixed(1)}%`
                                : esc.amount_increase != null
                                ? formatCurrency(esc.amount_increase as number)
                                : "CPI"}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {extractedData.options?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">
                        Options ({extractedData.options.length})
                      </p>
                      <div className="text-xs space-y-1">
                        {extractedData.options.map(
                          (opt: Record<string, unknown>, i: number) => (
                            <p key={i} className="font-mono">
                              {opt.option_type as string}
                              {opt.exercise_deadline
                                ? ` — deadline: ${opt.exercise_deadline as string}`
                                : ""}
                              {opt.option_term_months
                                ? ` — ${opt.option_term_months as number} mo`
                                : ""}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* === Amendments Tab === */}
        <TabsContent value="amendments">
          <Card>
            <CardHeader>
              <CardTitle>Amendments</CardTitle>
              <CardDescription>
                Modification history for this lease
              </CardDescription>
            </CardHeader>
            <CardContent>
              {amendments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No amendments recorded.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {amendments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.amendment_number}
                        </TableCell>
                        <TableCell>
                          {new Date(
                            a.effective_date + "T00:00:00"
                          ).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{a.description ?? "---"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
