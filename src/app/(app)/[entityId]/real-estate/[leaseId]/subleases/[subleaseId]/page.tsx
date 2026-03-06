"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardAction,
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
  Pencil,
  X,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatPercentage,
  getCurrentPeriod,
  getPeriodLabel,
} from "@/lib/utils/dates";
import { generateSubleasePaymentSchedule } from "@/lib/utils/sublease-payments";
import { getCurrentRent } from "@/lib/utils/lease-payments";
import type {
  SubleaseStatus,
  MaintenanceType,
  SubleasePaymentType,
  EscalationType,
  EscalationFrequency,
  SubleaseOptionType,
  SubleaseCriticalDateType,
  SubleaseDocumentType,
} from "@/lib/types/database";

// --- Interfaces ---

interface SubleaseData {
  id: string;
  lease_id: string;
  entity_id: string;
  sublease_name: string;
  subtenant_name: string;
  subtenant_contact_info: string | null;
  status: SubleaseStatus;
  commencement_date: string;
  rent_commencement_date: string | null;
  expiration_date: string;
  sublease_term_months: number;
  subleased_square_footage: number | null;
  floor_suite: string | null;
  base_rent_monthly: number;
  base_rent_annual: number;
  rent_per_sf: number | null;
  security_deposit_held: number;
  rent_abatement_months: number;
  rent_abatement_amount: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
  other_recovery_description: string | null;
  maintenance_type: MaintenanceType;
  permitted_use: string | null;
  notes: string | null;
  sublease_income_account_id: string | null;
  cam_recovery_account_id: string | null;
  other_income_account_id: string | null;
  leases: { lease_name: string } | null;
}

interface SubleasePaymentRow {
  id: string;
  period_year: number;
  period_month: number;
  payment_type: SubleasePaymentType;
  scheduled_amount: number;
  actual_amount: number | null;
  is_received: boolean;
  received_date: string | null;
}

interface SubleaseEscalationRow {
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

interface SubleaseOptionRow {
  id: string;
  option_type: SubleaseOptionType;
  exercise_deadline: string | null;
  notice_required_days: number | null;
  option_term_months: number | null;
  option_rent_terms: string | null;
  option_price: number | null;
  penalty_amount: number | null;
  is_exercised: boolean;
  exercised_date: string | null;
  notes: string | null;
}

interface SubleaseCriticalDateRow {
  id: string;
  date_type: SubleaseCriticalDateType;
  critical_date: string;
  alert_days_before: number;
  description: string | null;
  is_resolved: boolean;
  resolved_date: string | null;
  notes: string | null;
}

interface SubleaseDocumentRow {
  id: string;
  document_type: SubleaseDocumentType;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
}

// --- Constants ---

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

const MAINTENANCE_LABELS: Record<MaintenanceType, string> = {
  triple_net: "Triple Net (NNN)",
  gross: "Gross",
  modified_gross: "Modified Gross",
};

const SUBLEASE_PAYMENT_TYPE_LABELS: Record<SubleasePaymentType, string> = {
  base_rent: "Base Rent",
  cam_recovery: "CAM Recovery",
  property_tax_recovery: "Property Tax Recovery",
  insurance_recovery: "Insurance Recovery",
  utilities_recovery: "Utilities Recovery",
  other_recovery: "Other Recovery",
};

const SUBLEASE_OPTION_TYPE_LABELS: Record<SubleaseOptionType, string> = {
  renewal: "Renewal",
  termination: "Termination",
  expansion: "Expansion",
  contraction: "Contraction",
};

const SUBLEASE_DATE_TYPE_LABELS: Record<SubleaseCriticalDateType, string> = {
  sublease_expiration: "Sublease Expiration",
  renewal_deadline: "Renewal Deadline",
  termination_notice: "Termination Notice",
  rent_escalation: "Rent Escalation",
  rent_review: "Rent Review",
  insurance_renewal: "Insurance Renewal",
  custom: "Custom",
};

const SUBLEASE_DOC_TYPE_LABELS: Record<SubleaseDocumentType, string> = {
  sublease_agreement: "Sublease Agreement",
  amendment: "Amendment",
  addendum: "Addendum",
  correspondence: "Correspondence",
  insurance_cert: "Insurance Certificate",
  other: "Other",
};

// --- Component ---

export default function SubleaseDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const leaseId = params.leaseId as string;
  const subleaseId = params.subleaseId as string;
  const router = useRouter();
  const supabase = createClient();

  const current = getCurrentPeriod();

  // Core data
  const [sublease, setSublease] = useState<SubleaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Tab data
  const [payments, setPayments] = useState<SubleasePaymentRow[]>([]);
  const [escalations, setEscalations] = useState<SubleaseEscalationRow[]>([]);
  const [options, setOptions] = useState<SubleaseOptionRow[]>([]);
  const [criticalDates, setCriticalDates] = useState<SubleaseCriticalDateRow[]>(
    []
  );
  const [documents, setDocuments] = useState<SubleaseDocumentRow[]>([]);

  // Payment period selector
  const [periodYear, setPeriodYear] = useState(current.year);
  const [periodMonth, setPeriodMonth] = useState(current.month);
  // Full income schedule for grid view
  const [allSubleasePayments, setAllSubleasePayments] = useState<SubleasePaymentRow[]>([]);

  // GL account editing
  const [subleaseIncomeAccountId, setSubleaseIncomeAccountId] = useState("");
  const [camRecoveryAccountId, setCamRecoveryAccountId] = useState("");
  const [otherIncomeAccountId, setOtherIncomeAccountId] = useState("");

  // Sheet states
  const [escalationSheetOpen, setEscalationSheetOpen] = useState(false);
  const [optionSheetOpen, setOptionSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  // Escalation form (shared for add/edit)
  const [editingEscId, setEditingEscId] = useState<string | null>(null);
  const [newEscType, setNewEscType] = useState<EscalationType>(
    "fixed_percentage"
  );
  const [newEscDate, setNewEscDate] = useState("");
  const [newEscPercent, setNewEscPercent] = useState("");
  const [newEscAmount, setNewEscAmount] = useState("");
  const [newEscNewRent, setNewEscNewRent] = useState("");
  const [newEscFrequency, setNewEscFrequency] =
    useState<EscalationFrequency>("annual");

  // New option form
  const [newOptType, setNewOptType] =
    useState<SubleaseOptionType>("renewal");
  const [newOptDeadline, setNewOptDeadline] = useState("");
  const [newOptNoticeDays, setNewOptNoticeDays] = useState("");
  const [newOptTermMonths, setNewOptTermMonths] = useState("");
  const [newOptRentTerms, setNewOptRentTerms] = useState("");
  const [newOptPrice, setNewOptPrice] = useState("");
  const [newOptPenalty, setNewOptPenalty] = useState("");

  // New critical date form
  const [newDateType, setNewDateType] =
    useState<SubleaseCriticalDateType>("sublease_expiration");
  const [newDateDate, setNewDateDate] = useState("");
  const [newDateAlertDays, setNewDateAlertDays] = useState("90");
  const [newDateDescription, setNewDateDescription] = useState("");

  // Document upload state
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Editable summary fields
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Sublease terms edit fields
  const [editSubleaseName, setEditSubleaseName] = useState("");
  const [editSubtenantName, setEditSubtenantName] = useState("");
  const [editSubtenantContact, setEditSubtenantContact] = useState("");
  const [editStatus, setEditStatus] = useState<SubleaseStatus>("draft");
  const [editCommencementDate, setEditCommencementDate] = useState("");
  const [editRentCommencementDate, setEditRentCommencementDate] = useState("");
  const [editExpirationDate, setEditExpirationDate] = useState("");
  const [editTermMonths, setEditTermMonths] = useState("");
  const [editSubleasedSf, setEditSubleasedSf] = useState("");
  const [editFloorSuite, setEditFloorSuite] = useState("");
  const [editMaintenanceType, setEditMaintenanceType] = useState<MaintenanceType>("triple_net");
  const [editPermittedUse, setEditPermittedUse] = useState("");
  const [editNotes, setEditNotes] = useState("");
  // Income terms edit fields
  const [editBaseRent, setEditBaseRent] = useState("");
  const [editRentPerSf, setEditRentPerSf] = useState("");
  const [editSecurityDeposit, setEditSecurityDeposit] = useState("");
  const [editAbatementMonths, setEditAbatementMonths] = useState("");
  const [editAbatementAmount, setEditAbatementAmount] = useState("");
  const [editCamRecovery, setEditCamRecovery] = useState("");
  const [editInsuranceRecovery, setEditInsuranceRecovery] = useState("");
  const [editPropertyTaxRecovery, setEditPropertyTaxRecovery] = useState("");
  const [editUtilitiesRecovery, setEditUtilitiesRecovery] = useState("");
  const [editOtherRecovery, setEditOtherRecovery] = useState("");
  const [editOtherRecoveryDesc, setEditOtherRecoveryDesc] = useState("");

  const years = Array.from({ length: 10 }, (_, i) => current.year - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const loadData = useCallback(async () => {
    // Fetch each query separately to avoid TS "excessively deep" type error with Promise.all + Supabase
    const subleaseResult = await supabase
      .from("subleases")
      .select(
        `id, lease_id, entity_id, sublease_name, subtenant_name, subtenant_contact_info,
        status, commencement_date, rent_commencement_date, expiration_date,
        sublease_term_months, subleased_square_footage, floor_suite,
        base_rent_monthly, base_rent_annual, rent_per_sf,
        security_deposit_held, rent_abatement_months, rent_abatement_amount,
        cam_recovery_monthly, insurance_recovery_monthly, property_tax_recovery_monthly,
        utilities_recovery_monthly, other_recovery_monthly, other_recovery_description,
        maintenance_type, permitted_use, notes,
        sublease_income_account_id, cam_recovery_account_id, other_income_account_id,
        leases(lease_name)`
      )
      .eq("id", subleaseId)
      .single();

    const paymentsResult = await supabase
      .from("sublease_payments")
      .select("*")
      .eq("sublease_id", subleaseId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .order("payment_type");

    const allPaymentsResult = await supabase
      .from("sublease_payments")
      .select("*")
      .eq("sublease_id", subleaseId)
      .order("period_year")
      .order("period_month")
      .order("payment_type");

    const escalationsResult = await supabase
      .from("sublease_escalations")
      .select("*")
      .eq("sublease_id", subleaseId)
      .order("effective_date");

    const optionsResult = await supabase
      .from("sublease_options")
      .select("*")
      .eq("sublease_id", subleaseId)
      .order("exercise_deadline");

    const criticalDatesResult = await supabase
      .from("sublease_critical_dates")
      .select("*")
      .eq("sublease_id", subleaseId)
      .order("critical_date");

    const documentsResult = await supabase
      .from("sublease_documents")
      .select("*")
      .eq("sublease_id", subleaseId)
      .order("created_at", { ascending: false });

    const accountsResult = await supabase
      .from("accounts")
      .select("id, name, account_number, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    if (subleaseResult.data) {
      const s = subleaseResult.data as unknown as SubleaseData;
      setSublease(s);
      setSubleaseIncomeAccountId(s.sublease_income_account_id ?? "");
      setCamRecoveryAccountId(s.cam_recovery_account_id ?? "");
      setOtherIncomeAccountId(s.other_income_account_id ?? "");
      // Init editable fields
      initEditFields(s);
    }

    setPayments(
      (paymentsResult.data as unknown as SubleasePaymentRow[]) ?? []
    );
    setAllSubleasePayments(
      (allPaymentsResult.data as unknown as SubleasePaymentRow[]) ?? []
    );
    setEscalations(
      (escalationsResult.data as unknown as SubleaseEscalationRow[]) ?? []
    );
    setOptions(
      (optionsResult.data as unknown as SubleaseOptionRow[]) ?? []
    );
    setCriticalDates(
      (criticalDatesResult.data as unknown as SubleaseCriticalDateRow[]) ?? []
    );
    setDocuments(
      (documentsResult.data as unknown as SubleaseDocumentRow[]) ?? []
    );
    setAccounts((accountsResult.data as Account[]) ?? []);
    setLoading(false);
  }, [supabase, subleaseId, entityId, periodYear, periodMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Handlers ---

  async function handleSaveAccounts() {
    setSaving(true);
    const { error } = await supabase
      .from("subleases")
      .update({
        sublease_income_account_id: subleaseIncomeAccountId || null,
        cam_recovery_account_id: camRecoveryAccountId || null,
        other_income_account_id: otherIncomeAccountId || null,
      })
      .eq("id", subleaseId);

    if (error) toast.error(error.message);
    else toast.success("GL accounts updated");
    setSaving(false);
  }

  function initEditFields(s: SubleaseData) {
    setEditSubleaseName(s.sublease_name);
    setEditSubtenantName(s.subtenant_name);
    setEditSubtenantContact(s.subtenant_contact_info ?? "");
    setEditStatus(s.status);
    setEditCommencementDate(s.commencement_date);
    setEditRentCommencementDate(s.rent_commencement_date ?? "");
    setEditExpirationDate(s.expiration_date);
    setEditTermMonths(String(s.sublease_term_months));
    setEditSubleasedSf(s.subleased_square_footage != null ? String(s.subleased_square_footage) : "");
    setEditFloorSuite(s.floor_suite ?? "");
    setEditMaintenanceType(s.maintenance_type);
    setEditPermittedUse(s.permitted_use ?? "");
    setEditNotes(s.notes ?? "");
    setEditBaseRent(String(s.base_rent_monthly));
    setEditRentPerSf(s.rent_per_sf != null ? String(s.rent_per_sf) : "");
    setEditSecurityDeposit(String(s.security_deposit_held));
    setEditAbatementMonths(String(s.rent_abatement_months));
    setEditAbatementAmount(String(s.rent_abatement_amount));
    setEditCamRecovery(String(s.cam_recovery_monthly));
    setEditInsuranceRecovery(String(s.insurance_recovery_monthly));
    setEditPropertyTaxRecovery(String(s.property_tax_recovery_monthly));
    setEditUtilitiesRecovery(String(s.utilities_recovery_monthly));
    setEditOtherRecovery(String(s.other_recovery_monthly));
    setEditOtherRecoveryDesc(s.other_recovery_description ?? "");
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    const baseRent = parseFloat(editBaseRent) || 0;
    const { error } = await supabase
      .from("subleases")
      .update({
        sublease_name: editSubleaseName.trim(),
        subtenant_name: editSubtenantName.trim(),
        subtenant_contact_info: editSubtenantContact.trim() || null,
        status: editStatus,
        commencement_date: editCommencementDate,
        rent_commencement_date: editRentCommencementDate || null,
        expiration_date: editExpirationDate,
        sublease_term_months: parseInt(editTermMonths) || 0,
        subleased_square_footage: editSubleasedSf ? parseFloat(editSubleasedSf) : null,
        floor_suite: editFloorSuite.trim() || null,
        maintenance_type: editMaintenanceType,
        permitted_use: editPermittedUse.trim() || null,
        notes: editNotes.trim() || null,
        base_rent_monthly: baseRent,
        rent_per_sf: editRentPerSf ? parseFloat(editRentPerSf) : null,
        security_deposit_held: parseFloat(editSecurityDeposit) || 0,
        rent_abatement_months: parseInt(editAbatementMonths) || 0,
        rent_abatement_amount: parseFloat(editAbatementAmount) || 0,
        cam_recovery_monthly: parseFloat(editCamRecovery) || 0,
        insurance_recovery_monthly: parseFloat(editInsuranceRecovery) || 0,
        property_tax_recovery_monthly: parseFloat(editPropertyTaxRecovery) || 0,
        utilities_recovery_monthly: parseFloat(editUtilitiesRecovery) || 0,
        other_recovery_monthly: parseFloat(editOtherRecovery) || 0,
        other_recovery_description: editOtherRecoveryDesc.trim() || null,
      })
      .eq("id", subleaseId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Sublease details updated");
      setEditingDetails(false);
      loadData();
    }
    setSavingDetails(false);
  }

  function handleCancelEditDetails() {
    if (sublease) initEditFields(sublease);
    setEditingDetails(false);
  }

  async function handleDeleteSublease() {
    setDeleting(true);
    // Delete child records first
    await supabase.from("sublease_payments").delete().eq("sublease_id", subleaseId);
    await supabase.from("sublease_escalations").delete().eq("sublease_id", subleaseId);
    await supabase.from("sublease_options").delete().eq("sublease_id", subleaseId);
    await supabase.from("sublease_critical_dates").delete().eq("sublease_id", subleaseId);
    await supabase.from("sublease_documents").delete().eq("sublease_id", subleaseId);

    const { error } = await supabase.from("subleases").delete().eq("id", subleaseId);
    if (error) {
      toast.error("Failed to delete sublease: " + error.message);
      setDeleting(false);
    } else {
      toast.success("Sublease deleted");
      router.push(`/${entityId}/real-estate/${leaseId}`);
    }
  }

  async function handleToggleReceived(
    paymentId: string,
    isReceived: boolean
  ) {
    const { error } = await supabase
      .from("sublease_payments")
      .update({
        is_received: isReceived,
        received_date: isReceived
          ? new Date().toISOString().split("T")[0]
          : null,
      })
      .eq("id", paymentId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleUpdateActualAmount(
    paymentId: string,
    value: string
  ) {
    const actual = value ? parseFloat(value) : null;
    const { error } = await supabase
      .from("sublease_payments")
      .update({ actual_amount: actual })
      .eq("id", paymentId);

    if (error) toast.error(error.message);
  }

  async function handleUpdateReceivedDate(
    paymentId: string,
    value: string
  ) {
    const { error } = await supabase
      .from("sublease_payments")
      .update({ received_date: value || null })
      .eq("id", paymentId);

    if (error) toast.error(error.message);
  }

  async function handleRegenerateSchedule() {
    if (!sublease) return;
    // Delete existing and regenerate
    await supabase
      .from("sublease_payments")
      .delete()
      .eq("sublease_id", subleaseId);

    const schedule = generateSubleasePaymentSchedule(
      {
        commencement_date: sublease.commencement_date,
        rent_commencement_date: sublease.rent_commencement_date,
        expiration_date: sublease.expiration_date,
        base_rent_monthly: sublease.base_rent_monthly,
        cam_recovery_monthly: sublease.cam_recovery_monthly,
        insurance_recovery_monthly: sublease.insurance_recovery_monthly,
        property_tax_recovery_monthly: sublease.property_tax_recovery_monthly,
        utilities_recovery_monthly: sublease.utilities_recovery_monthly,
        other_recovery_monthly: sublease.other_recovery_monthly,
        rent_abatement_months: sublease.rent_abatement_months,
        rent_abatement_amount: sublease.rent_abatement_amount,
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
        sublease_id: subleaseId,
        period_year: entry.period_year,
        period_month: entry.period_month,
        payment_type: entry.payment_type,
        scheduled_amount: entry.scheduled_amount,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        await supabase
          .from("sublease_payments")
          .insert(rows.slice(i, i + 500));
      }
    }

    toast.success("Income schedule regenerated");
    loadData();
  }

  function resetEscForm() {
    setEditingEscId(null);
    setNewEscType("fixed_percentage");
    setNewEscDate("");
    setNewEscPercent("");
    setNewEscAmount("");
    setNewEscNewRent("");
    setNewEscFrequency("annual");
  }

  function openEditEscalation(esc: SubleaseEscalationRow) {
    setEditingEscId(esc.id);
    setNewEscType(esc.escalation_type);
    setNewEscDate(esc.effective_date);
    setNewEscPercent(esc.percentage_increase != null ? String(esc.percentage_increase) : "");
    setNewEscAmount(esc.amount_increase != null ? String(esc.amount_increase) : "");
    setNewEscNewRent("");
    setNewEscFrequency(esc.frequency);
    setEscalationSheetOpen(true);
  }

  /** Walk prior escalations to get the effective rent just before a given date */
  function getEffectiveRentAt(effectiveDate: string): number {
    if (!sublease) return 0;
    let rent = sublease.base_rent_monthly;
    const sorted = [...escalations]
      .filter((e) => e.id !== editingEscId)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    for (const esc of sorted) {
      if (esc.effective_date >= effectiveDate) break;
      if (esc.escalation_type === "fixed_percentage" && esc.percentage_increase != null) {
        rent = rent * (1 + esc.percentage_increase);
      } else if (esc.escalation_type === "fixed_amount" && esc.amount_increase != null) {
        rent = rent + esc.amount_increase;
      }
    }
    return rent;
  }

  /** Compute the cumulative rent after all escalations up to and including a given one */
  function getResultingRentAfter(escId: string): number {
    if (!sublease) return 0;
    let rent = sublease.base_rent_monthly;
    const sorted = [...escalations].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    for (const esc of sorted) {
      if (esc.escalation_type === "fixed_percentage" && esc.percentage_increase != null) {
        rent = rent * (1 + esc.percentage_increase);
      } else if (esc.escalation_type === "fixed_amount" && esc.amount_increase != null) {
        rent = rent + esc.amount_increase;
      }
      if (esc.id === escId) break;
    }
    return Math.round(rent * 100) / 100;
  }

  /** Compute percentage & amount from a new rent target */
  function handleNewRentChange(val: string) {
    setNewEscNewRent(val);
    if (!val || !sublease) return;
    const newRent = parseFloat(val);
    const currentMonthly = newEscDate
      ? getEffectiveRentAt(newEscDate)
      : sublease.base_rent_monthly;
    if (currentMonthly > 0 && !isNaN(newRent)) {
      const diff = newRent - currentMonthly;
      const pct = diff / currentMonthly;
      setNewEscAmount(String(Math.round(diff * 100) / 100));
      setNewEscPercent(String(Math.round(pct * 1000000) / 1000000));
      if (diff >= 0) {
        setNewEscType("fixed_amount");
      }
    }
  }

  async function handleSaveEscalation() {
    const payload = {
      escalation_type: newEscType,
      effective_date: newEscDate,
      percentage_increase: newEscPercent ? parseFloat(newEscPercent) : null,
      amount_increase: newEscAmount ? parseFloat(newEscAmount) : null,
      frequency: newEscFrequency,
    };

    if (editingEscId) {
      const { error } = await supabase
        .from("sublease_escalations")
        .update(payload)
        .eq("id", editingEscId);
      if (error) { toast.error(error.message); return; }
      toast.success("Escalation updated");
    } else {
      const { error } = await supabase
        .from("sublease_escalations")
        .insert({ ...payload, sublease_id: subleaseId });
      if (error) { toast.error(error.message); return; }
      toast.success("Escalation added");
    }

    setEscalationSheetOpen(false);
    resetEscForm();
    loadData();
  }

  async function handleAddOption() {
    const { error } = await supabase.from("sublease_options").insert({
      sublease_id: subleaseId,
      option_type: newOptType,
      exercise_deadline: newOptDeadline || null,
      notice_required_days: newOptNoticeDays
        ? parseInt(newOptNoticeDays)
        : null,
      option_term_months: newOptTermMonths
        ? parseInt(newOptTermMonths)
        : null,
      option_rent_terms: newOptRentTerms || null,
      option_price: newOptPrice ? parseFloat(newOptPrice) : null,
      penalty_amount: newOptPenalty ? parseFloat(newOptPenalty) : null,
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
      loadData();
    }
  }

  async function handleAddCriticalDate() {
    const { error } = await supabase.from("sublease_critical_dates").insert({
      sublease_id: subleaseId,
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
      .from("sublease_critical_dates")
      .update({
        is_resolved: true,
        resolved_date: new Date().toISOString().split("T")[0],
      })
      .eq("id", dateId);

    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteEscalation(id: string) {
    const { error } = await supabase
      .from("sublease_escalations")
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDeleteOption(id: string) {
    const { error } = await supabase
      .from("sublease_options")
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);

    const timestamp = Date.now();
    const storagePath = `${entityId}/subleases/${timestamp}_${file.name}`;

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

    const { error: dbError } = await supabase
      .from("sublease_documents")
      .insert({
        sublease_id: subleaseId,
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

  // --- Helpers ---

  // Current rent after applying all escalations effective on or before today
  const currentBaseRent = sublease
    ? getCurrentRent(
        sublease.base_rent_monthly,
        escalations.map((e) => ({
          escalation_type: e.escalation_type,
          effective_date: e.effective_date,
          percentage_increase: e.percentage_increase,
          amount_increase: e.amount_increase,
          frequency: e.frequency,
        }))
      )
    : 0;

  const totalMonthlyIncome = sublease
    ? currentBaseRent +
      sublease.cam_recovery_monthly +
      sublease.insurance_recovery_monthly +
      sublease.property_tax_recovery_monthly +
      sublease.utilities_recovery_monthly +
      sublease.other_recovery_monthly
    : 0;

  const revenueAccounts = accounts.filter(
    (a) => a.classification === "Revenue"
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

  function getCriticalDateUrgency(
    dateStr: string,
    isResolved: boolean
  ): string {
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
        <p className="text-muted-foreground">Loading sublease...</p>
      </div>
    );
  }

  if (!sublease) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Sublease not found.</p>
      </div>
    );
  }

  const incomeScheduledTotal = payments.reduce(
    (s, p) => s + p.scheduled_amount,
    0
  );

  // Build full income grid: year → month → total scheduled
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const incomeGrid: Record<number, Record<number, number>> = {};
  for (const p of allSubleasePayments) {
    if (!incomeGrid[p.period_year]) incomeGrid[p.period_year] = {};
    incomeGrid[p.period_year][p.period_month] =
      (incomeGrid[p.period_year][p.period_month] || 0) + p.scheduled_amount;
  }
  const gridYears = Object.keys(incomeGrid)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/${entityId}/real-estate/${leaseId}`)
          }
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Lease
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {sublease.sublease_name}
            </h1>
            <Badge variant={SUBLEASE_STATUS_VARIANTS[sublease.status]}>
              {SUBLEASE_STATUS_LABELS[sublease.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Sublease to {sublease.subtenant_name}
            {sublease.leases?.lease_name && (
              <> &middot; Parent Lease: {sublease.leases.lease_name}</>
            )}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={deleting}>
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Sublease"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this sublease?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete{" "}
                <span className="font-semibold">{sublease.sublease_name}</span>{" "}
                and all associated data including payments, escalations, options,
                critical dates, and documents. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSublease}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Summary Bar */}
      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="grid grid-cols-6 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Base Rent</p>
            <p className="text-lg font-semibold tabular-nums text-green-600">
              {formatCurrency(currentBaseRent)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Monthly Income</p>
            <p className="text-lg font-semibold tabular-nums text-green-600">
              {formatCurrency(totalMonthlyIncome)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Term</p>
            <p className="text-lg font-semibold">
              {sublease.sublease_term_months} mo
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commencement</p>
            <p className="text-lg font-semibold">
              {new Date(
                sublease.commencement_date + "T00:00:00"
              ).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiration</p>
            <p className="text-lg font-semibold">
              {new Date(
                sublease.expiration_date + "T00:00:00"
              ).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Security Deposit</p>
            <p className="text-lg font-semibold">
              {formatCurrency(sublease.security_deposit_held)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="income">Income Schedule</TabsTrigger>
          <TabsTrigger value="escalations">Escalations</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="dates">Critical Dates</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* === Summary Tab === */}
        <TabsContent value="summary">
          <div className="grid grid-cols-2 gap-6">
            {/* Sublease Terms Card */}
            <Card>
              <CardHeader>
                <CardTitle>Sublease Terms</CardTitle>
                <CardAction>
                  {!editingDetails ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingDetails(true)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEditDetails}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveDetails}
                        disabled={savingDetails}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {savingDetails ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {editingDetails ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 items-center">
                      <Label className="text-muted-foreground">Sublease Name</Label>
                      <Input
                        value={editSubleaseName}
                        onChange={(e) => setEditSubleaseName(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Subtenant</Label>
                      <Input
                        value={editSubtenantName}
                        onChange={(e) => setEditSubtenantName(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Contact Info</Label>
                      <Input
                        value={editSubtenantContact}
                        onChange={(e) => setEditSubtenantContact(e.target.value)}
                        placeholder="Phone, email, etc."
                      />
                      <Label className="text-muted-foreground">Status</Label>
                      <Select
                        value={editStatus}
                        onValueChange={(v) => setEditStatus(v as SubleaseStatus)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
                          <SelectItem value="terminated">Terminated</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label className="text-muted-foreground">Commencement</Label>
                      <Input
                        type="date"
                        value={editCommencementDate}
                        onChange={(e) => setEditCommencementDate(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Rent Commencement</Label>
                      <Input
                        type="date"
                        value={editRentCommencementDate}
                        onChange={(e) => setEditRentCommencementDate(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Expiration</Label>
                      <Input
                        type="date"
                        value={editExpirationDate}
                        onChange={(e) => setEditExpirationDate(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Term (Months)</Label>
                      <Input
                        type="number"
                        value={editTermMonths}
                        onChange={(e) => setEditTermMonths(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Subleased SF</Label>
                      <Input
                        type="number"
                        value={editSubleasedSf}
                        onChange={(e) => setEditSubleasedSf(e.target.value)}
                        placeholder="Square footage"
                      />
                      <Label className="text-muted-foreground">Floor / Suite</Label>
                      <Input
                        value={editFloorSuite}
                        onChange={(e) => setEditFloorSuite(e.target.value)}
                      />
                      <Label className="text-muted-foreground">Maintenance</Label>
                      <Select
                        value={editMaintenanceType}
                        onValueChange={(v) => setEditMaintenanceType(v as MaintenanceType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="triple_net">Triple Net (NNN)</SelectItem>
                          <SelectItem value="gross">Gross</SelectItem>
                          <SelectItem value="modified_gross">Modified Gross</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label className="text-muted-foreground">Permitted Use</Label>
                      <Input
                        value={editPermittedUse}
                        onChange={(e) => setEditPermittedUse(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Notes</Label>
                      <Textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="text-muted-foreground">Sublease Name</span>
                      <span>{sublease.sublease_name}</span>
                      <span className="text-muted-foreground">Subtenant</span>
                      <span>{sublease.subtenant_name}</span>
                      <span className="text-muted-foreground">Contact Info</span>
                      <span>{sublease.subtenant_contact_info ?? "---"}</span>
                      <span className="text-muted-foreground">Status</span>
                      <span>
                        <Badge
                          variant={SUBLEASE_STATUS_VARIANTS[sublease.status]}
                        >
                          {SUBLEASE_STATUS_LABELS[sublease.status]}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground">Commencement</span>
                      <span>
                        {new Date(
                          sublease.commencement_date + "T00:00:00"
                        ).toLocaleDateString()}
                      </span>
                      <span className="text-muted-foreground">
                        Rent Commencement
                      </span>
                      <span>
                        {sublease.rent_commencement_date
                          ? new Date(
                              sublease.rent_commencement_date + "T00:00:00"
                            ).toLocaleDateString()
                          : "---"}
                      </span>
                      <span className="text-muted-foreground">Expiration</span>
                      <span>
                        {new Date(
                          sublease.expiration_date + "T00:00:00"
                        ).toLocaleDateString()}
                      </span>
                      <span className="text-muted-foreground">Term</span>
                      <span>{sublease.sublease_term_months} months</span>
                      <span className="text-muted-foreground">Subleased SF</span>
                      <span>
                        {sublease.subleased_square_footage
                          ? sublease.subleased_square_footage.toLocaleString()
                          : "---"}
                      </span>
                      <span className="text-muted-foreground">Floor / Suite</span>
                      <span>{sublease.floor_suite ?? "---"}</span>
                      <span className="text-muted-foreground">Maintenance</span>
                      <span>{MAINTENANCE_LABELS[sublease.maintenance_type]}</span>
                      <span className="text-muted-foreground">Permitted Use</span>
                      <span>{sublease.permitted_use ?? "---"}</span>
                    </div>

                    {sublease.notes && (
                      <div className="pt-3 border-t">
                        <p className="text-muted-foreground mb-1">Notes</p>
                        <p className="whitespace-pre-wrap">{sublease.notes}</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Income Terms Card */}
            <Card>
              <CardHeader>
                <CardTitle>Income Terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {editingDetails ? (
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <Label className="text-muted-foreground">Base Rent (Monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editBaseRent}
                      onChange={(e) => setEditBaseRent(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Rent / SF</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editRentPerSf}
                      onChange={(e) => setEditRentPerSf(e.target.value)}
                      placeholder="Optional"
                    />
                    <Label className="text-muted-foreground">Security Deposit Held</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editSecurityDeposit}
                      onChange={(e) => setEditSecurityDeposit(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Abatement Months</Label>
                    <Input
                      type="number"
                      value={editAbatementMonths}
                      onChange={(e) => setEditAbatementMonths(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Abatement Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editAbatementAmount}
                      onChange={(e) => setEditAbatementAmount(e.target.value)}
                    />
                    <Label className="text-muted-foreground">CAM Recovery</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editCamRecovery}
                      onChange={(e) => setEditCamRecovery(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Insurance Recovery</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editInsuranceRecovery}
                      onChange={(e) => setEditInsuranceRecovery(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Property Tax Recovery</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editPropertyTaxRecovery}
                      onChange={(e) => setEditPropertyTaxRecovery(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Utilities Recovery</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editUtilitiesRecovery}
                      onChange={(e) => setEditUtilitiesRecovery(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Other Recovery</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editOtherRecovery}
                      onChange={(e) => setEditOtherRecovery(e.target.value)}
                    />
                    <Label className="text-muted-foreground">Other Description</Label>
                    <Input
                      value={editOtherRecoveryDesc}
                      onChange={(e) => setEditOtherRecoveryDesc(e.target.value)}
                      placeholder="Description of other recovery"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="text-muted-foreground">
                      Base Rent (Monthly)
                    </span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.base_rent_monthly)}
                    </span>
                    <span className="text-muted-foreground">
                      Base Rent (Annual)
                    </span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.base_rent_annual)}
                    </span>
                    <span className="text-muted-foreground">Rent / SF</span>
                    <span>
                      {sublease.rent_per_sf
                        ? formatCurrency(sublease.rent_per_sf)
                        : "---"}
                    </span>
                    <span className="text-muted-foreground">
                      Security Deposit Held
                    </span>
                    <span>{formatCurrency(sublease.security_deposit_held)}</span>
                    <span className="text-muted-foreground">
                      Rent Abatement Months
                    </span>
                    <span>{sublease.rent_abatement_months}</span>
                    <span className="text-muted-foreground">
                      Rent Abatement Amount
                    </span>
                    <span>{formatCurrency(sublease.rent_abatement_amount)}</span>
                    <span className="text-muted-foreground">CAM Recovery</span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.cam_recovery_monthly)}
                    </span>
                    <span className="text-muted-foreground">
                      Insurance Recovery
                    </span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.insurance_recovery_monthly)}
                    </span>
                    <span className="text-muted-foreground">
                      Property Tax Recovery
                    </span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.property_tax_recovery_monthly)}
                    </span>
                    <span className="text-muted-foreground">
                      Utilities Recovery
                    </span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.utilities_recovery_monthly)}
                    </span>
                    <span className="text-muted-foreground">Other Recovery</span>
                    <span className="text-green-600">
                      {formatCurrency(sublease.other_recovery_monthly)}
                    </span>
                    {sublease.other_recovery_description && (
                      <>
                        <span className="text-muted-foreground">
                          Other Description
                        </span>
                        <span>{sublease.other_recovery_description}</span>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* GL Accounts Card (full width) */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>GL Accounts</CardTitle>
                <CardAction>
                  <Button
                    size="sm"
                    onClick={handleSaveAccounts}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : "Save Accounts"}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  {renderAccountSelect(
                    "Sublease Income",
                    "subleaseIncome",
                    subleaseIncomeAccountId,
                    setSubleaseIncomeAccountId,
                    revenueAccounts
                  )}
                  {renderAccountSelect(
                    "CAM Recovery Income",
                    "camRecovery",
                    camRecoveryAccountId,
                    setCamRecoveryAccountId,
                    revenueAccounts
                  )}
                  {renderAccountSelect(
                    "Other Income",
                    "otherIncome",
                    otherIncomeAccountId,
                    setOtherIncomeAccountId,
                    revenueAccounts
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === Income Schedule Tab === */}
        <TabsContent value="income" className="space-y-6">
          {/* Full Schedule Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Income Schedule</CardTitle>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateSchedule}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {gridYears.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No income schedule generated yet. Click Regenerate to create one.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 w-16">Year</TableHead>
                        {MONTH_SHORT.map((m) => (
                          <TableHead key={m} className="text-right text-xs min-w-[90px]">
                            {m}
                          </TableHead>
                        ))}
                        <TableHead className="text-right text-xs font-semibold min-w-[100px]">
                          Annual
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gridYears.map((year) => {
                        const monthData = incomeGrid[year] || {};
                        const annualTotal = Object.values(monthData).reduce(
                          (s, v) => s + v,
                          0
                        );
                        return (
                          <TableRow key={year}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium tabular-nums">
                              {year}
                            </TableCell>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(
                              (month) => {
                                const amt = monthData[month];
                                const isSelected =
                                  year === periodYear && month === periodMonth;
                                return (
                                  <TableCell
                                    key={month}
                                    className={cn(
                                      "text-right tabular-nums text-sm text-green-600 cursor-pointer transition-colors hover:bg-muted/50",
                                      isSelected && "bg-primary/10 font-medium ring-1 ring-primary/30 rounded"
                                    )}
                                    onClick={() => {
                                      setPeriodYear(year);
                                      setPeriodMonth(month);
                                    }}
                                  >
                                    {amt != null
                                      ? formatCurrency(amt)
                                      : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                );
                              }
                            )}
                            <TableCell className="text-right tabular-nums font-semibold text-sm text-green-600">
                              {formatCurrency(annualTotal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {/* Grand total row */}
                      {gridYears.length > 1 && (
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell className="sticky left-0 bg-background z-10">
                            Total
                          </TableCell>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (month) => {
                              const colTotal = gridYears.reduce(
                                (s, y) => s + (incomeGrid[y]?.[month] || 0),
                                0
                              );
                              return (
                                <TableCell
                                  key={month}
                                  className="text-right tabular-nums text-sm text-green-600"
                                >
                                  {colTotal > 0 ? formatCurrency(colTotal) : "—"}
                                </TableCell>
                              );
                            }
                          )}
                          <TableCell className="text-right tabular-nums text-sm text-green-600">
                            {formatCurrency(
                              allSubleasePayments.reduce((s, p) => s + p.scheduled_amount, 0)
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected Month Detail */}
          <Card>
            <CardHeader>
                  <CardTitle className="text-base">
                    {getPeriodLabel(periodYear, periodMonth)}
                  </CardTitle>
                  <CardDescription>
                    Click any cell above to view that month
                  </CardDescription>
                <CardAction>
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
                </div>
                </CardAction>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No income scheduled for this period.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Income Type</TableHead>
                      <TableHead className="text-right">
                        Scheduled Amount
                      </TableHead>
                      <TableHead className="text-right">
                        Actual Amount
                      </TableHead>
                      <TableHead className="text-center">Received</TableHead>
                      <TableHead>Received Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {SUBLEASE_PAYMENT_TYPE_LABELS[p.payment_type]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">
                          {formatCurrency(p.scheduled_amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="w-[120px] ml-auto text-right tabular-nums"
                            defaultValue={
                              p.actual_amount != null
                                ? p.actual_amount
                                : ""
                            }
                            onBlur={(e) =>
                              handleUpdateActualAmount(
                                p.id,
                                e.target.value
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={p.is_received}
                            onCheckedChange={(checked) =>
                              handleToggleReceived(
                                p.id,
                                checked === true
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            className="w-[150px]"
                            defaultValue={p.received_date ?? ""}
                            onBlur={(e) =>
                              handleUpdateReceivedDate(
                                p.id,
                                e.target.value
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">
                        {formatCurrency(incomeScheduledTotal)}
                      </TableCell>
                      <TableCell />
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
                <CardTitle>Rent Escalations</CardTitle>
                <CardAction>
                <Sheet
                  open={escalationSheetOpen}
                  onOpenChange={(open) => {
                    setEscalationSheetOpen(open);
                    if (!open) resetEscForm();
                  }}
                >
                  <SheetTrigger asChild>
                    <Button size="sm" onClick={() => resetEscForm()}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Escalation
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="px-6 pt-6 overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>
                        {editingEscId ? "Edit Escalation" : "Add Escalation"}
                      </SheetTitle>
                      <SheetDescription>
                        {editingEscId
                          ? "Update this escalation rule"
                          : "Define a rent escalation rule for this sublease"}
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6 pb-6">
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
                          onChange={(e) => {
                            setNewEscDate(e.target.value);
                            if (newEscNewRent && e.target.value) {
                              const eff = getEffectiveRentAt(e.target.value);
                              const nr = parseFloat(newEscNewRent);
                              if (eff > 0 && !isNaN(nr)) {
                                const diff = nr - eff;
                                const pct = diff / eff;
                                setNewEscAmount(String(Math.round(diff * 100) / 100));
                                setNewEscPercent(String(Math.round(pct * 1000000) / 1000000));
                              }
                            }
                          }}
                        />
                      </div>

                      {/* New Monthly Rent — back-calculates increase from effective rent at date */}
                      {newEscType !== "cpi" && sublease && sublease.base_rent_monthly > 0 && (() => {
                        const effectiveRent = newEscDate
                          ? getEffectiveRentAt(newEscDate)
                          : sublease.base_rent_monthly;
                        return (
                          <div className="space-y-2">
                            <Label>New Monthly Rent</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={`Current: ${formatCurrency(effectiveRent)}`}
                              value={newEscNewRent}
                              onChange={(e) => handleNewRentChange(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Enter the new rent and the increase will be calculated automatically
                            </p>
                          </div>
                        );
                      })()}

                      {(newEscType === "fixed_percentage" ||
                        newEscType === "cpi") && (
                        <div className="space-y-2">
                          <Label>Percentage Increase (decimal)</Label>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="e.g., 0.03 for 3%"
                            value={newEscPercent}
                            onChange={(e) =>
                              setNewEscPercent(e.target.value)
                            }
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
                            onChange={(e) =>
                              setNewEscAmount(e.target.value)
                            }
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
                            <SelectItem value="at_renewal">
                              At Renewal
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={handleSaveEscalation}
                        className="w-full"
                      >
                        {editingEscId ? "Save Changes" : "Add Escalation"}
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
                </CardAction>
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
                      <TableHead>New Monthly Rent</TableHead>
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
                        <TableCell className="tabular-nums font-medium text-green-600">
                          {formatCurrency(getResultingRentAfter(esc.id))}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
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
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditEscalation(esc)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleDeleteEscalation(esc.id)
                              }
                            >
                              &times;
                            </Button>
                          </div>
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
                <CardTitle>Sublease Options</CardTitle>
                <CardAction>
                <Sheet
                  open={optionSheetOpen}
                  onOpenChange={setOptionSheetOpen}
                >
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
                        Define a sublease option (renewal, termination, etc.)
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Option Type</Label>
                        <Select
                          value={newOptType}
                          onValueChange={(v) =>
                            setNewOptType(v as SubleaseOptionType)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(
                                SUBLEASE_OPTION_TYPE_LABELS
                              ) as [SubleaseOptionType, string][]
                            ).map(([key, label]) => (
                              <SelectItem key={key} value={key}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Exercise Deadline</Label>
                        <Input
                          type="date"
                          value={newOptDeadline}
                          onChange={(e) =>
                            setNewOptDeadline(e.target.value)
                          }
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
                          onChange={(e) =>
                            setNewOptRentTerms(e.target.value)
                          }
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
                            onChange={(e) =>
                              setNewOptPrice(e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Penalty</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newOptPenalty}
                            onChange={(e) =>
                              setNewOptPenalty(e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <Button
                        onClick={handleAddOption}
                        className="w-full"
                      >
                        Add Option
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
                </CardAction>
            </CardHeader>
            <CardContent>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No sublease options defined.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Notice</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Exercised</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {options.map((opt) => (
                      <TableRow key={opt.id}>
                        <TableCell>
                          {SUBLEASE_OPTION_TYPE_LABELS[opt.option_type]}
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
                <CardTitle>Critical Dates</CardTitle>
                <CardAction>
                <Sheet
                  open={dateSheetOpen}
                  onOpenChange={setDateSheetOpen}
                >
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
                        Track an important sublease milestone
                      </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                      <div className="space-y-2">
                        <Label>Date Type</Label>
                        <Select
                          value={newDateType}
                          onValueChange={(v) =>
                            setNewDateType(
                              v as SubleaseCriticalDateType
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.entries(
                                SUBLEASE_DATE_TYPE_LABELS
                              ) as [SubleaseCriticalDateType, string][]
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
                          onChange={(e) =>
                            setNewDateDate(e.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Alert Days Before</Label>
                        <Input
                          type="number"
                          value={newDateAlertDays}
                          onChange={(e) =>
                            setNewDateAlertDays(e.target.value)
                          }
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
                </CardAction>
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
                          {SUBLEASE_DATE_TYPE_LABELS[cd.date_type]}
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
                        <TableCell>{cd.alert_days_before} days</TableCell>
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

        {/* === Documents Tab === */}
        <TabsContent value="documents">
          <Card>
            <CardHeader>
                  <CardTitle>Documents</CardTitle>
                  <CardDescription>
                    Upload sublease-related documents
                  </CardDescription>
                <CardAction>
                <div className="flex items-center gap-2">
                  <label htmlFor="sublease-doc-upload">
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
                    id="sublease-doc-upload"
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.jpg,.png"
                    onChange={handleDocumentUpload}
                  />
                </div>
                </CardAction>
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
                          {SUBLEASE_DOC_TYPE_LABELS[doc.document_type]}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
