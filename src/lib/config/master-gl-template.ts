// Master GL template: defines the consolidated chart of accounts
// and rules for auto-mapping entity accounts from QuickBooks.

export interface MasterAccountTemplate {
  accountNumber: string;
  name: string;
  classification: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  accountType: string;
  normalBalance: "debit" | "credit";
  displayOrder: number;
  // Rules to match entity accounts to this master account.
  // An entity account matches if ANY rule matches.
  mappingRules: MappingRule[];
}

export interface MappingRule {
  // Match by account number prefix (e.g. "1100" matches "1100", "1100.1")
  accountNumberPrefix?: string;
  // Match by exact account number
  accountNumber?: string;
  // Match if entity account name contains this string (case-insensitive)
  nameContains?: string;
  // Match by exact entity account name (case-insensitive)
  nameExact?: string;
  // Match by QBO account_type
  accountType?: string;
}

// ---------------------------------------------------------------------------
// BALANCE SHEET — ASSETS
// ---------------------------------------------------------------------------

const ASSETS: MasterAccountTemplate[] = [
  {
    accountNumber: "M1000",
    name: "Bank Accounts",
    classification: "Asset",
    accountType: "Bank",
    normalBalance: "debit",
    displayOrder: 100,
    mappingRules: [
      { accountNumber: "1072" },
      { accountNumber: "1100" },
      { accountNumber: "1105" },
      { accountNumber: "1130" },
      { accountNumber: "1140" },
      { accountNumber: "1150" },
      { accountNumber: "1170" },
      { accountNumber: "1171" },
      { accountNumber: "1172" },
      { nameContains: "Silverco Deposit" },
      { accountNumber: "1499" }, // Undeposited Funds
    ],
  },
  {
    accountNumber: "M1100",
    name: "Accounts Receivable",
    classification: "Asset",
    accountType: "Accounts Receivable",
    normalBalance: "debit",
    displayOrder: 200,
    mappingRules: [
      { accountNumber: "1250" },
      { accountNumber: "1253" },
      { accountNumber: "1254" },
      { accountNumber: "1290" },
      { accountNumber: "1251" },
      { accountNumber: "1260" },
    ],
  },
  {
    accountNumber: "M1200",
    name: "Other Current Assets",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 300,
    mappingRules: [
      { accountNumber: "1270" },
      { accountNumber: "1500" },
      { accountNumber: "1600" },
      { accountNumber: "1601" },
      { accountNumber: "1602" },
      { accountNumber: "1630" },
      { accountNumber: "1700" },
      { accountNumber: "1710" },
    ],
  },
  {
    accountNumber: "M1300",
    name: "Due from Two Family",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 310,
    mappingRules: [{ accountNumber: "1335" }],
  },
  {
    accountNumber: "M1310",
    name: "Due from NCNT Holdings",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 320,
    mappingRules: [{ accountNumber: "1336" }],
  },
  {
    accountNumber: "M1320",
    name: "Due from HSS",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 330,
    mappingRules: [{ accountNumber: "1338" }],
  },
  {
    accountNumber: "M1330",
    name: "Due from HDR",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 340,
    mappingRules: [{ accountNumber: "1337" }],
  },
  {
    accountNumber: "M1340",
    name: "Due from Avon Rental Holdings",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 350,
    mappingRules: [{ accountNumber: "1345" }],
  },
  {
    accountNumber: "M1350",
    name: "Due from Bearcat",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 360,
    mappingRules: [{ accountNumber: "1355" }],
  },
  {
    accountNumber: "M1360",
    name: "Due from Versatile",
    classification: "Asset",
    accountType: "Other Current Asset",
    normalBalance: "debit",
    displayOrder: 370,
    mappingRules: [{ accountNumber: "1356" }],
  },
  {
    accountNumber: "M1700",
    name: "Vehicles (Net)",
    classification: "Asset",
    accountType: "Fixed Asset",
    normalBalance: "debit",
    displayOrder: 500,
    mappingRules: [
      { accountNumber: "1830" },
      { accountNumber: "1831" },
      { accountNumber: "1874" },
      { accountNumber: "1875" },
    ],
  },
  {
    accountNumber: "M1800",
    name: "Trailers (Net)",
    classification: "Asset",
    accountType: "Fixed Asset",
    normalBalance: "debit",
    displayOrder: 510,
    mappingRules: [
      { accountNumber: "1835" },
      { accountNumber: "1840" },
      { accountNumber: "1841" },
    ],
  },
  {
    accountNumber: "M1900",
    name: "Other Long Term Assets",
    classification: "Asset",
    accountType: "Other Asset",
    normalBalance: "debit",
    displayOrder: 600,
    mappingRules: [
      { accountNumber: "1805" },
      { accountNumber: "1820" },
      { accountNumber: "1876" },
      { accountNumber: "1880" },
      { accountNumber: "1900" },
    ],
  },
  {
    accountNumber: "M1950",
    name: "Right of Use Lease Assets",
    classification: "Asset",
    accountType: "Other Asset",
    normalBalance: "debit",
    displayOrder: 650,
    mappingRules: [
      { accountNumber: "1990" },
      { accountNumber: "1991" },
    ],
  },
];

// ---------------------------------------------------------------------------
// BALANCE SHEET — LIABILITIES
// ---------------------------------------------------------------------------

const LIABILITIES: MasterAccountTemplate[] = [
  {
    accountNumber: "M2000",
    name: "Accounts Payable",
    classification: "Liability",
    accountType: "Accounts Payable",
    normalBalance: "credit",
    displayOrder: 700,
    mappingRules: [{ accountNumber: "2000" }],
  },
  {
    accountNumber: "M2050",
    name: "Credit Cards",
    classification: "Liability",
    accountType: "Credit Card",
    normalBalance: "credit",
    displayOrder: 710,
    mappingRules: [
      { accountNumber: "2006" },
      { nameContains: "Credit Card (1001)" },
    ],
  },
  {
    accountNumber: "M2100",
    name: "Other Current Liabilities",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 800,
    mappingRules: [
      { accountNumber: "2001" },
      { accountNumber: "2015" },
      { accountNumber: "2020" },
      { accountNumber: "2022" },
      { accountNumber: "2025" },
      { accountNumber: "2035" },
      { accountNumberPrefix: "2035." },
      { accountNumber: "2040" },
      { accountNumber: "2050" },
      { accountNumber: "2100" },
      { accountNumber: "2110" },
      { accountNumber: "2200" },
      { accountNumber: "2300" },
      { accountNumber: "2310" },
      { accountNumber: "2400" },
      { accountNumber: "2745" },
    ],
  },
  {
    accountNumber: "M2200",
    name: "LGJ / Short Term Line of Credit",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 810,
    mappingRules: [
      { accountNumber: "2501" },
      { accountNumber: "2502" },
      { accountNumber: "2503" },
      { accountNumber: "2504" },
      { accountNumber: "2505" },
      { accountNumber: "2506" },
      { accountNumber: "2507" },
      { accountNumber: "2509" },
      { accountNumberPrefix: "2509." },
      { accountNumber: "2562" },
    ],
  },
  {
    accountNumber: "M2300",
    name: "Due to Two Family",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 820,
    mappingRules: [{ accountNumber: "2510" }],
  },
  {
    accountNumber: "M2310",
    name: "Due to Avon Rental Holdings",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 830,
    mappingRules: [{ accountNumber: "2511" }],
  },
  {
    accountNumber: "M2320",
    name: "Due to NCNT Holdings",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 840,
    mappingRules: [{ accountNumber: "2550" }],
  },
  {
    accountNumber: "M2330",
    name: "Due to Versatile",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 850,
    mappingRules: [{ accountNumber: "2561" }],
  },
  {
    accountNumber: "M2340",
    name: "Due to HDR",
    classification: "Liability",
    accountType: "Other Current Liability",
    normalBalance: "credit",
    displayOrder: 860,
    mappingRules: [{ accountNumber: "2560" }],
  },
  {
    accountNumber: "M2500",
    name: "Right of Use Lease Liabilities",
    classification: "Liability",
    accountType: "Long Term Liability",
    normalBalance: "credit",
    displayOrder: 900,
    mappingRules: [
      { accountNumber: "2675" },
      { accountNumber: "2800" },
    ],
  },
  {
    accountNumber: "M2600",
    name: "Other Long Term Liabilities",
    classification: "Liability",
    accountType: "Long Term Liability",
    normalBalance: "credit",
    displayOrder: 910,
    mappingRules: [{ accountNumber: "2670" }],
  },
];

// ---------------------------------------------------------------------------
// BALANCE SHEET — EQUITY
// ---------------------------------------------------------------------------

const EQUITY: MasterAccountTemplate[] = [
  {
    accountNumber: "M3000",
    name: "Retained Earnings",
    classification: "Equity",
    accountType: "Equity",
    normalBalance: "credit",
    displayOrder: 1000,
    mappingRules: [
      { accountNumber: "3100" },
      { accountNumber: "3300" },
    ],
  },
  {
    accountNumber: "M3100",
    name: "Distributions",
    classification: "Equity",
    accountType: "Equity",
    normalBalance: "debit",
    displayOrder: 1010,
    mappingRules: [{ accountNumber: "3400" }],
  },
  {
    accountNumber: "M3200",
    name: "Net Income",
    classification: "Equity",
    accountType: "Equity",
    normalBalance: "credit",
    displayOrder: 1020,
    mappingRules: [{ nameExact: "Net Income" }],
  },
];

// ---------------------------------------------------------------------------
// INCOME STATEMENT — REVENUE
// ---------------------------------------------------------------------------

const REVENUE: MasterAccountTemplate[] = [
  {
    accountNumber: "M4000",
    name: "Rental Revenue - Vehicles",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1100,
    mappingRules: [
      { accountNumber: "4000" },
      { nameContains: "Rental Revenue - Vehicle" },
    ],
  },
  {
    accountNumber: "M4010",
    name: "Rental Revenue - Trailers",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1110,
    mappingRules: [
      { accountNumber: "4010" },
      { nameContains: "Rental Revenue - Trailer" },
    ],
  },
  {
    accountNumber: "M4020",
    name: "Rental Services",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1120,
    mappingRules: [
      { accountNumber: "4020" },
      { nameContains: "Rental Services" },
    ],
  },
  {
    accountNumber: "M4030",
    name: "Parking Revenue",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1130,
    mappingRules: [
      { accountNumber: "4030" },
      { nameContains: "Parking" },
    ],
  },
  {
    accountNumber: "M4040",
    name: "Production Supplies Revenue",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1140,
    mappingRules: [
      { accountNumber: "4040" },
      { nameContains: "Production Supplies" },
    ],
  },
  {
    accountNumber: "M4050",
    name: "Labor & Services Revenue",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1150,
    mappingRules: [
      { accountNumber: "4050" },
      { nameContains: "Labor & Services" },
    ],
  },
  {
    accountNumber: "M4060",
    name: "Damage Reimbursement",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1160,
    mappingRules: [
      { accountNumber: "4060" },
      { nameContains: "Damage Reimbursement" },
    ],
  },
  {
    accountNumber: "M4900",
    name: "Other Revenue",
    classification: "Revenue",
    accountType: "Income",
    normalBalance: "credit",
    displayOrder: 1190,
    mappingRules: [
      { accountNumber: "4900" },
      { accountType: "Income" },
    ],
  },
  {
    accountNumber: "M4950",
    name: "Other Income",
    classification: "Revenue",
    accountType: "Other Income",
    normalBalance: "credit",
    displayOrder: 1200,
    mappingRules: [
      { accountType: "Other Income" },
    ],
  },
];

// ---------------------------------------------------------------------------
// INCOME STATEMENT — EXPENSES
// ---------------------------------------------------------------------------

const EXPENSES: MasterAccountTemplate[] = [
  {
    accountNumber: "M5000",
    name: "Auto Insurance",
    classification: "Expense",
    accountType: "Cost of Goods Sold",
    normalBalance: "debit",
    displayOrder: 1300,
    mappingRules: [
      { accountNumber: "5000" },
      { nameContains: "Auto Insurance" },
    ],
  },
  {
    accountNumber: "M5010",
    name: "Maintenance & Repair",
    classification: "Expense",
    accountType: "Cost of Goods Sold",
    normalBalance: "debit",
    displayOrder: 1310,
    mappingRules: [
      { accountNumber: "5010" },
      { nameContains: "Maintenance & Repair" },
    ],
  },
  {
    accountNumber: "M5020",
    name: "Parts & Supplies",
    classification: "Expense",
    accountType: "Cost of Goods Sold",
    normalBalance: "debit",
    displayOrder: 1320,
    mappingRules: [
      { accountNumber: "5020" },
      { nameContains: "Parts & Supplies" },
    ],
  },
  {
    accountNumber: "M5030",
    name: "Vehicle Repairs - Body",
    classification: "Expense",
    accountType: "Cost of Goods Sold",
    normalBalance: "debit",
    displayOrder: 1330,
    mappingRules: [
      { accountNumber: "5030" },
      { nameContains: "Vehicle Repairs" },
    ],
  },
  {
    accountNumber: "M5090",
    name: "Other Operating Costs",
    classification: "Expense",
    accountType: "Cost of Goods Sold",
    normalBalance: "debit",
    displayOrder: 1390,
    mappingRules: [
      { accountType: "Cost of Goods Sold" },
    ],
  },
  {
    accountNumber: "M6000",
    name: "Rent",
    classification: "Expense",
    accountType: "Expense",
    normalBalance: "debit",
    displayOrder: 1400,
    mappingRules: [
      { accountNumber: "6000" },
      { nameContains: "Rent" },
    ],
  },
  {
    accountNumber: "M6010",
    name: "Personnel Costs",
    classification: "Expense",
    accountType: "Expense",
    normalBalance: "debit",
    displayOrder: 1410,
    mappingRules: [
      { accountNumber: "6010" },
      { nameContains: "Personnel" },
      { nameContains: "Payroll" },
      { nameContains: "Salary" },
      { nameContains: "Wages" },
    ],
  },
  {
    accountNumber: "M6020",
    name: "Outside Services",
    classification: "Expense",
    accountType: "Expense",
    normalBalance: "debit",
    displayOrder: 1420,
    mappingRules: [
      { accountNumber: "6020" },
      { nameContains: "Outside Services" },
    ],
  },
  {
    accountNumber: "M6030",
    name: "Professional Fees",
    classification: "Expense",
    accountType: "Expense",
    normalBalance: "debit",
    displayOrder: 1430,
    mappingRules: [
      { accountNumber: "6030" },
      { nameContains: "Professional Fees" },
    ],
  },
  {
    accountNumber: "M6090",
    name: "Other Expenses",
    classification: "Expense",
    accountType: "Expense",
    normalBalance: "debit",
    displayOrder: 1490,
    mappingRules: [
      { accountType: "Expense" },
    ],
  },
  {
    accountNumber: "M7000",
    name: "Vehicle Depreciation",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1500,
    mappingRules: [
      { nameContains: "Vehicle Depreciation" },
    ],
  },
  {
    accountNumber: "M7010",
    name: "Interest Expense",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1510,
    mappingRules: [
      { nameContains: "Interest Expense" },
      { nameContains: "Interest" },
    ],
  },
  {
    accountNumber: "M7020",
    name: "Taxes",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1520,
    mappingRules: [
      { nameContains: "Tax" },
    ],
  },
  {
    accountNumber: "M7030",
    name: "Amortization of Goodwill",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1530,
    mappingRules: [
      { nameContains: "Amortization" },
      { nameContains: "Goodwill" },
    ],
  },
  {
    accountNumber: "M7040",
    name: "(Gain) / Loss on Sale of Vehicles",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1540,
    mappingRules: [
      { nameContains: "Gain" },
      { nameContains: "Loss on Sale" },
    ],
  },
  {
    accountNumber: "M7050",
    name: "Fixed Asset Depreciation",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1550,
    mappingRules: [
      { nameContains: "Fixed Asset Depreciation" },
      { nameContains: "Depreciation" },
    ],
  },
  {
    accountNumber: "M7900",
    name: "Other Non-Operating Expenses",
    classification: "Expense",
    accountType: "Other Expense",
    normalBalance: "debit",
    displayOrder: 1590,
    mappingRules: [
      { accountType: "Other Expense" },
    ],
  },
];

// ---------------------------------------------------------------------------
// FULL TEMPLATE
// ---------------------------------------------------------------------------

export const MASTER_GL_TEMPLATE: MasterAccountTemplate[] = [
  ...ASSETS,
  ...LIABILITIES,
  ...EQUITY,
  ...REVENUE,
  ...EXPENSES,
];

/**
 * Check whether an entity account matches a single mapping rule.
 */
export function matchesRule(
  rule: MappingRule,
  entityAccountNumber: string | null,
  entityAccountName: string,
  entityAccountType?: string
): boolean {
  if (rule.accountNumber && entityAccountNumber === rule.accountNumber) {
    return true;
  }
  if (
    rule.accountNumberPrefix &&
    entityAccountNumber?.startsWith(rule.accountNumberPrefix)
  ) {
    return true;
  }
  if (
    rule.nameContains &&
    entityAccountName.toLowerCase().includes(rule.nameContains.toLowerCase())
  ) {
    return true;
  }
  if (
    rule.nameExact &&
    entityAccountName.toLowerCase() === rule.nameExact.toLowerCase()
  ) {
    return true;
  }
  if (rule.accountType && entityAccountType === rule.accountType) {
    return true;
  }
  return false;
}

/**
 * Find the master account template that an entity account should map to.
 * Returns the first match (templates are checked in display order).
 */
export function findMasterForEntityAccount(
  entityAccountNumber: string | null,
  entityAccountName: string,
  entityAccountType?: string
): MasterAccountTemplate | null {
  for (const template of MASTER_GL_TEMPLATE) {
    for (const rule of template.mappingRules) {
      if (
        matchesRule(rule, entityAccountNumber, entityAccountName, entityAccountType)
      ) {
        return template;
      }
    }
  }
  return null;
}
