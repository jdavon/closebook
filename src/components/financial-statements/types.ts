// TypeScript interfaces for the three-statement financial model

export type Granularity = "monthly" | "quarterly" | "yearly";
export type Scope = "entity" | "organization" | "reporting_entity";
export type StatementTab = "income-statement" | "balance-sheet" | "cash-flow" | "pro-forma" | "allocations" | "entity-breakdown" | "re-breakdown" | "all";

/** A single time period column in the statements */
export interface Period {
  key: string;          // Unique key for lookups, e.g. "2025-12", "2025-Q4", "FY2025"
  label: string;        // Display label, e.g. "Dec 2025", "Q4 2025", "FY 2025"
  year: number;
  startMonth: number;   // First month in the period (1-12)
  endMonth: number;     // Last month in the period (1-12)
  endYear: number;      // Year of the last month (may differ from year for fiscal years)
}

/** A single row in a financial statement */
export interface LineItem {
  id: string;
  label: string;
  accountNumber?: string;
  /** Amounts keyed by Period.key */
  amounts: Record<string, number>;
  /** Budget amounts keyed by Period.key */
  budgetAmounts?: Record<string, number>;
  /** Prior year amounts keyed by Period.key */
  priorYearAmounts?: Record<string, number>;
  indent: number;           // 0=section header, 1=line item, 2=sub-line
  isTotal: boolean;         // Subtotal row (single underline)
  isGrandTotal: boolean;    // Grand total row (double underline)
  isHeader: boolean;        // Section header (bold, no amounts)
  isSeparator: boolean;     // Blank separator row
  showDollarSign: boolean;  // Show $ on this row
  varianceInvertColor?: boolean;  // When true, positive variance is unfavorable (expense items)
}

/** A group of line items under a section header */
export interface StatementSection {
  id: string;
  title: string;            // "REVENUE", "COST OF GOODS SOLD", etc.
  lines: LineItem[];
  subtotalLine?: LineItem;
}

/** A complete financial statement (IS, BS, or CFS) */
export interface StatementData {
  id: string;               // "income_statement", "balance_sheet", "cash_flow"
  title: string;            // "Income Statement", "Balance Sheet", etc.
  sections: StatementSection[];
}

/** Full response from the financial statements API */
export interface FinancialStatementsResponse {
  periods: Period[];
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  cashFlowStatement: StatementData;
  metadata: {
    entityName?: string;
    organizationName?: string;
    reportingEntityName?: string;
    generatedAt: string;
    scope: Scope;
    granularity: Granularity;
    startPeriod: string;
    endPeriod: string;
  };
}

/** Config object passed to the API and shared between components */
export interface FinancialModelConfig {
  scope: Scope;
  entityId?: string;
  organizationId?: string;
  reportingEntityId?: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
}

/** A pro forma adjustment row from the database */
export interface ProFormaAdjustment {
  id: string;
  organization_id: string;
  entity_id: string;
  master_account_id: string;
  period_year: number;
  period_month: number;
  amount: number;
  description: string;
  notes: string | null;
  is_excluded: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  entity_name?: string;
  entity_code?: string;
  master_account_name?: string;
  master_account_number?: string;
}

/** An allocation adjustment row from the database */
export interface AllocationAdjustment {
  id: string;
  organization_id: string;
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  amount: number;
  description: string;
  notes: string | null;
  is_excluded: boolean;
  schedule_type: "single_month" | "monthly_spread";
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  source_entity_name?: string;
  source_entity_code?: string;
  destination_entity_name?: string;
  destination_entity_code?: string;
  master_account_name?: string;
  master_account_number?: string;
}

/** A column in the entity-breakdown view */
export interface EntityColumn {
  key: string;       // entity ID or "consolidated"
  label: string;     // entity code or "Consolidated"
  fullName: string;  // entity full name
}

/** Response from the entity-breakdown API */
export interface EntityBreakdownResponse {
  columns: EntityColumn[];
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  metadata: {
    organizationName?: string;
    generatedAt: string;
    startPeriod: string;
    endPeriod: string;
  };
}
