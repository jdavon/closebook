// Lease payment schedule generation engine
// Generates monthly payment rows from lease terms, escalations, and operating cost schedules

import type {
  PaymentType,
  EscalationType,
  EscalationFrequency,
  PropertyTaxFrequency,
} from "@/lib/types/database";

export interface LeaseForPayments {
  commencement_date: string; // ISO date
  rent_commencement_date: string | null; // ISO date, defaults to commencement_date
  expiration_date: string; // ISO date
  base_rent_monthly: number;
  cam_monthly: number;
  insurance_monthly: number;
  property_tax_annual: number;
  property_tax_frequency: PropertyTaxFrequency;
  utilities_monthly: number;
  other_monthly_costs: number;
  rent_abatement_months: number;
  rent_abatement_amount: number;
}

export interface EscalationRule {
  escalation_type: EscalationType;
  effective_date: string; // ISO date
  percentage_increase: number | null;
  amount_increase: number | null;
  frequency: EscalationFrequency;
}

export interface PaymentScheduleEntry {
  period_year: number;
  period_month: number;
  payment_type: PaymentType;
  scheduled_amount: number;
}

/**
 * Generate the full lease payment schedule from lease terms and escalation rules.
 * Produces one row per month per payment type from rent commencement to expiration.
 */
export function generateLeasePaymentSchedule(
  lease: LeaseForPayments,
  escalations: EscalationRule[]
): PaymentScheduleEntry[] {
  const entries: PaymentScheduleEntry[] = [];

  const startDate = parseDate(
    lease.rent_commencement_date || lease.commencement_date
  );
  const endDate = parseDate(lease.expiration_date);

  if (!startDate || !endDate || startDate > endDate) return entries;

  // Sort escalations by effective date for processing
  const sortedEscalations = [...escalations].sort(
    (a, b) =>
      new Date(a.effective_date).getTime() -
      new Date(b.effective_date).getTime()
  );

  let currentRent = lease.base_rent_monthly;
  let monthIndex = 0;

  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endCursor) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1; // 1-12

    // Apply escalations that become effective this period
    currentRent = applyEscalations(
      currentRent,
      year,
      month,
      sortedEscalations
    );

    // Base rent (with abatement)
    let rentAmount = currentRent;
    if (
      lease.rent_abatement_months > 0 &&
      monthIndex < lease.rent_abatement_months
    ) {
      rentAmount = lease.rent_abatement_amount;
    }
    if (rentAmount !== 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "base_rent",
        scheduled_amount: round4(rentAmount),
      });
    }

    // CAM
    if (lease.cam_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "cam",
        scheduled_amount: round4(lease.cam_monthly),
      });
    }

    // Insurance
    if (lease.insurance_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "insurance",
        scheduled_amount: round4(lease.insurance_monthly),
      });
    }

    // Property tax (frequency-dependent)
    if (lease.property_tax_annual > 0) {
      const taxAmount = getPropertyTaxAmount(
        lease.property_tax_annual,
        lease.property_tax_frequency,
        month
      );
      if (taxAmount > 0) {
        entries.push({
          period_year: year,
          period_month: month,
          payment_type: "property_tax",
          scheduled_amount: round4(taxAmount),
        });
      }
    }

    // Utilities
    if (lease.utilities_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "utilities",
        scheduled_amount: round4(lease.utilities_monthly),
      });
    }

    // Other costs
    if (lease.other_monthly_costs > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "other",
        scheduled_amount: round4(lease.other_monthly_costs),
      });
    }

    monthIndex++;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return entries;
}

/**
 * Apply escalation rules that become effective in the given period.
 * Returns the new rent amount after applying any matching escalations.
 */
function applyEscalations(
  currentRent: number,
  year: number,
  month: number,
  escalations: EscalationRule[]
): number {
  let rent = currentRent;

  for (const esc of escalations) {
    const effDate = parseDate(esc.effective_date);
    if (!effDate) continue;

    const effYear = effDate.getFullYear();
    const effMonth = effDate.getMonth() + 1;

    // Check if this escalation applies to this period
    if (effYear === year && effMonth === month) {
      switch (esc.escalation_type) {
        case "fixed_percentage":
          if (esc.percentage_increase != null) {
            rent = rent * (1 + esc.percentage_increase);
          }
          break;
        case "fixed_amount":
          if (esc.amount_increase != null) {
            rent = rent + esc.amount_increase;
          }
          break;
        case "cpi":
          // CPI-linked escalations require external index data
          // Phase 2 will implement actual CPI lookup; for now rent stays unchanged
          break;
      }
    }
  }

  return rent;
}

/**
 * Calculate the property tax payment for a given month based on frequency.
 * Monthly: 1/12 each month. Semi-annual: 1/2 in June and December. Annual: full in December.
 */
function getPropertyTaxAmount(
  annualAmount: number,
  frequency: PropertyTaxFrequency,
  month: number
): number {
  switch (frequency) {
    case "monthly":
      return annualAmount / 12;
    case "semi_annual":
      return month === 6 || month === 12 ? annualAmount / 2 : 0;
    case "annual":
      return month === 12 ? annualAmount : 0;
    default:
      return annualAmount / 12;
  }
}

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
