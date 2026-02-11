import { format, endOfMonth, startOfMonth, subMonths, addMonths } from "date-fns";

export function getPeriodLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return format(date, "MMMM yyyy");
}

export function getPeriodShortLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return format(date, "MMM yyyy");
}

export function getCurrentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function getPriorPeriod(
  year: number,
  month: number
): { year: number; month: number } {
  const date = subMonths(new Date(year, month - 1, 1), 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function getNextPeriod(
  year: number,
  month: number
): { year: number; month: number } {
  const date = addMonths(new Date(year, month - 1, 1), 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function getPeriodEndDate(year: number, month: number): Date {
  return endOfMonth(new Date(year, month - 1, 1));
}

export function getPeriodStartDate(year: number, month: number): Date {
  return startOfMonth(new Date(year, month - 1, 1));
}

export function computeDueDate(
  periodYear: number,
  periodMonth: number,
  relativeDueDay: number
): Date {
  // relativeDueDay = days after period end
  const periodEnd = getPeriodEndDate(periodYear, periodMonth);
  const dueDate = new Date(periodEnd);
  dueDate.setDate(dueDate.getDate() + relativeDueDay);
  return dueDate;
}

export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals: number = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
