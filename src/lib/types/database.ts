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
