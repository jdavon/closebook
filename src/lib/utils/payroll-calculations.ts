/**
 * Payroll Accrual Calculation Engine
 *
 * Pure functions for computing wage accruals and employer payroll tax estimates.
 * All employees are employed by Silverco — costs are allocated to operating
 * entities via cost center assignments.
 *
 * Wage accrual: pro-rata from last pay date to period end based on annual comp.
 * Tax accrual: per-employee, respecting annual wage base caps and YTD wages.
 */

import type { Employee, PayStatementSummary } from "@/lib/paylocity/types";
import {
  getOperatingEntityForCostCenter,
  EMPLOYING_ENTITY_ID,
  type CostCenterEntry,
} from "@/lib/paylocity/cost-center-config";

/** Employee with optional companyId tag for multi-company cost center resolution */
type TaggedEmployee = Employee & { _companyId?: string };

// ─── Constants ───────────────────────────────────────────────────────

/** Standard working days per year (5 days × 52 weeks) */
const WORKING_DAYS_PER_YEAR = 260;

/** Calendar days per year */
const CALENDAR_DAYS_PER_YEAR = 365;

/** Default weekly hours for hourly employees */
const DEFAULT_WEEKLY_HOURS = 40;

// ─── Employer Payroll Tax Rates (2026) ───────────────────────────────

export const TAX_RATES = {
  FICA_SS: { rate: 0.062, cap: 176100, label: "FICA Social Security" },
  MEDICARE: { rate: 0.0145, cap: Infinity, label: "Medicare" },
  FUTA: { rate: 0.006, cap: 7000, label: "FUTA" },
  CA_SUI: { rate: 0.034, cap: 7000, label: "CA SUI" },
  CA_ETT: { rate: 0.001, cap: 7000, label: "CA ETT" },
  CA_SDI: { rate: 0.011, cap: 145600, label: "CA SDI" },
} as const;

// ─── Types ───────────────────────────────────────────────────────────

export interface EmployeeAccrualInput {
  employee: Employee;
  /** YTD gross wages from pay statements (for tax cap calculations) */
  ytdGrossWages: number;
  /** Last check date (ISO string) — accrual period starts day after this */
  lastCheckDate: string | null;
  /** Most recent pay statement for reference */
  lastPayStatement?: PayStatementSummary;
}

export interface AccrualLineItem {
  /** Operating entity that bears this cost */
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  /** Employing entity (always Silverco) */
  employingEntityId: string;
  /** Accrual type */
  type: "wages" | "payroll_tax" | "pto";
  /** Human-readable description */
  description: string;
  /** Dollar amount */
  amount: number;
  /** Breakdown details */
  details?: Record<string, number>;
}

export interface EmployeeAccrualResult {
  employeeId: string;
  employeeName: string;
  department: string;
  costCenterCode: string;
  costCenterEntry: CostCenterEntry;
  annualComp: number;
  dailyRate: number;
  accrualDays: number;
  wageAccrual: number;
  taxAccrual: number;
  taxBreakdown: Record<string, number>;
}

export interface AccrualResult {
  /** Period being accrued */
  periodYear: number;
  periodMonth: number;
  periodEndDate: string;
  /** Summary totals */
  totalWageAccrual: number;
  totalTaxAccrual: number;
  totalAccrual: number;
  employeeCount: number;
  /** Line items grouped by operating entity (for journal entries) */
  lineItems: AccrualLineItem[];
  /** Per-employee detail */
  employeeDetails: EmployeeAccrualResult[];
  /** Errors/warnings encountered */
  warnings: string[];
}

// ─── Working Day Helpers ─────────────────────────────────────────────

/**
 * Count business days (Mon-Fri) between two dates, inclusive of both.
 */
export function countWorkingDays(startDate: Date, endDate: Date): number {
  if (endDate < startDate) return 0;

  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Get the last day of a month.
 */
export function getMonthEndDate(year: number, month: number): Date {
  return new Date(year, month, 0); // month is 1-based, day 0 = last day of prev month
}

/**
 * Parse an ISO date string to a Date at midnight local time.
 */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ─── Annual Compensation ─────────────────────────────────────────────

/**
 * Calculate annualized compensation from employee pay rate data.
 */
export function getAnnualComp(employee: Employee): number {
  const payRate = employee.currentPayRate;
  if (!payRate) return 0;

  if (payRate.annualSalary && payRate.annualSalary > 0) {
    return payRate.annualSalary;
  }

  if (payRate.payType === "Hourly" && payRate.baseRate) {
    const weeklyHours = payRate.defaultHours ?? DEFAULT_WEEKLY_HOURS;
    return payRate.baseRate * weeklyHours * 52;
  }

  if (payRate.salary && payRate.salary > 0) {
    return payRate.salary;
  }

  if (payRate.baseRate && payRate.baseRate > 0) {
    return payRate.baseRate * DEFAULT_WEEKLY_HOURS * 52;
  }

  return 0;
}

// ─── Employer Tax Calculation ────────────────────────────────────────

/**
 * Calculate employer payroll taxes on a wage amount, considering YTD wages
 * already paid (to correctly handle wage base caps).
 *
 * @param wageAmount - The accrued wages for this period
 * @param ytdGrossWages - YTD gross wages already paid before this period
 * @returns Tax amount and breakdown by component
 */
export function calculateEmployerTaxes(
  wageAmount: number,
  ytdGrossWages: number
): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;

  for (const [key, { rate, cap, label }] of Object.entries(TAX_RATES)) {
    let taxableWages: number;

    if (cap === Infinity) {
      taxableWages = wageAmount;
    } else {
      // How much of the cap is remaining after YTD wages
      const remaining = Math.max(0, cap - ytdGrossWages);
      taxableWages = Math.min(wageAmount, remaining);
    }

    const tax = round(taxableWages * rate);
    breakdown[key] = tax;
    total += tax;
  }

  return { total: round(total), breakdown };
}

// ─── Main Accrual Calculator ─────────────────────────────────────────

/**
 * Calculate payroll accruals for a given period.
 *
 * For each employee:
 * 1. Determine daily wage rate from annual comp
 * 2. Count working days from day after last pay date through period end
 * 3. Calculate accrued wages
 * 4. Calculate employer payroll taxes on accrued wages (respecting caps)
 * 5. Group by operating entity via cost center assignment
 *
 * @param inputs - Array of employee data with YTD wages and last check dates
 * @param periodYear - Accrual period year
 * @param periodMonth - Accrual period month (1-12)
 */
export function calculateAccruals(
  inputs: EmployeeAccrualInput[],
  periodYear: number,
  periodMonth: number
): AccrualResult {
  const periodEnd = getMonthEndDate(periodYear, periodMonth);
  const periodEndStr = formatDate(periodEnd);
  const warnings: string[] = [];
  const employeeDetails: EmployeeAccrualResult[] = [];

  // Aggregate by operating entity
  const entityWages: Record<string, { entry: CostCenterEntry; wages: number; taxes: number; taxBreakdown: Record<string, number> }> = {};

  for (const input of inputs) {
    const { employee, ytdGrossWages, lastCheckDate } = input;

    // Skip employees with no pay data
    const annualComp = getAnnualComp(employee);
    if (annualComp <= 0) {
      warnings.push(`${employee.displayName} (${employee.id}): no compensation data, skipped`);
      continue;
    }

    // Daily rate based on working days
    const dailyRate = annualComp / WORKING_DAYS_PER_YEAR;

    // Determine accrual start date (day after last check date, or period start)
    let accrualStart: Date;
    if (lastCheckDate) {
      accrualStart = parseDate(lastCheckDate);
      accrualStart.setDate(accrualStart.getDate() + 1);
    } else {
      // No pay statement found — accrue from start of month
      accrualStart = new Date(periodYear, periodMonth - 1, 1);
    }

    // Count working days in accrual window
    const accrualDays = countWorkingDays(accrualStart, periodEnd);
    if (accrualDays <= 0) continue;

    // Calculate wage accrual
    const wageAccrual = round(dailyRate * accrualDays);

    // Calculate employer payroll taxes
    const { total: taxAccrual, breakdown: taxBreakdown } = calculateEmployerTaxes(
      wageAccrual,
      ytdGrossWages
    );

    // Map to operating entity (company-scoped for correct cost center resolution)
    const costCenterCode = employee.position?.costCenter1 ?? null;
    const costCenterEntry = getOperatingEntityForCostCenter(
      costCenterCode,
      (employee as TaggedEmployee)._companyId
    );

    // Accumulate by entity
    const entityKey = costCenterEntry.operatingEntityId;
    if (!entityWages[entityKey]) {
      entityWages[entityKey] = {
        entry: costCenterEntry,
        wages: 0,
        taxes: 0,
        taxBreakdown: {},
      };
    }
    entityWages[entityKey].wages += wageAccrual;
    entityWages[entityKey].taxes += taxAccrual;

    // Merge tax breakdown
    for (const [taxKey, taxAmount] of Object.entries(taxBreakdown)) {
      entityWages[entityKey].taxBreakdown[taxKey] =
        (entityWages[entityKey].taxBreakdown[taxKey] || 0) + taxAmount;
    }

    employeeDetails.push({
      employeeId: employee.id,
      employeeName: employee.displayName,
      department: costCenterEntry.department,
      costCenterCode: costCenterCode ?? "UNKNOWN",
      costCenterEntry,
      annualComp,
      dailyRate: round(dailyRate),
      accrualDays,
      wageAccrual,
      taxAccrual,
      taxBreakdown,
    });
  }

  // Build line items
  const lineItems: AccrualLineItem[] = [];
  let totalWageAccrual = 0;
  let totalTaxAccrual = 0;

  for (const [, data] of Object.entries(entityWages)) {
    const wages = round(data.wages);
    const taxes = round(data.taxes);

    if (wages > 0) {
      lineItems.push({
        operatingEntityId: data.entry.operatingEntityId,
        operatingEntityCode: data.entry.operatingEntityCode,
        operatingEntityName: data.entry.operatingEntityName,
        employingEntityId: EMPLOYING_ENTITY_ID,
        type: "wages",
        description: `Accrued wages — ${data.entry.operatingEntityName}`,
        amount: wages,
      });
    }

    if (taxes > 0) {
      // Round each breakdown component
      const roundedBreakdown: Record<string, number> = {};
      for (const [k, v] of Object.entries(data.taxBreakdown)) {
        roundedBreakdown[k] = round(v);
      }

      lineItems.push({
        operatingEntityId: data.entry.operatingEntityId,
        operatingEntityCode: data.entry.operatingEntityCode,
        operatingEntityName: data.entry.operatingEntityName,
        employingEntityId: EMPLOYING_ENTITY_ID,
        type: "payroll_tax",
        description: `Employer payroll taxes — ${data.entry.operatingEntityName}`,
        amount: taxes,
        details: roundedBreakdown,
      });
    }

    totalWageAccrual += wages;
    totalTaxAccrual += taxes;
  }

  // Sort line items: wages first, then taxes, grouped by entity
  lineItems.sort((a, b) => {
    if (a.operatingEntityCode !== b.operatingEntityCode) {
      return a.operatingEntityCode.localeCompare(b.operatingEntityCode);
    }
    return a.type === "wages" ? -1 : 1;
  });

  return {
    periodYear,
    periodMonth,
    periodEndDate: periodEndStr,
    totalWageAccrual: round(totalWageAccrual),
    totalTaxAccrual: round(totalTaxAccrual),
    totalAccrual: round(totalWageAccrual + totalTaxAccrual),
    employeeCount: employeeDetails.length,
    lineItems,
    employeeDetails,
    warnings,
  };
}

// ─── Annual Employer Cost Estimation ─────────────────────────────────

/**
 * Estimate annual employer payroll taxes for a given annual compensation.
 * This is a simplified full-year estimate (assumes employee hits caps mid-year).
 * Used for "Total Comp" display on dashboards and roster pages.
 *
 * Components: FICA SS, Medicare, FUTA, CA SUI, CA ETT, CA SDI
 */
export function estimateAnnualERTaxes(annualComp: number): {
  total: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let total = 0;

  for (const [key, { rate, cap }] of Object.entries(TAX_RATES)) {
    const taxableWages = cap === Infinity ? annualComp : Math.min(annualComp, cap);
    const tax = round(taxableWages * rate);
    breakdown[key] = tax;
    total += tax;
  }

  return { total: round(total), breakdown };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Aggregation Utilities ───────────────────────────────────────────

export interface EntityPayrollSummary {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  totalAnnualComp: number;
  totalMonthlyComp: number;
  departments: {
    department: string;
    headcount: number;
    totalAnnualComp: number;
  }[];
}

/**
 * Aggregate employee data into per-entity payroll summaries.
 * Used by dashboards for KPI cards and charts.
 */
export function aggregateByEntity(employees: (Employee & { _companyId?: string })[]): EntityPayrollSummary[] {
  const entityMap: Record<string, {
    entityId: string;
    entityCode: string;
    entityName: string;
    deptMap: Record<string, { headcount: number; totalAnnualComp: number }>;
  }> = {};

  for (const emp of employees) {
    const annualComp = getAnnualComp(emp);
    const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, emp._companyId);

    if (!entityMap[cc.operatingEntityId]) {
      entityMap[cc.operatingEntityId] = {
        entityId: cc.operatingEntityId,
        entityCode: cc.operatingEntityCode,
        entityName: cc.operatingEntityName,
        deptMap: {},
      };
    }

    const entity = entityMap[cc.operatingEntityId];
    if (!entity.deptMap[cc.department]) {
      entity.deptMap[cc.department] = { headcount: 0, totalAnnualComp: 0 };
    }

    entity.deptMap[cc.department].headcount++;
    entity.deptMap[cc.department].totalAnnualComp += annualComp;
  }

  return Object.values(entityMap).map((e) => {
    const departments = Object.entries(e.deptMap).map(([dept, data]) => ({
      department: dept,
      headcount: data.headcount,
      totalAnnualComp: round(data.totalAnnualComp),
    }));

    const headcount = departments.reduce((sum, d) => sum + d.headcount, 0);
    const totalAnnualComp = departments.reduce((sum, d) => sum + d.totalAnnualComp, 0);

    return {
      entityId: e.entityId,
      entityCode: e.entityCode,
      entityName: e.entityName,
      headcount,
      totalAnnualComp: round(totalAnnualComp),
      totalMonthlyComp: round(totalAnnualComp / 12),
      departments: departments.sort((a, b) => b.totalAnnualComp - a.totalAnnualComp),
    };
  }).sort((a, b) => b.totalAnnualComp - a.totalAnnualComp);
}
