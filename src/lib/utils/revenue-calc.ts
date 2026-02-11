/**
 * Revenue accrual/deferral calculation utilities.
 *
 * For each rental contract we compare what was EARNED in the period
 * (pro-rated by calendar days) vs what was BILLED:
 *   - Accrual  = earned > billed  → recognise extra revenue
 *   - Deferral = billed > earned  → defer excess to future periods
 */

import {
  differenceInCalendarDays,
  max as dateMax,
  min as dateMin,
  startOfMonth,
  endOfMonth,
} from "date-fns";

export interface RentalRow {
  contractId: string;
  customerName: string;
  description: string;
  rentalStart: Date;
  rentalEnd: Date;
  totalContractValue: number;
  billedAmount: number;
}

export interface CalculatedLine {
  contractId: string;
  customerName: string;
  description: string;
  rentalStart: string; // ISO date
  rentalEnd: string;
  totalContractValue: number;
  dailyRate: number;
  daysInPeriod: number;
  earnedRevenue: number;
  billedAmount: number;
  accrualAmount: number;
  deferralAmount: number;
}

/**
 * Calculate revenue accrual/deferral for a single contract in a given period.
 */
export function calculateLine(
  row: RentalRow,
  periodYear: number,
  periodMonth: number
): CalculatedLine {
  const periodStart = startOfMonth(new Date(periodYear, periodMonth - 1));
  const periodEnd = endOfMonth(new Date(periodYear, periodMonth - 1));

  // Total rental days (inclusive of start and end)
  const totalDays =
    differenceInCalendarDays(row.rentalEnd, row.rentalStart) + 1;
  const dailyRate = totalDays > 0 ? row.totalContractValue / totalDays : 0;

  // Overlap of [rentalStart, rentalEnd] with [periodStart, periodEnd]
  const overlapStart = dateMax([row.rentalStart, periodStart]);
  const overlapEnd = dateMin([row.rentalEnd, periodEnd]);
  const daysInPeriod =
    overlapEnd >= overlapStart
      ? differenceInCalendarDays(overlapEnd, overlapStart) + 1
      : 0;

  const earnedRevenue = Math.round(dailyRate * daysInPeriod * 100) / 100;
  const diff = earnedRevenue - row.billedAmount;

  return {
    contractId: row.contractId,
    customerName: row.customerName,
    description: row.description,
    rentalStart: row.rentalStart.toISOString().split("T")[0],
    rentalEnd: row.rentalEnd.toISOString().split("T")[0],
    totalContractValue: row.totalContractValue,
    dailyRate: Math.round(dailyRate * 100) / 100,
    daysInPeriod,
    earnedRevenue,
    billedAmount: row.billedAmount,
    accrualAmount: diff > 0 ? Math.round(diff * 100) / 100 : 0,
    deferralAmount: diff < 0 ? Math.round(Math.abs(diff) * 100) / 100 : 0,
  };
}

/**
 * Calculate all lines and return totals.
 */
export function calculateAll(
  rows: RentalRow[],
  periodYear: number,
  periodMonth: number
) {
  const lines = rows.map((r) => calculateLine(r, periodYear, periodMonth));

  const totals = lines.reduce(
    (acc, l) => ({
      earned: acc.earned + l.earnedRevenue,
      billed: acc.billed + l.billedAmount,
      accrual: acc.accrual + l.accrualAmount,
      deferral: acc.deferral + l.deferralAmount,
    }),
    { earned: 0, billed: 0, accrual: 0, deferral: 0 }
  );

  return { lines, totals };
}
