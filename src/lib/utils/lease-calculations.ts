// ASC 842 lease calculation engine
// Handles operating & finance lease classification, ROU asset, lease liability,
// amortization schedules, and initial journal entries.

export type LeaseClassification = "operating" | "finance";

export interface LeaseForASC842 {
  lease_type: LeaseClassification;
  lease_term_months: number;
  discount_rate: number; // annual incremental borrowing rate as decimal (0.065 = 6.5%)
  commencement_date: string; // ISO date
  initial_direct_costs: number;
  lease_incentives_received: number;
  prepaid_rent: number;
  // Provide either a flat monthly amount or variable payments array
  base_rent_monthly: number;
  monthly_payments?: number[]; // length = lease_term_months, overrides base_rent_monthly if provided
}

export interface ASC842ScheduleEntry {
  period: number; // 1-indexed month
  period_year: number;
  period_month: number;
  // Lease liability (effective interest method)
  lease_liability_beginning: number;
  lease_payment: number;
  interest_expense: number;
  principal_reduction: number;
  lease_liability_ending: number;
  // ROU asset
  rou_asset_beginning: number;
  amortization_expense: number;
  rou_asset_ending: number;
  // Total periodic lease expense
  total_expense: number;
}

export interface ASC842Summary {
  lease_type: LeaseClassification;
  initial_lease_liability: number;
  initial_rou_asset: number;
  total_lease_cost: number;
  monthly_straight_line_expense: number; // operating: total/n; finance: n/a (varies)
  total_interest_expense: number;
  total_amortization_expense: number;
}

export interface JournalEntryLine {
  account: string;
  accountId?: string;
  amount: number;
}

export interface ASC842JournalEntry {
  date: string;
  description: string;
  debits: JournalEntryLine[];
  credits: JournalEntryLine[];
}

export interface LeaseAccountMapping {
  rouAssetAccountId?: string;
  leaseLiabilityAccountId?: string;
  leaseExpenseAccountId?: string;
  interestExpenseAccountId?: string;
  asc842AdjustmentAccountId?: string;
  cashApAccountId?: string;
}

// ---------------------------------------------------------------------------
// Present value calculation
// ---------------------------------------------------------------------------

/**
 * Calculate present value of a series of payments discounted at a monthly rate.
 * Payments are assumed to occur at the END of each period (ordinary annuity).
 */
function presentValue(payments: number[], monthlyRate: number): number {
  if (monthlyRate === 0) {
    return payments.reduce((sum, p) => sum + p, 0);
  }
  let pv = 0;
  for (let i = 0; i < payments.length; i++) {
    pv += payments[i] / Math.pow(1 + monthlyRate, i + 1);
  }
  return pv;
}

/**
 * Get the array of monthly payments for the lease term.
 * Uses monthly_payments if provided, otherwise fills with base_rent_monthly.
 */
function getPaymentsArray(lease: LeaseForASC842): number[] {
  if (lease.monthly_payments && lease.monthly_payments.length === lease.lease_term_months) {
    return lease.monthly_payments;
  }
  return Array(lease.lease_term_months).fill(lease.base_rent_monthly);
}

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Calculate initial lease liability = PV of future minimum lease payments.
 */
export function calculateLeaseLiability(lease: LeaseForASC842): number {
  if (lease.lease_term_months <= 0 || lease.discount_rate < 0) return 0;
  const payments = getPaymentsArray(lease);
  const monthlyRate = lease.discount_rate / 12;
  return round2(presentValue(payments, monthlyRate));
}

/**
 * Calculate initial ROU asset value.
 * ROU = Lease Liability + Initial Direct Costs + Prepaid Rent - Incentives Received
 */
export function calculateROUAsset(lease: LeaseForASC842): number {
  const liability = calculateLeaseLiability(lease);
  return round2(
    liability +
      lease.initial_direct_costs +
      lease.prepaid_rent -
      lease.lease_incentives_received
  );
}

/**
 * Generate full ASC 842 amortization schedule with summary.
 *
 * Operating lease:
 *   - Liability: effective interest method
 *   - Total expense: straight-line (total cost / n)
 *   - ROU amortization: plug = straight-line expense - interest expense
 *
 * Finance lease:
 *   - Liability: effective interest method (same as operating)
 *   - ROU amortization: straight-line over lease term
 *   - Total expense: interest + amortization (front-loaded)
 */
export function generateASC842Schedule(
  lease: LeaseForASC842
): { schedule: ASC842ScheduleEntry[]; summary: ASC842Summary } {
  const n = lease.lease_term_months;
  if (n <= 0) {
    return {
      schedule: [],
      summary: {
        lease_type: lease.lease_type,
        initial_lease_liability: 0,
        initial_rou_asset: 0,
        total_lease_cost: 0,
        monthly_straight_line_expense: 0,
        total_interest_expense: 0,
        total_amortization_expense: 0,
      },
    };
  }

  const payments = getPaymentsArray(lease);
  const monthlyRate = lease.discount_rate / 12;
  const initialLiability = calculateLeaseLiability(lease);
  const initialROU = calculateROUAsset(lease);
  const totalLeasePayments = payments.reduce((s, p) => s + p, 0);

  // For operating leases, total cost includes IDC + prepaid - incentives (already in ROU)
  // but the straight-line expense is based on total payments + IDC - incentives
  // ASC 842-20-25-6: single lease cost = total of lease payments + IDC - incentives
  const totalLeaseCost =
    totalLeasePayments +
    lease.initial_direct_costs -
    lease.lease_incentives_received;

  const straightLineExpense = totalLeaseCost / n;
  const financeAmortizationPerMonth = initialROU / n;

  // Parse commencement date for period labels
  const startDate = new Date(lease.commencement_date + "T00:00:00");
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth(); // 0-indexed

  const schedule: ASC842ScheduleEntry[] = [];
  let liabilityBalance = initialROU === 0 ? 0 : initialLiability;
  let rouBalance = initialROU;
  let totalInterest = 0;
  let totalAmortization = 0;

  for (let i = 0; i < n; i++) {
    const periodDate = new Date(startYear, startMonth + i, 1);
    const year = periodDate.getFullYear();
    const month = periodDate.getMonth() + 1; // 1-indexed

    const liabilityBeginning = round2(liabilityBalance);
    const rouBeginning = round2(rouBalance);
    const payment = payments[i];

    // Interest on liability (effective interest method)
    const interest = round2(liabilityBeginning * monthlyRate);
    const principal = round2(payment - interest);
    const liabilityEnding = round2(liabilityBeginning - principal);

    let amortization: number;
    let totalExpense: number;

    if (lease.lease_type === "operating") {
      // Operating: straight-line total expense, ROU amortization is plug
      totalExpense = round2(straightLineExpense);
      amortization = round2(totalExpense - interest);
    } else {
      // Finance: straight-line ROU amortization + interest
      amortization = round2(financeAmortizationPerMonth);
      totalExpense = round2(interest + amortization);
    }

    // Last period: force balances to zero to avoid rounding residuals
    let rouEnding: number;
    if (i === n - 1) {
      rouEnding = 0;
      amortization = round2(rouBeginning);
      if (lease.lease_type === "operating") {
        totalExpense = round2(amortization + interest);
      } else {
        totalExpense = round2(interest + amortization);
      }
    } else {
      rouEnding = round2(rouBeginning - amortization);
    }

    totalInterest += interest;
    totalAmortization += amortization;

    schedule.push({
      period: i + 1,
      period_year: year,
      period_month: month,
      lease_liability_beginning: liabilityBeginning,
      lease_payment: round2(payment),
      interest_expense: interest,
      principal_reduction: principal,
      lease_liability_ending: i === n - 1 ? 0 : liabilityEnding,
      rou_asset_beginning: rouBeginning,
      amortization_expense: amortization,
      rou_asset_ending: rouEnding,
      total_expense: totalExpense,
    });

    liabilityBalance = i === n - 1 ? 0 : liabilityEnding;
    rouBalance = rouEnding;
  }

  return {
    schedule,
    summary: {
      lease_type: lease.lease_type,
      initial_lease_liability: initialLiability,
      initial_rou_asset: initialROU,
      total_lease_cost: round2(totalLeaseCost),
      monthly_straight_line_expense: round2(straightLineExpense),
      total_interest_expense: round2(totalInterest),
      total_amortization_expense: round2(totalAmortization),
    },
  };
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

/**
 * Generate the initial recognition journal entries at commencement date.
 */
export function generateInitialJournalEntries(
  lease: LeaseForASC842,
  accounts?: LeaseAccountMapping
): ASC842JournalEntry[] {
  const liability = calculateLeaseLiability(lease);
  const rou = calculateROUAsset(lease);
  const entries: ASC842JournalEntry[] = [];

  if (liability === 0 && rou === 0) return entries;

  // Entry 1: Recognize ROU asset and lease liability
  const entry1: ASC842JournalEntry = {
    date: lease.commencement_date,
    description: "Initial recognition of ROU asset and lease liability",
    debits: [{ account: "ROU Asset", accountId: accounts?.rouAssetAccountId, amount: rou }],
    credits: [{ account: "Lease Liability", accountId: accounts?.leaseLiabilityAccountId, amount: liability }],
  };

  // If there are IDC, prepaid rent, or incentives, add offsetting entries
  const netCashAdjustment =
    lease.initial_direct_costs +
    lease.prepaid_rent -
    lease.lease_incentives_received;

  if (netCashAdjustment > 0) {
    entry1.credits.push({ account: "Cash", accountId: accounts?.cashApAccountId, amount: round2(netCashAdjustment) });
  } else if (netCashAdjustment < 0) {
    entry1.debits.push({
      account: "Cash",
      accountId: accounts?.cashApAccountId,
      amount: round2(Math.abs(netCashAdjustment)),
    });
  }

  entries.push(entry1);

  return entries;
}

/**
 * Generate a monthly journal entry from a schedule row.
 * Operating: Splits expense into cash rent (actual payment) and ASC 842
 *            non-cash adjustment (straight-line minus cash). Includes
 *            Lease Liability debit and Cash/AP credit for a balanced entry.
 * Finance:   Dr Interest Expense + Dr Amortization Expense + Dr Lease Liability,
 *            Cr ROU Asset + Cr Cash/AP.
 */
export function generateMonthlyJournalEntry(
  entry: ASC842ScheduleEntry,
  leaseType: LeaseClassification,
  accounts?: LeaseAccountMapping
): ASC842JournalEntry {
  const date = `${entry.period_year}-${String(entry.period_month).padStart(2, "0")}-01`;

  if (leaseType === "operating") {
    const asc842Adjustment = round2(entry.total_expense - entry.lease_payment);
    const debits: JournalEntryLine[] = [];
    const credits: JournalEntryLine[] = [];

    // Debit: Rent Expense (cash portion = actual payment)
    if (entry.lease_payment !== 0) {
      debits.push({
        account: "Rent Expense",
        accountId: accounts?.leaseExpenseAccountId,
        amount: entry.lease_payment,
      });
    }

    // Debit or Credit: ASC 842 Adjustment (non-cash straight-line difference)
    if (asc842Adjustment > 0) {
      debits.push({
        account: "ASC 842 Adjustment",
        accountId: accounts?.asc842AdjustmentAccountId,
        amount: asc842Adjustment,
      });
    } else if (asc842Adjustment < 0) {
      credits.push({
        account: "ASC 842 Adjustment",
        accountId: accounts?.asc842AdjustmentAccountId,
        amount: Math.abs(asc842Adjustment),
      });
    }

    // Debit: Lease Liability (principal reduction)
    if (entry.principal_reduction !== 0) {
      debits.push({
        account: "Lease Liability",
        accountId: accounts?.leaseLiabilityAccountId,
        amount: entry.principal_reduction,
      });
    }

    // Credit: ROU Asset (amortization)
    if (entry.amortization_expense !== 0) {
      credits.push({
        account: "ROU Asset",
        accountId: accounts?.rouAssetAccountId,
        amount: entry.amortization_expense,
      });
    }

    // Credit: Cash/AP (actual payment)
    if (entry.lease_payment !== 0) {
      credits.push({
        account: "Cash / AP",
        accountId: accounts?.cashApAccountId,
        amount: entry.lease_payment,
      });
    }

    return {
      date,
      description: `Period ${entry.period} operating lease expense`,
      debits,
      credits,
    };
  }

  // Finance lease: separate interest + amortization
  const debits: JournalEntryLine[] = [];
  const credits: JournalEntryLine[] = [];

  if (entry.interest_expense !== 0) {
    debits.push({
      account: "Interest Expense",
      accountId: accounts?.interestExpenseAccountId,
      amount: entry.interest_expense,
    });
  }

  if (entry.amortization_expense !== 0) {
    debits.push({
      account: "Amortization Expense",
      accountId: accounts?.leaseExpenseAccountId,
      amount: entry.amortization_expense,
    });
  }

  if (entry.principal_reduction !== 0) {
    debits.push({
      account: "Lease Liability",
      accountId: accounts?.leaseLiabilityAccountId,
      amount: entry.principal_reduction,
    });
  }

  if (entry.amortization_expense !== 0) {
    credits.push({
      account: "ROU Asset",
      accountId: accounts?.rouAssetAccountId,
      amount: entry.amortization_expense,
    });
  }

  if (entry.lease_payment !== 0) {
    credits.push({
      account: "Cash / AP",
      accountId: accounts?.cashApAccountId,
      amount: entry.lease_payment,
    });
  }

  return {
    date,
    description: `Period ${entry.period} finance lease expense`,
    debits,
    credits,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
