export interface DebtGLAccountGroup {
  key: string;
  displayName: string;
  description: string;
}

/**
 * GL account groups for debt reconciliation.
 * Each group maps to one or more entity-level GL accounts
 * configured in debt_reconciliation_accounts.
 */
export const DEBT_GL_ACCOUNT_GROUPS: DebtGLAccountGroup[] = [
  {
    key: "notes_payable_current",
    displayName: "Notes Payable - Current",
    description: "Current portion of long-term debt (due within 12 months)",
  },
  {
    key: "notes_payable_long_term",
    displayName: "Notes Payable - Long Term",
    description: "Long-term portion of debt (due after 12 months)",
  },
  {
    key: "loc_payable",
    displayName: "Line of Credit",
    description: "Revolving lines of credit and revolving credit facilities",
  },
  {
    key: "interest_payable",
    displayName: "Interest Payable",
    description: "Accrued interest expense for the period",
  },
];

const LOC_TYPES = new Set(["line_of_credit", "revolving_credit"]);

/**
 * Determine which GL account group a debt instrument's balance belongs to.
 * LOC-type instruments go to "loc_payable".
 * Term-type instruments split between "notes_payable_current" and "notes_payable_long_term".
 */
export function getDebtGLGroup(
  debtType: string,
  portion: "current" | "long_term"
): string {
  if (LOC_TYPES.has(debtType)) return "loc_payable";
  return portion === "current"
    ? "notes_payable_current"
    : "notes_payable_long_term";
}
