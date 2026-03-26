import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/close/seed-templates
// Seeds close task templates from best-practice month-end close checklist.
// Idempotent: skips templates whose name already exists for the organization.

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const orgId = membership.organization_id;

  // Look up entity IDs by name
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  if (!entities || entities.length === 0) {
    return NextResponse.json({ error: "No entities found" }, { status: 404 });
  }

  const entityMap: Record<string, string> = {};
  for (const e of entities) {
    const upper = (e.code ?? e.name).toUpperCase();
    entityMap[upper] = e.id;
    // Also map by partial name match
    if (e.name.toLowerCase().includes("versatile")) entityMap["VS"] = e.id;
    if (e.name.toLowerCase().includes("avon") || e.name.toLowerCase().includes("arh")) entityMap["ARH"] = e.id;
    if (e.name.toLowerCase().includes("silverco")) entityMap["SC"] = e.id;
  }

  // Helper: convert scope string like "ARH,VS" to entity_ids array, null for "ALL"
  function scopeToEntityIds(scope: string): string[] | null {
    if (scope === "ALL") return null;
    if (scope === "CONSOLIDATED") return null; // applies to all entities at consolidated level
    const codes = scope.split(",");
    const ids = codes.map((c) => entityMap[c.trim()]).filter(Boolean);
    return ids.length > 0 ? ids : null;
  }

  // Check existing templates to avoid duplicates
  const { data: existing } = await supabase
    .from("close_task_templates")
    .select("name")
    .eq("organization_id", orgId);

  const existingNames = new Set((existing ?? []).map((t) => t.name));

  // ─── Template definitions ──────────────────────────────────────────
  const templates: {
    name: string;
    description: string;
    category: string;
    phase: number;
    source_module: string | null;
    default_role: string;
    relative_due_day: number;
    display_order: number;
    requires_reconciliation: boolean;
    entity_scope: string;
  }[] = [
    // ═══ PHASE 1: PRE-CLOSE ═══════════════════════════════════════════
    {
      name: "Send close calendar reminder",
      description: "Distribute the close calendar with deadlines to all department heads. Remind AP, operations, and sales teams of cutoff dates.",
      category: "Pre-Close",
      phase: 1,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 10,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Enforce AP invoice cutoff",
      description: "Communicate the AP cutoff date to all vendors and internal teams. All invoices for goods/services received in the current period must be submitted before close begins.",
      category: "Pre-Close",
      phase: 1,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 20,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Enforce AR billing cutoff in RentalWorks",
      description: "Ensure all rental contracts returning before period-end are checked in and invoiced in RentalWorks. Verify all billable orders have been invoiced (status = CLOSED).",
      category: "Pre-Close",
      phase: 1,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 30,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Confirm payroll processing complete",
      description: "Verify all pay runs for the period have been processed and finalized in Paylocity. Confirm no pending corrections or manual checks remain unposted.",
      category: "Pre-Close",
      phase: 1,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 40,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Verify QBO sync is current",
      description: "Run a final QBO sync for each entity to ensure all transactions posted through period-end are reflected. Confirm sync status shows no errors.",
      category: "Pre-Close",
      phase: 1,
      source_module: "tb",
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 50,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review open POs for period-end accruals",
      description: "Pull list of open purchase orders in RentalWorks and QBO. Identify goods/services received but not yet invoiced that require accrual entries.",
      category: "Pre-Close",
      phase: 1,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 60,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Collect credit card statements",
      description: "Download all corporate credit card statements for the period. Ensure all card transactions have been coded and submitted for approval.",
      category: "Pre-Close",
      phase: 1,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 0,
      display_order: 70,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ═══ PHASE 2: ADJUSTMENTS ═════════════════════════════════════════

    // ─── Revenue & AR ────────────────────────────────────────────────
    {
      name: "Review revenue recognition for rental contracts",
      description: "For contracts spanning period boundaries, verify revenue is recognized in the correct period. Post deferred revenue or unbilled revenue adjustments as needed.",
      category: "Revenue & AR",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 110,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Record bad debt allowance adjustment",
      description: "Based on the AR aging review, calculate and post adjustments to the allowance for doubtful accounts using a consistent methodology.",
      category: "Revenue & AR",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 130,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review and post rebate accruals",
      description: "For customers on tiered rebate agreements, calculate the rebate liability earned during the period. Post accrual to rebate expense and accrued rebates payable.",
      category: "Revenue & AR",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 160,
      requires_reconciliation: false,
      entity_scope: "VS",
    },

    // ─── AP & Expenses ───────────────────────────────────────────────
    {
      name: "Post AP accruals for received-not-invoiced items",
      description: "For goods/services received before period-end where the vendor invoice has not arrived, post accrual journal entries using open PO list as support.",
      category: "AP & Expenses",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 210,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Reverse prior month AP accruals",
      description: "Reverse all accrual journal entries posted in the prior month for received-not-invoiced items. Confirm actual vendor invoices have replaced the accruals.",
      category: "AP & Expenses",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 215,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review and code credit card transactions",
      description: "Ensure all corporate credit card transactions are coded to correct GL accounts with appropriate receipts/approvals. Post any unrecorded transactions.",
      category: "AP & Expenses",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 220,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review expense reports and employee reimbursements",
      description: "Confirm all employee expense reports for the period have been submitted, approved, and recorded in QBO. Accrue any known but unprocessed reimbursements.",
      category: "AP & Expenses",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 240,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review prepaid expense amortization",
      description: "Calculate and post monthly amortization for all prepaid expenses (insurance, subscriptions, prepaid rent). Verify the prepaid schedule ties to the GL balance.",
      category: "AP & Expenses",
      phase: 2,
      source_module: "schedules",
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 250,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Review and accrue utility and recurring expenses",
      description: "For recurring monthly expenses where the invoice has not arrived (utilities, telecom, janitorial), post accrual entries based on historical averages or known amounts.",
      category: "AP & Expenses",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 260,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ─── Payroll ─────────────────────────────────────────────────────
    {
      name: "Post Paylocity payroll journal entries",
      description: "Download payroll register and GL distribution from Paylocity. Post summarized journal entry to QBO, allocating wages, taxes, and benefits to correct entities/departments.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 300,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Accrue wages for partial pay periods",
      description: "If the period ends mid-pay-cycle, calculate and post an accrual for wages earned but not yet paid using Paylocity time data or salary proration.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 320,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Accrue employee benefits (health, dental, 401k)",
      description: "Post accruals for employer-paid benefits incurred but not yet billed (health insurance, dental, vision, 401k match). Reconcile to Paylocity deduction reports.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 330,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Accrue commissions",
      description: "Calculate commission expense earned by sales staff based on closed deals and rental revenue. Post accrual to commission expense and accrued commissions payable.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 340,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Accrue PTO / vacation liability",
      description: "Update accrued PTO liability based on current balances from Paylocity. Adjust for PTO earned minus PTO taken during the period.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 350,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review employee cost allocations across entities",
      description: "For employees whose costs are shared across entities, verify allocation percentages are current and intercompany charges are posted correctly.",
      category: "Payroll",
      phase: 2,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 370,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ─── Bank & Cash ─────────────────────────────────────────────────
    {
      name: "Record bank fees and interest income",
      description: "Post journal entries for bank service charges, wire fees, merchant processing fees, and interest income from bank statements not yet in QBO.",
      category: "Bank & Cash",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 420,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ─── Fixed Assets & Depreciation ─────────────────────────────────
    {
      name: "Record new rental equipment additions",
      description: "Review RentalWorks for new rental equipment purchased during the period. Capitalize in fixed asset register with correct cost, useful life, and depreciation method.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 500,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Record non-rental asset additions",
      description: "Review AP invoices for non-rental capital expenditures (vehicles, office equipment, leasehold improvements). Capitalize items exceeding the threshold.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 510,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Record asset disposals and retirements",
      description: "For equipment sold, scrapped, or retired during the period, remove the asset and accumulated depreciation. Record any gain or loss on disposal.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 520,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Run monthly depreciation",
      description: "Calculate and post monthly depreciation expense for all fixed asset categories. Use the asset register as support for the journal entry.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 530,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review vehicle classification and NCNT tagging",
      description: "Verify new vehicles are properly classified (vehicle type, NCNT cross-reference) per the tax depreciation schedule. Ensure consistency between book and tax records.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 550,
      requires_reconciliation: false,
      entity_scope: "ARH",
    },
    {
      name: "Review repair vs. capitalize decisions",
      description: "Review large repair and maintenance expenses to ensure proper classification. Items exceeding capitalization threshold that extend asset life should be capitalized.",
      category: "Fixed Assets & Depreciation",
      phase: 2,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 560,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },

    // ─── Intercompany ────────────────────────────────────────────────
    {
      name: "Record intercompany transactions",
      description: "Post all intercompany charges for the period: shared services, equipment transfers, management fees, and cost allocations between entities.",
      category: "Intercompany",
      phase: 2,
      source_module: "intercompany",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 600,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Post intercompany elimination entries",
      description: "Prepare and post elimination journal entries to remove intercompany revenue/expense and receivable/payable balances for consolidated reporting.",
      category: "Intercompany",
      phase: 2,
      source_module: "intercompany",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 640,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ─── Tax & Compliance ────────────────────────────────────────────
    {
      name: "Review property tax accruals",
      description: "Ensure monthly accruals for personal property tax (rental equipment fleet) and real property tax are current. Adjust when new assessments are received.",
      category: "Tax & Compliance",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 730,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review income tax provision (quarterly)",
      description: "On a quarterly basis, estimate the current income tax provision based on YTD taxable income. Post quarterly tax accrual. Monthly, verify accrual is tracking to plan.",
      category: "Tax & Compliance",
      phase: 2,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 740,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ═══ PHASE 3: RECONCILIATIONS ═════════════════════════════════════

    // ─── Revenue & AR ────────────────────────────────────────────────
    {
      name: "Reconcile RentalWorks invoices to QBO revenue",
      description: "Export RentalWorks invoice register (CLOSED invoices) and tie total revenue by category to QBO revenue accounts. Investigate all variances.",
      category: "Revenue & AR",
      phase: 3,
      source_module: "tb",
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 100,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },
    {
      name: "Review AR aging report",
      description: "Generate AR aging from QBO. Investigate balances over 90 days, confirm collection status, determine if bad debt write-offs or allowance adjustments are needed.",
      category: "Revenue & AR",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 120,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Reconcile customer deposits and retainers",
      description: "Verify customer deposits in the liability account tie to active contracts/orders. Reclassify deposits that should be recognized as revenue for completed rentals.",
      category: "Revenue & AR",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 140,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },
    {
      name: "Reconcile RentalWorks AR subledger to QBO AR",
      description: "Compare total open AR in RentalWorks to Accounts Receivable GL in QBO. Differences indicate unposted invoices, payments, or credit memos needing resolution.",
      category: "Revenue & AR",
      phase: 3,
      source_module: "tb",
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 150,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },

    // ─── AP & Expenses ───────────────────────────────────────────────
    {
      name: "Review AP aging and confirm completeness",
      description: "Generate AP aging from QBO. Verify all known vendor invoices received through period-end have been entered. Follow up on missing invoices from recurring vendors.",
      category: "AP & Expenses",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 1,
      display_order: 200,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Reconcile credit card statements to QBO",
      description: "Match each credit card statement balance to the corresponding QBO liability account. Investigate reconciling items and post missing transactions.",
      category: "AP & Expenses",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 230,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },

    // ─── Payroll ─────────────────────────────────────────────────────
    {
      name: "Reconcile Paylocity reports to QBO payroll expense",
      description: "Compare total gross wages, employer taxes, and benefits from Paylocity to QBO expense accounts. Investigate differences above materiality threshold.",
      category: "Payroll",
      phase: 3,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 310,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Reconcile payroll tax liabilities",
      description: "Verify payroll tax liability accounts in QBO (federal, state, FICA, FUTA, SUTA) tie to cumulative amounts from Paylocity. Clear tax payments made during period.",
      category: "Payroll",
      phase: 3,
      source_module: "payroll",
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 360,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },

    // ─── Bank & Cash ─────────────────────────────────────────────────
    {
      name: "Reconcile operating bank accounts",
      description: "Download bank statements for all operating accounts. Reconcile each to the corresponding QBO cash account, clearing outstanding checks and deposits in transit.",
      category: "Bank & Cash",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 400,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Reconcile payroll bank account",
      description: "Reconcile the dedicated payroll bank account to QBO. Verify all Paylocity ACH debits for net pay, taxes, and garnishments are recorded and cleared.",
      category: "Bank & Cash",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 2,
      display_order: 410,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Review outstanding checks over 90 days",
      description: "Identify outstanding checks over 90 days old on bank reconciliation. Investigate whether they should be voided, re-issued, or reclassified as unclaimed property.",
      category: "Bank & Cash",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 430,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Reconcile petty cash",
      description: "Count physical petty cash on hand and reconcile to QBO petty cash account. Post replenishment entries and verify all receipts are recorded.",
      category: "Bank & Cash",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 440,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },
    {
      name: "Review cash position and sweep accounts",
      description: "Review end-of-period cash balances across all accounts. Verify automated sweep/money market transfers are recorded and restricted cash is properly segregated.",
      category: "Bank & Cash",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 3,
      display_order: 450,
      requires_reconciliation: false,
      entity_scope: "ARH",
    },

    // ─── Fixed Assets & Depreciation ─────────────────────────────────
    {
      name: "Reconcile fixed asset subledger to QBO GL",
      description: "Compare net book value from fixed asset register (cost less accumulated depreciation) to QBO balance sheet accounts. Resolve any variances.",
      category: "Fixed Assets & Depreciation",
      phase: 3,
      source_module: "assets",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 540,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },

    // ─── Intercompany ────────────────────────────────────────────────
    {
      name: "Reconcile intercompany balances (ARH vs Versatile Studios)",
      description: "Compare IC receivable on ARH to IC payable on Versatile Studios. Both sides must agree before elimination.",
      category: "Intercompany",
      phase: 3,
      source_module: "intercompany",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 610,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },
    {
      name: "Reconcile intercompany balances (ARH vs Silverco)",
      description: "Compare IC receivable/payable between ARH and Silverco. Ensure both entities reflect matching offsetting balances before consolidation.",
      category: "Intercompany",
      phase: 3,
      source_module: "intercompany",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 620,
      requires_reconciliation: true,
      entity_scope: "ARH,SC",
    },
    {
      name: "Reconcile intercompany balances (Versatile Studios vs Silverco)",
      description: "If direct IC transactions exist between Versatile Studios and Silverco, reconcile those balances.",
      category: "Intercompany",
      phase: 3,
      source_module: "intercompany",
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 630,
      requires_reconciliation: true,
      entity_scope: "VS,SC",
    },
    {
      name: "Verify intercompany eliminations net to zero",
      description: "Confirm all intercompany accounts net to zero at the consolidated level after elimination entries. Any residual indicates an unresolved mismatch.",
      category: "Intercompany",
      phase: 3,
      source_module: "intercompany",
      default_role: "reviewer",
      relative_due_day: 5,
      display_order: 650,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },

    // ─── Tax & Compliance ────────────────────────────────────────────
    {
      name: "Reconcile sales tax collected to sales tax payable",
      description: "Compare sales tax collected per RentalWorks invoice data to sales tax payable liability in QBO. Reconcile by tax jurisdiction.",
      category: "Tax & Compliance",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 700,
      requires_reconciliation: true,
      entity_scope: "ARH,VS",
    },
    {
      name: "Review sales tax filing deadlines",
      description: "Identify sales tax returns due in the upcoming month. Confirm prior period returns were filed and payments cleared.",
      category: "Tax & Compliance",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 710,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Reconcile use tax on equipment purchases",
      description: "For out-of-state equipment purchases without sales tax charged, verify use tax has been self-assessed and recorded.",
      category: "Tax & Compliance",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 4,
      display_order: 720,
      requires_reconciliation: false,
      entity_scope: "ARH,VS",
    },
    {
      name: "Verify 1099 vendor tracking is current",
      description: "Review payments to 1099-eligible vendors during the period to ensure they are properly flagged in QBO for year-end reporting.",
      category: "Tax & Compliance",
      phase: 3,
      source_module: null,
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 750,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ═══ PHASE 4: REVIEW & REPORTING ══════════════════════════════════

    // ─── Financial Reporting ─────────────────────────────────────────
    {
      name: "Review adjusted trial balance",
      description: "After all adjusting entries, generate the adjusted trial balance. Verify debits = credits and balance sheet balances (A = L + E).",
      category: "Financial Reporting",
      phase: 4,
      source_module: "tb",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 800,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Run QBO-to-app sync (post-adjustments)",
      description: "Perform a final QBO sync to pull adjusted trial balance data into the accounting app. Verify all entities show current-period data with no sync errors.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "tb",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 810,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Prepare entity-level income statements",
      description: "Generate income statements for each entity. Compare to prior month, same month prior year, and budget for reasonableness.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 6,
      display_order: 820,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Prepare entity-level balance sheets",
      description: "Generate balance sheets for each entity. Verify A = L + E and review major account balances vs. prior month.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 6,
      display_order: 830,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Prepare consolidated financial statements",
      description: "Combine all entity data with IC eliminations to produce consolidated income statement, balance sheet, and cash flow statement.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 6,
      display_order: 840,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Prepare cash flow statement",
      description: "Generate statement of cash flows (indirect method). Reconcile ending cash to balance sheet and bank reconciliation totals.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 6,
      display_order: 850,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Perform budget-to-actual variance analysis",
      description: "Compare actual results to budget for each entity and consolidated. Document explanations for variances exceeding 10% or dollar materiality.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 7,
      display_order: 860,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Perform month-over-month trend analysis",
      description: "Review MoM changes in key accounts for unusual fluctuations. Document explanations for material changes and flag anomalies for management.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 7,
      display_order: 870,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Update KPI dashboard",
      description: "Calculate and update KPIs: DSO, DPO, fleet utilization, revenue per employee, EBITDA margin, and debt-to-equity ratio.",
      category: "Financial Reporting",
      phase: 4,
      source_module: "financial_statements",
      default_role: "preparer",
      relative_due_day: 7,
      display_order: 880,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },

    // ─── Management Review ───────────────────────────────────────────
    {
      name: "Debt schedule reconciliation",
      description: "Reconcile debt schedule (loans, LOC, equipment financing) to QBO liability accounts. Verify principal, accrued interest, and payment activity.",
      category: "Management Review",
      phase: 4,
      source_module: "debt",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 900,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Lease liability reconciliation",
      description: "Reconcile lease schedule (ASC 842) to QBO ROU asset and lease liability accounts. Verify monthly lease expense and liability amortization.",
      category: "Management Review",
      phase: 4,
      source_module: "leases",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 910,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Insurance schedule reconciliation",
      description: "Reconcile prepaid insurance and insurance expense accounts to the insurance schedule. Verify monthly premium amortization and new policies/renewals.",
      category: "Management Review",
      phase: 4,
      source_module: "schedules",
      default_role: "preparer",
      relative_due_day: 5,
      display_order: 920,
      requires_reconciliation: true,
      entity_scope: "ALL",
    },
    {
      name: "Controller review of all reconciliations",
      description: "Controller reviews all completed reconciliation workpapers for accuracy, completeness, and proper sign-off. Rejects workpapers with unresolved material variances.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 7,
      display_order: 930,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Review and post final adjusting journal entries",
      description: "Based on controller review, post final adjusting entries to correct misstatements, reclassifications, or omissions identified during review.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 8,
      display_order: 940,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Management financial review meeting",
      description: "Present monthly financial package (consolidated and entity P&L, balance sheet, cash flow, KPIs, variance analysis) to management. Document follow-ups.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 8,
      display_order: 950,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Run close gate checks",
      description: "Execute automated gate checks: verify all tasks approved, reconciliation variances within tolerance, TB balances, and IC eliminations net to zero.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 9,
      display_order: 960,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Soft-close the period",
      description: "Set period to soft-closed status, signaling financials are final but allowing late-breaking corrections with controller approval.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 9,
      display_order: 970,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Hard-close and lock the period",
      description: "After review window expires, set period to hard-closed/locked. Prevents further changes and creates immutable audit trail.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 10,
      display_order: 980,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
    {
      name: "Document close retrospective notes",
      description: "Record process improvements, issues encountered, and lessons learned. Track recurring bottlenecks to drive close cycle time reductions.",
      category: "Management Review",
      phase: 4,
      source_module: null,
      default_role: "reviewer",
      relative_due_day: 10,
      display_order: 990,
      requires_reconciliation: false,
      entity_scope: "ALL",
    },
  ];

  // Insert templates, skipping any that already exist by name
  const toInsert = templates
    .filter((t) => !existingNames.has(t.name))
    .map((t) => ({
      organization_id: orgId,
      name: t.name,
      description: t.description,
      category: t.category,
      phase: t.phase,
      source_module: t.source_module,
      default_role: t.default_role,
      relative_due_day: t.relative_due_day,
      display_order: t.display_order,
      requires_reconciliation: t.requires_reconciliation,
      entity_ids: scopeToEntityIds(t.entity_scope),
      is_active: true,
    }));

  if (toInsert.length === 0) {
    return NextResponse.json({
      message: "All templates already exist",
      existing: existingNames.size,
      inserted: 0,
    });
  }

  const { error } = await supabase
    .from("close_task_templates")
    .insert(toInsert);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    inserted: toInsert.length,
    skipped: templates.length - toInsert.length,
    total: templates.length,
    entities: entities.map((e) => ({ id: e.id, name: e.name, code: e.code })),
  });
}
