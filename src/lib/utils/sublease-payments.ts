// Sublease income schedule generation engine
// Generates monthly income rows from sublease terms, escalations, and recovery schedules

import type {
  SubleasePaymentType,
  EscalationType,
  EscalationFrequency,
} from "@/lib/types/database";

export interface SubleaseForPayments {
  commencement_date: string; // ISO date
  rent_commencement_date: string | null;
  expiration_date: string; // ISO date
  base_rent_monthly: number;
  cam_recovery_monthly: number;
  insurance_recovery_monthly: number;
  property_tax_recovery_monthly: number;
  utilities_recovery_monthly: number;
  other_recovery_monthly: number;
  rent_abatement_months: number;
  rent_abatement_amount: number;
}

export interface SubleaseEscalationRule {
  escalation_type: EscalationType;
  effective_date: string; // ISO date
  percentage_increase: number | null;
  amount_increase: number | null;
  frequency: EscalationFrequency;
}

export interface SubleasePaymentEntry {
  period_year: number;
  period_month: number;
  payment_type: SubleasePaymentType;
  scheduled_amount: number;
}

/**
 * Generate the full sublease income schedule from sublease terms and escalation rules.
 * Produces one row per month per income type from rent commencement to expiration.
 */
export function generateSubleasePaymentSchedule(
  sublease: SubleaseForPayments,
  escalations: SubleaseEscalationRule[]
): SubleasePaymentEntry[] {
  const entries: SubleasePaymentEntry[] = [];

  const startDate = parseDate(
    sublease.rent_commencement_date || sublease.commencement_date
  );
  const endDate = parseDate(sublease.expiration_date);

  if (!startDate || !endDate || startDate > endDate) return entries;

  // Sort escalations by effective date
  const sortedEscalations = [...escalations].sort(
    (a, b) =>
      new Date(a.effective_date).getTime() -
      new Date(b.effective_date).getTime()
  );

  let currentRent = sublease.base_rent_monthly;
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

    // Base rent income (with abatement)
    let rentAmount = currentRent;
    if (
      sublease.rent_abatement_months > 0 &&
      monthIndex < sublease.rent_abatement_months
    ) {
      rentAmount = sublease.rent_abatement_amount;
    }
    if (rentAmount !== 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "base_rent",
        scheduled_amount: round4(rentAmount),
      });
    }

    // CAM recovery
    if (sublease.cam_recovery_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "cam_recovery",
        scheduled_amount: round4(sublease.cam_recovery_monthly),
      });
    }

    // Property tax recovery
    if (sublease.property_tax_recovery_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "property_tax_recovery",
        scheduled_amount: round4(sublease.property_tax_recovery_monthly),
      });
    }

    // Insurance recovery
    if (sublease.insurance_recovery_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "insurance_recovery",
        scheduled_amount: round4(sublease.insurance_recovery_monthly),
      });
    }

    // Utilities recovery
    if (sublease.utilities_recovery_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "utilities_recovery",
        scheduled_amount: round4(sublease.utilities_recovery_monthly),
      });
    }

    // Other recovery
    if (sublease.other_recovery_monthly > 0) {
      entries.push({
        period_year: year,
        period_month: month,
        payment_type: "other_recovery",
        scheduled_amount: round4(sublease.other_recovery_monthly),
      });
    }

    monthIndex++;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return entries;
}

/**
 * Apply escalation rules that become effective in the given period.
 * Returns the new rent amount after applying matching escalations.
 */
function applyEscalations(
  currentRent: number,
  year: number,
  month: number,
  escalations: SubleaseEscalationRule[]
): number {
  let rent = currentRent;

  for (const esc of escalations) {
    const effDate = parseDate(esc.effective_date);
    if (!effDate) continue;

    const effYear = effDate.getFullYear();
    const effMonth = effDate.getMonth() + 1;

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
          // CPI-linked escalations require external index data — no-op for now
          break;
      }
    }
  }

  return rent;
}

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
