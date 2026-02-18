// Amortization calculation engine for debt instruments
// Supports term loans (standard amortization) and lines of credit (interest-only)

export interface DebtForAmortization {
  debt_type: "term_loan" | "line_of_credit";
  original_amount: number;
  interest_rate: number; // annual rate as decimal (e.g. 0.065 = 6.5%)
  term_months: number | null;
  start_date: string; // ISO date
  payment_amount: number | null;
  credit_limit: number | null;
  current_draw: number | null;
}

export interface AmortizationEntry {
  period_year: number;
  period_month: number;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
}

function parseDate(dateStr: string): { year: number; month: number } {
  const d = new Date(dateStr);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Calculate the fixed monthly payment for a term loan using the standard
 * amortization formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
 */
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate <= 0) {
    // Zero-interest loan — simple division
    return Math.round((principal / termMonths) * 100) / 100;
  }

  const r = annualRate / 12;
  const factor = Math.pow(1 + r, termMonths);
  const payment = principal * (r * factor) / (factor - 1);
  return Math.round(payment * 100) / 100;
}

/**
 * Generate the full amortization schedule for a debt instrument
 * from its start date through the specified period.
 *
 * For term loans: standard amortizing schedule with fixed monthly payments.
 * For lines of credit: interest-only on current draw each period.
 */
export function generateAmortizationSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number
): AmortizationEntry[] {
  if (debt.debt_type === "line_of_credit") {
    return generateLOCSchedule(debt, throughYear, throughMonth);
  }

  return generateTermLoanSchedule(debt, throughYear, throughMonth);
}

function generateTermLoanSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const termMonths = debt.term_months ?? 60;
  const monthlyRate = debt.interest_rate / 12;

  const monthlyPayment =
    debt.payment_amount ?? calculateMonthlyPayment(debt.original_amount, debt.interest_rate, termMonths);

  let balance = debt.original_amount;
  let cy = start.year;
  let cm = start.month;

  for (let i = 0; i < termMonths; i++) {
    // Stop if we've passed the target period
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;
    // Stop if fully paid
    if (balance <= 0) break;

    const interest = Math.round(balance * monthlyRate * 100) / 100;
    // On the final payment, cap to remaining balance + interest
    const payment = Math.min(monthlyPayment, balance + interest);
    const principal = Math.round((payment - interest) * 100) / 100;
    const endingBalance = Math.round(Math.max(0, balance - principal) * 100) / 100;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: Math.round(balance * 100) / 100,
      payment: Math.round(payment * 100) / 100,
      principal,
      interest,
      ending_balance: endingBalance,
    });

    balance = endingBalance;

    cm++;
    if (cm > 12) {
      cm = 1;
      cy++;
    }
  }

  return entries;
}

function generateLOCSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const balance = debt.current_draw ?? 0;
  const monthlyRate = debt.interest_rate / 12;

  if (balance <= 0) return entries;

  let cy = start.year;
  let cm = start.month;

  // Generate 12 months of interest-only payments (or until throughYear/throughMonth)
  for (let i = 0; i < 120; i++) {
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;

    const interest = Math.round(balance * monthlyRate * 100) / 100;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: Math.round(balance * 100) / 100,
      payment: interest,
      principal: 0,
      interest,
      ending_balance: Math.round(balance * 100) / 100,
    });

    cm++;
    if (cm > 12) {
      cm = 1;
      cy++;
    }
  }

  return entries;
}
