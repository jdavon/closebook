/**
 * Paylocity API Types
 *
 * Types for both NextGen and WebLink APIs.
 * NextGen: Employee Demographics, Earnings, Deductions, Punch Details, Shifts, Job Codes, Cost Centers
 * WebLink: Pay Statements, Local Taxes
 */

// ─── Authentication ──────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── NextGen: Employee Demographics ──────────────────────────────────

export interface Employee {
  id: string;
  companyId: string;
  relationshipId?: string;
  lastName: string;
  displayName: string;
  status: string;
  statusType: "A" | "T" | "L"; // Active, Terminated, Leave
  currentStatus?: {
    status: string;
    statusCode: string;
    statusType: string;
    effectiveDate: string;
    changeReason: string;
    changeReasonCode: string;
  };
  info?: EmployeeInfo;
  currentPayRate?: PayRate;
  position?: EmployeePosition;
  futurePayRates?: PayRate[];
}

export interface EmployeeInfo {
  firstName: string;
  lastName: string;
  middleName?: string;
  preferredName?: string;
  suffix?: string;
  address?: {
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    county?: string;
  };
  homePhone?: string;
  mobilePhone?: string;
  personalEmail?: string;
  dateOfBirth?: string;
  maritalStatus?: string;
  gender?: string;
  hireDate?: string;
  adjustedSeniorityDate?: string;
  supervisorCo?: string;
  supervisor?: string;
  isSupervisor?: boolean;
  jobTitle?: string;
  payGroup?: string;
  otExempt?: boolean;
  workLocation?: {
    address?: string;
    phone?: string;
    email?: string;
  };
}

export interface PayRate {
  baseRate?: number;
  salary?: number;
  annualSalary?: number;
  defaultHours?: number;
  payFrequency?: string;
  payGrade?: string;
  ratePer?: string;
  effectiveDate?: string;
  beginCheckDate?: string;
  isAutoPay?: boolean;
  payType?: "Hourly" | "Salary";
}

export interface EmployeePosition {
  effectiveDate?: string;
  changeReason?: string;
  costCenter1?: string;
  costCenter2?: string;
  costCenter3?: string;
  employeeType?: string;
  positionCode?: string;
  positionDescription?: string;
}

export interface EmployeeBatchResponse {
  totalCount: number;
  employees: Employee[];
}

// ─── NextGen: Earnings & Deductions ──────────────────────────────────

export interface EmployeeEarning {
  id: string;
  employeeId: string;
  companyId: string;
  code: string;
  type: string;
  rate: number;
  frequency: string;
  calculationCode: string;
  recordType: "Current" | "Future" | "Historical" | "Unknown";
  effectiveDate?: string;
  beginCheckDate?: string;
  endCheckDate?: string;
  costCenters?: CostCenterAssignment[];
  limits?: {
    goal?: number;
    paidToDate?: number;
    annualMaximum?: number;
    payPeriodMaximum?: number;
    payPeriodMinimum?: number;
  };
}

export interface EmployeeDeduction {
  id: string;
  employeeId: string;
  companyId: string;
  code: string;
  type: string;
  rate: number;
  arrear?: number;
  frequency: string;
  calculationCode: string;
  priority?: number;
  recordType: "Current" | "Future" | "Historical" | "Unknown";
  effectiveDate?: string;
  beginCheckDate?: string;
  endCheckDate?: string;
  costCenters?: CostCenterAssignment[];
  limits?: {
    goal?: number;
    paidToDate?: number;
    payPeriodMinimum?: number;
    payPeriodMaximum?: number;
    annualMaximum?: number;
    paidYearToDate?: number;
  };
}

export interface CostCenterAssignment {
  level: number;
  code: string;
}

// ─── NextGen: Company-Level Codes ────────────────────────────────────

export interface EarningCode {
  code: string;
  description: string;
  checkStubDescription?: string;
  amount?: number;
  rate?: number;
  frequency?: string;
  isActive: boolean;
  type?: { code: string; category?: string };
}

export interface DeductionCode {
  code: string;
  description: string;
  checkStubDescription?: string;
  priority?: number;
  rate?: number;
  frequency?: string;
  isActive: boolean;
  type?: { code: string; category?: string };
}

// ─── NextGen: Job Codes ──────────────────────────────────────────────

export interface JobCode {
  companyId: string;
  jobCode: string;
  description: string;
  isActive: boolean;
}

// ─── NextGen: Cost Centers ───────────────────────────────────────────

export interface CostCenterLevel {
  id: number;
  level: number;
  description: string;
  costCenters: CostCenter[];
}

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

// ─── NextGen: Punch Details ──────────────────────────────────────────

export interface PunchDetail {
  employeeId: string;
  companyId: string;
  badgeNumber?: number;
  relativeStart: string;
  relativeEnd: string;
  segments: PunchSegment[];
}

export interface PunchSegment {
  punchID: string;
  origin?: string;
  date: string;
  punchType?: string;
  relativeStart: string;
  relativeEnd: string;
  durationHours: number;
  earnings?: number;
  costCenters?: CostCenter[];
}

// ─── NextGen: Shifts/Schedules ───────────────────────────────────────

export interface EmployeeShift {
  stackId: string;
  assignedTo: { companyId: string; employeeId: string };
  startDateTime: string;
  duration: number; // minutes
  positionKey?: number;
  costCenters?: string[];
  breaks?: { startDateTime: string; duration: number; payType: string }[];
  segments?: ShiftSegment[];
  isPublished?: boolean;
}

export interface ShiftSegment {
  payType: string;
  actualTimeIn?: string;
  actualTimeOut?: string;
  regDuration?: number;
  ot1Duration?: number;
  ot2Duration?: number;
  cost?: number;
}

// ─── WebLink: Pay Statements ─────────────────────────────────────────

export interface PayStatementSummary {
  autoPay: boolean;
  beginDate: string;
  endDate: string;
  checkDate: string;
  checkNumber: number;
  directDepositAmount: number;
  netCheck: number;
  netPay: number;
  grossPay: number;
  hours: number;
  regularHours: number;
  overtimeHours: number;
  regularDollars: number;
  overtimeDollars: number;
  process: number;
  transactionNumber: number;
  voucherNumber: number;
  workersCompCode: string;
  year: number;
}

export interface PayStatementDetail {
  amount: number;
  checkDate: string;
  det: string;
  detCode: string;
  detType: string;
  eligibleCompensation: number;
  hours: number;
  rate: number;
  transactionNumber: number;
  transactionType: string;
  year: number;
}

// ─── WebLink: Local Taxes ────────────────────────────────────────────

export interface LocalTax {
  taxCode: string;
  filingStatus?: string;
  exemptions?: number;
  exemptions2?: number;
  residentPSD?: string;
  workPSD?: string;
}
