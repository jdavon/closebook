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

export type VehicleType =
  | "sedan"
  | "suv"
  | "truck"
  | "van"
  | "heavy_truck"
  | "trailer"
  | "other";

export type DispositionMethod =
  | "sale"
  | "trade_in"
  | "scrap"
  | "theft"
  | "casualty"
  | "donation";
