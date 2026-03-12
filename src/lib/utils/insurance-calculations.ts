/**
 * Insurance Module — Calculation Engine
 *
 * Pure functions for insurance premium accruals, payment schedules,
 * entity allocations, renewal comparisons, and dashboard aggregation.
 *
 * Handles multiple payment term structures:
 *   - Annual (single lump-sum payment)
 *   - Monthly reporting (equal monthly payments)
 *   - Installment (down payment + N installments, parsed from description)
 *   - Daily rate (estimated monthly entries for auditable policies)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InsurancePolicyInput {
  id: string;
  policy_type: string;
  annual_premium: number;
  prior_year_premium: number;
  effective_date: string; // YYYY-MM-DD
  expiration_date: string; // YYYY-MM-DD
  payment_terms: string; // 'annual' | 'monthly_reporting' | 'installment' | 'daily_rate' | 'other'
  installment_description?: string; // e.g. "25% Down & 9 installments"
  is_auditable: boolean;
  status: string;
}

export interface PaymentScheduleEntry {
  period_month: number; // 1-12
  period_year: number;
  due_date: string; // YYYY-MM-DD
  amount_due: number;
  is_estimate: boolean;
}

export interface AllocationInput {
  target_entity_id: string;
  target_entity_name: string;
  allocation_method: string;
  allocation_pct: number; // 0-100
}

export interface ExposureInput {
  exposure_type: string;
  exposure_value: number;
  rate: number;
}

export interface ClaimSummary {
  open_count: number;
  total_reserved: number;
  total_paid: number;
  total_recovered: number;
  net_incurred: number; // reserved + paid - recovered
}

export interface PremiumAccrual {
  period_month: number;
  period_year: number;
  accrual_amount: number;
  cumulative_accrual: number;
  is_actual: boolean; // true if from actual payment, false if straight-line estimate
}

export interface AllocationResult {
  target_entity_id: string;
  target_entity_name: string;
  allocation_pct: number;
  allocated_amount: number;
}

export interface RenewalComparison {
  premium_change: number; // absolute
  premium_change_pct: number;
  direction: "increase" | "decrease" | "flat";
}

export interface DashboardSummary {
  total_annual_premium: number;
  total_prior_year_premium: number;
  premium_change_pct: number;
  active_policy_count: number;
  expiring_30_days: number;
  expiring_60_days: number;
  expiring_90_days: number;
  total_paid_ytd: number;
  total_remaining: number;
  open_claims_count: number;
  pending_subjectivities: number;
}

export interface TCORSummary {
  total_premiums: number;
  total_retained_losses: number; // claims paid under deductible/SIR
  total_admin_costs: number;
  total_cost_of_risk: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build a YYYY-MM-DD string from parts */
function toISODate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** Parse YYYY-MM-DD to { year, month, day } */
function parseDate(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** Add N months to a given year/month, returning the new year/month */
function addMonths(year: number, month: number, count: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Days between two dates (inclusive of start, exclusive of end) */
function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Installment Parsing ─────────────────────────────────────────────────────

/**
 * Parse installment description strings into structured terms.
 *
 * Handles formats like:
 *   "25% Down & 9 installments"
 *   "35% Down & 3 installments"
 *   "10% down and 10 installments"
 *
 * @returns Parsed terms or null if the string doesn't match
 */
export function parseInstallmentTerms(
  description: string
): { downPaymentPct: number; installmentCount: number } | null {
  if (!description) return null;

  // Match patterns: "NN% Down & NN installments" (case-insensitive)
  const match = description.match(
    /(\d+(?:\.\d+)?)\s*%\s*down\s*(?:&|and)\s*(\d+)\s*installment/i
  );
  if (!match) return null;

  const downPaymentPct = parseFloat(match[1]);
  const installmentCount = parseInt(match[2], 10);

  if (isNaN(downPaymentPct) || isNaN(installmentCount) || installmentCount <= 0) {
    return null;
  }

  return { downPaymentPct, installmentCount };
}

// ─── Payment Schedule ────────────────────────────────────────────────────────

/**
 * Generate the expected payment schedule for a policy based on its payment terms.
 *
 * - annual: single payment at effective date
 * - monthly_reporting: 12 equal monthly payments
 * - installment: down payment + N installments (parsed from description)
 * - daily_rate: 12 monthly estimate entries
 * - other: 12 equal monthly entries as estimates
 */
export function generatePaymentSchedule(
  policy: InsurancePolicyInput
): PaymentScheduleEntry[] {
  const { annual_premium, effective_date, payment_terms, installment_description } = policy;
  const start = parseDate(effective_date);
  const entries: PaymentScheduleEntry[] = [];

  switch (payment_terms) {
    case "annual": {
      entries.push({
        period_month: start.month,
        period_year: start.year,
        due_date: effective_date,
        amount_due: round2(annual_premium),
        is_estimate: false,
      });
      break;
    }

    case "monthly_reporting": {
      const monthly = round2(annual_premium / 12);
      for (let i = 0; i < 12; i++) {
        const { year, month } = addMonths(start.year, start.month, i);
        // Adjust last month for rounding remainder
        const amount = i < 11 ? monthly : round2(annual_premium - monthly * 11);
        entries.push({
          period_month: month,
          period_year: year,
          due_date: toISODate(year, month, 15),
          amount_due: amount,
          is_estimate: false,
        });
      }
      break;
    }

    case "installment": {
      const terms = parseInstallmentTerms(installment_description ?? "");
      if (!terms) {
        // Fallback: treat as 12 equal monthly payments
        const monthly = round2(annual_premium / 12);
        for (let i = 0; i < 12; i++) {
          const { year, month } = addMonths(start.year, start.month, i);
          const amount = i < 11 ? monthly : round2(annual_premium - monthly * 11);
          entries.push({
            period_month: month,
            period_year: year,
            due_date: toISODate(year, month, 15),
            amount_due: amount,
            is_estimate: true,
          });
        }
        break;
      }

      const downAmount = round2(annual_premium * (terms.downPaymentPct / 100));
      const remainder = round2(annual_premium - downAmount);
      const installmentAmount = round2(remainder / terms.installmentCount);

      // Down payment — due at effective date
      entries.push({
        period_month: start.month,
        period_year: start.year,
        due_date: effective_date,
        amount_due: downAmount,
        is_estimate: false,
      });

      // Installments — starting one month after effective date
      for (let i = 0; i < terms.installmentCount; i++) {
        const { year, month } = addMonths(start.year, start.month, i + 1);
        // Last installment absorbs rounding remainder
        const amount =
          i < terms.installmentCount - 1
            ? installmentAmount
            : round2(remainder - installmentAmount * (terms.installmentCount - 1));
        entries.push({
          period_month: month,
          period_year: year,
          due_date: toISODate(year, month, 15),
          amount_due: amount,
          is_estimate: false,
        });
      }
      break;
    }

    case "daily_rate": {
      // Auditable policies: estimate monthly based on annual / 12
      const monthly = round2(annual_premium / 12);
      for (let i = 0; i < 12; i++) {
        const { year, month } = addMonths(start.year, start.month, i);
        const amount = i < 11 ? monthly : round2(annual_premium - monthly * 11);
        entries.push({
          period_month: month,
          period_year: year,
          due_date: toISODate(year, month, 15),
          amount_due: amount,
          is_estimate: true,
        });
      }
      break;
    }

    default: {
      // 'other' or unrecognized — default to 12 monthly estimates
      const monthly = round2(annual_premium / 12);
      for (let i = 0; i < 12; i++) {
        const { year, month } = addMonths(start.year, start.month, i);
        const amount = i < 11 ? monthly : round2(annual_premium - monthly * 11);
        entries.push({
          period_month: month,
          period_year: year,
          due_date: toISODate(year, month, 15),
          amount_due: amount,
          is_estimate: true,
        });
      }
      break;
    }
  }

  return entries;
}

// ─── Premium Accruals ────────────────────────────────────────────────────────

/**
 * Calculate monthly premium accrual entries for the policy period.
 *
 * - Monthly reporting / daily rate: accrual matches actual payment amounts
 * - Annual / installment: straight-line monthly accrual (annual / 12)
 *   regardless of when cash payments occur
 */
export function calculatePremiumAccruals(
  policy: InsurancePolicyInput,
  payments: PaymentScheduleEntry[]
): PremiumAccrual[] {
  const { annual_premium, payment_terms } = policy;
  const start = parseDate(policy.effective_date);
  const accruals: PremiumAccrual[] = [];
  let cumulative = 0;

  const useActual = payment_terms === "monthly_reporting" || payment_terms === "daily_rate";

  for (let i = 0; i < 12; i++) {
    const { year, month } = addMonths(start.year, start.month, i);

    let accrualAmount: number;
    let isActual: boolean;

    if (useActual) {
      // Use actual payment amount for the period
      const payment = payments.find(
        (p) => p.period_month === month && p.period_year === year
      );
      accrualAmount = payment ? payment.amount_due : 0;
      isActual = !!payment && !payment.is_estimate;
    } else {
      // Straight-line: spread evenly regardless of payment timing
      const monthly = round2(annual_premium / 12);
      // Last month absorbs rounding remainder
      accrualAmount = i < 11 ? monthly : round2(annual_premium - monthly * 11);
      isActual = false;
    }

    cumulative = round2(cumulative + accrualAmount);

    accruals.push({
      period_month: month,
      period_year: year,
      accrual_amount: round2(accrualAmount),
      cumulative_accrual: cumulative,
      is_actual: isActual,
    });
  }

  return accruals;
}

// ─── Entity Allocations ──────────────────────────────────────────────────────

/**
 * Distribute a premium amount across entities based on allocation percentages.
 *
 * Validates that percentages sum to 100. If they fall short or exceed due to
 * rounding, adjusts the last entity to absorb the difference.
 */
export function calculateAllocations(
  annual_premium: number,
  allocations: AllocationInput[]
): AllocationResult[] {
  if (allocations.length === 0) return [];

  const results: AllocationResult[] = allocations.map((a) => ({
    target_entity_id: a.target_entity_id,
    target_entity_name: a.target_entity_name,
    allocation_pct: a.allocation_pct,
    allocated_amount: round2(annual_premium * (a.allocation_pct / 100)),
  }));

  // Adjust last entity so total allocated equals the annual premium exactly
  const allocatedTotal = results.reduce((sum, r) => sum + r.allocated_amount, 0);
  const diff = round2(annual_premium - allocatedTotal);
  if (diff !== 0 && results.length > 0) {
    results[results.length - 1].allocated_amount = round2(
      results[results.length - 1].allocated_amount + diff
    );
  }

  return results;
}

// ─── Exposure Premium ────────────────────────────────────────────────────────

/**
 * Calculate estimated premium from exposure data.
 *
 * Different exposure types use different rate bases:
 *   - vehicle_count: rate is monthly per vehicle → annualized (* 12)
 *   - square_footage: rate is annual per sqft
 *   - payroll: rate per $100 of payroll
 *   - revenue: rate per $1,000 of revenue
 *   - All others: simple value * rate
 */
export function calculateExposurePremium(exposure: ExposureInput): number {
  const { exposure_type, exposure_value, rate } = exposure;

  switch (exposure_type) {
    case "vehicle_count":
      // Rate is monthly per vehicle
      return round2(exposure_value * rate * 12);

    case "square_footage":
      // Rate is annual per sqft
      return round2(exposure_value * rate);

    case "payroll":
      // Rate per $100 of payroll
      return round2((exposure_value / 100) * rate);

    case "revenue":
      // Rate per $1,000 of revenue
      return round2((exposure_value / 1000) * rate);

    default:
      return round2(exposure_value * rate);
  }
}

// ─── Renewal Comparison ──────────────────────────────────────────────────────

/**
 * Compare current premium to prior year and return the change metrics.
 */
export function calculateRenewalComparison(
  current: number,
  prior: number
): RenewalComparison {
  const change = round2(current - prior);
  const changePct = prior !== 0 ? round2((change / prior) * 100) : 0;

  let direction: RenewalComparison["direction"];
  if (change > 0) direction = "increase";
  else if (change < 0) direction = "decrease";
  else direction = "flat";

  return {
    premium_change: change,
    premium_change_pct: changePct,
    direction,
  };
}

// ─── Dashboard Summary ───────────────────────────────────────────────────────

/**
 * Aggregate all policy data into dashboard summary metrics.
 *
 * @param policies - All insurance policies
 * @param payments - Payment records with amount_paid and amount_due
 * @param claims - Claim records (only status field needed)
 * @param subjectivities - Subjectivity records (only status field needed)
 * @param today - Override date for testing (defaults to current date)
 */
export function calculateDashboardSummary(
  policies: InsurancePolicyInput[],
  payments: { policy_id: string; amount_paid: number; amount_due: number }[],
  claims: { status: string }[],
  subjectivities: { status: string }[],
  today?: string
): DashboardSummary {
  const now = today ? new Date(today) : new Date();

  // Active policies only
  const activePolicies = policies.filter((p) => p.status === "active");

  // Total premiums
  const totalAnnual = round2(
    activePolicies.reduce((sum, p) => sum + p.annual_premium, 0)
  );
  const totalPrior = round2(
    activePolicies.reduce((sum, p) => sum + p.prior_year_premium, 0)
  );
  const changePct = totalPrior !== 0 ? round2(((totalAnnual - totalPrior) / totalPrior) * 100) : 0;

  // Expiration buckets
  const addDays = (d: Date, n: number) => {
    const result = new Date(d);
    result.setDate(result.getDate() + n);
    return result;
  };

  const d30 = addDays(now, 30);
  const d60 = addDays(now, 60);
  const d90 = addDays(now, 90);

  let exp30 = 0;
  let exp60 = 0;
  let exp90 = 0;

  for (const p of activePolicies) {
    const expDate = new Date(p.expiration_date);
    if (expDate >= now && expDate <= d30) exp30++;
    else if (expDate > d30 && expDate <= d60) exp60++;
    else if (expDate > d60 && expDate <= d90) exp90++;
  }

  // Payment totals
  const totalPaid = round2(payments.reduce((sum, p) => sum + p.amount_paid, 0));
  const totalDue = round2(payments.reduce((sum, p) => sum + p.amount_due, 0));
  const totalRemaining = round2(totalDue - totalPaid);

  // Claims
  const openClaims = claims.filter(
    (c) => c.status === "open" || c.status === "pending"
  ).length;

  // Subjectivities
  const pendingSubs = subjectivities.filter(
    (s) => s.status === "pending" || s.status === "open"
  ).length;

  return {
    total_annual_premium: totalAnnual,
    total_prior_year_premium: totalPrior,
    premium_change_pct: changePct,
    active_policy_count: activePolicies.length,
    expiring_30_days: exp30,
    expiring_60_days: exp60,
    expiring_90_days: exp90,
    total_paid_ytd: totalPaid,
    total_remaining: totalRemaining,
    open_claims_count: openClaims,
    pending_subjectivities: pendingSubs,
  };
}

// ─── Total Cost of Risk (TCOR) ───────────────────────────────────────────────

/**
 * Calculate the total cost of risk.
 *
 * TCOR = Premiums + Retained Losses + Admin Costs
 */
export function calculateTCOR(
  premiums: number,
  retainedLosses: number,
  adminCosts: number
): TCORSummary {
  return {
    total_premiums: round2(premiums),
    total_retained_losses: round2(retainedLosses),
    total_admin_costs: round2(adminCosts),
    total_cost_of_risk: round2(premiums + retainedLosses + adminCosts),
  };
}

// ─── Display Formatting ──────────────────────────────────────────────────────

/** Policy type display name mapping */
const POLICY_TYPE_LABELS: Record<string, string> = {
  general_liability: "General Liability",
  auto_liability: "Auto Liability",
  auto_physical_damage: "Auto Physical Damage",
  workers_compensation: "Workers' Compensation",
  property: "Property",
  umbrella: "Umbrella / Excess",
  management_liability: "Management Liability",
  epli: "Employment Practices",
  cyber: "Cyber Liability",
  crime: "Crime / Fidelity",
  inland_marine: "Inland Marine",
  professional_liability: "Professional Liability",
  pollution: "Pollution Liability",
  hired_non_owned_auto: "Hired & Non-Owned Auto",
  equipment_floater: "Equipment Floater",
};

/**
 * Convert snake_case policy types to display names.
 *
 * Falls back to title-casing the snake_case string if not in the lookup table.
 */
export function formatPolicyType(type: string): string {
  if (POLICY_TYPE_LABELS[type]) return POLICY_TYPE_LABELS[type];

  // Fallback: title-case the snake_case
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Policy type → color class mapping for UI badges */
const POLICY_TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 text-blue-800",
  auto_liability: "bg-orange-100 text-orange-800",
  auto_physical_damage: "bg-orange-100 text-orange-800",
  workers_compensation: "bg-red-100 text-red-800",
  property: "bg-green-100 text-green-800",
  umbrella: "bg-purple-100 text-purple-800",
  management_liability: "bg-indigo-100 text-indigo-800",
  epli: "bg-pink-100 text-pink-800",
  cyber: "bg-cyan-100 text-cyan-800",
  crime: "bg-yellow-100 text-yellow-800",
  inland_marine: "bg-teal-100 text-teal-800",
  professional_liability: "bg-violet-100 text-violet-800",
  pollution: "bg-lime-100 text-lime-800",
  hired_non_owned_auto: "bg-amber-100 text-amber-800",
  equipment_floater: "bg-emerald-100 text-emerald-800",
};

/**
 * Return a Tailwind color class string for a given policy type.
 *
 * Falls back to a neutral gray if the type is not in the lookup table.
 */
export function getPolicyTypeColor(type: string): string {
  return POLICY_TYPE_COLORS[type] ?? "bg-gray-100 text-gray-800";
}
