// TypeScript interfaces for the three-statement financial model

export type Granularity = "monthly" | "quarterly" | "yearly";
export type Scope = "entity" | "organization";
export type StatementTab = "income-statement" | "balance-sheet" | "cash-flow" | "all";

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
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeBudget: boolean;
  includeYoY: boolean;
}
