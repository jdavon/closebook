// Re-export Database from auto-generated types
export type { Database } from "./database.types";

// Convenience type aliases used throughout the app
export type UserRole = "admin" | "controller" | "preparer" | "reviewer";

export type CloseStatus =
  | "open"
  | "in_progress"
  | "review"
  | "closed"
  | "locked";

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "pending_review"
  | "approved"
  | "rejected"
  | "na";

export type AccountClassification =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

export type ScheduleType =
  | "prepaid"
  | "fixed_asset"
  | "debt"
  | "accrual"
  | "custom";

export type ScheduleStatus = "draft" | "finalized";

export type SyncStatus = "idle" | "syncing" | "error";

export type AssetStatus = "active" | "disposed" | "fully_depreciated" | "inactive";

export type BookDepreciationMethod = "straight_line" | "declining_balance" | "none";

export type TaxDepreciationMethod =
  | "macrs_5"
  | "macrs_7"
  | "macrs_10"
  | "section_179"
  | "bonus_100"
  | "bonus_80"
  | "bonus_60"
  | "straight_line_tax"
  | "none";

export type VehicleMasterType = "Vehicle" | "Trailer";

export type VehicleReportingGroup =
  | "Car"
  | "Cargo Van"
  | "Passenger Van"
  | "Box Truck"
  | "Studio Box Truck"
  | "Stakebed"
  | "Cast Trailer"
  | "Makeup Trailer";

export type VehicleClass =
  | "1R" | "2" | "2R" | "3" | "3R" | "4" | "5" | "6" | "7" | "8" | "8MU" | "9"
  | "11" | "12" | "13" | "13T" | "14" | "15" | "15I" | "15L" | "16" | "17" | "18"
  | "20" | "20T" | "21" | "22" | "23" | "24" | "26" | "27" | "28" | "28P" | "28S"
  | "29" | "30" | "31" | "32" | "33" | "34" | "40" | "51" | "52";

export type DispositionMethod =
  | "sale"
  | "trade_in"
  | "scrap"
  | "theft"
  | "casualty"
  | "donation";

export type PayrollAccrualType = "wages" | "payroll_tax" | "pto" | "benefits";

export type AccrualSource = "paylocity_sync" | "manual";

export type AccrualStatus = "draft" | "posted" | "reversed";

export type PaylocityEnvironment = "testing" | "production";

export type NormalBalance = "debit" | "credit";

export type DebtType = "term_loan" | "line_of_credit";

export type DebtStatus = "active" | "paid_off" | "inactive";

export type CommissionAccountRole = "revenue" | "expense";

export type ClassFilterMode = "all" | "include" | "exclude";

export type BudgetStatus = "draft" | "approved" | "archived";

// -- Real Estate Lease Management --

export type PropertyType =
  | "office"
  | "retail"
  | "warehouse"
  | "industrial"
  | "mixed_use"
  | "land"
  | "other";

export type LeaseType = "operating" | "finance";

export type LeaseStatus = "draft" | "active" | "expired" | "terminated";

export type MaintenanceType = "triple_net" | "gross" | "modified_gross";

export type PropertyTaxFrequency = "monthly" | "semi_annual" | "annual";

export type PaymentType =
  | "base_rent"
  | "cam"
  | "property_tax"
  | "insurance"
  | "utilities"
  | "other";

export type EscalationType = "fixed_percentage" | "fixed_amount" | "cpi";

export type EscalationFrequency = "annual" | "biennial" | "at_renewal";

export type OptionType = "renewal" | "termination" | "purchase" | "expansion";

export type CriticalDateType =
  | "lease_expiration"
  | "renewal_deadline"
  | "termination_notice"
  | "rent_escalation"
  | "rent_review"
  | "cam_reconciliation"
  | "insurance_renewal"
  | "custom";

export type LeaseDocumentType =
  | "original_lease"
  | "amendment"
  | "addendum"
  | "correspondence"
  | "insurance_cert"
  | "other";
