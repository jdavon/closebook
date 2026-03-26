# Accounting Manager Onboarding Packet

**Company:** Silverco Enterprises & Affiliated Entities
**Application:** CloseBook (closebook.vercel.app)
**Prepared:** March 2026

---

## Table of Contents

1. [Company Overview & Legal Structure](#1-company-overview--legal-structure)
2. [What the Business Does](#2-what-the-business-does)
3. [Revenue Streams & Key Drivers](#3-revenue-streams--key-drivers)
4. [Organizational & Departmental Structure](#4-organizational--departmental-structure)
5. [Chart of Accounts & Financial Reporting](#5-chart-of-accounts--financial-reporting)
6. [Key Systems & Integrations](#6-key-systems--integrations)
7. [Month-End Close Process](#7-month-end-close-process)
8. [Payroll & Benefits](#8-payroll--benefits)
9. [Fixed Assets & Depreciation](#9-fixed-assets--depreciation)
10. [Debt & Financing](#10-debt--financing)
11. [Real Estate & Leases](#11-real-estate--leases)
12. [Insurance](#12-insurance)
13. [Intercompany Transactions](#13-intercompany-transactions)
14. [Rebate Programs](#14-rebate-programs)
15. [Budgeting & Variance Analysis](#15-budgeting--variance-analysis)
16. [Day-to-Day Responsibilities](#16-day-to-day-responsibilities)
17. [Key Contacts & Access](#17-key-contacts--access)
18. [Common Pitfalls & Gotchas](#18-common-pitfalls--gotchas)

---

## 1. Company Overview & Legal Structure

### The Entities

The organization operates as a **multi-entity group** of related companies in the entertainment equipment rental industry, based in Los Angeles, California. There are **five operating entities**, each with its own QuickBooks Online (QBO) company file and general ledger:

| Entity | Code | Description |
|--------|------|-------------|
| **Silverco Enterprises** | AVON | The parent/employing company. Operates the core vehicle and production equipment rental business out of the Saticoy (Avon) location. All employees across the group are technically employed by Silverco. |
| **Avon Rental Holdings (ARH)** | ARH | A holding entity. Holds certain assets, liabilities, and intercompany balances. Important: ARH and Silverco are **distinct entities** for accounting purposes despite the name overlap. |
| **Versatile Studios** | VS | Operates the Cahuenga location. Focuses on studio equipment, production cubes, and grip & lighting rentals for the entertainment industry. |
| **Hollywood Depot Rentals (HDR)** | HDR | A separate operating company with its own Paylocity company (ID: 316791). Provides a wide range of production services including A/C, communications, grip & lighting, locations, production supplies, trash services, restroom trailers, and operations support. |
| **HSS** | HSS | An additional affiliated entity in the group structure. |

### Asset Companies

The following entities are **asset-holding companies** that own trailers and vehicles used by the organization. They do not have their own employees or day-to-day operations — their purpose is to hold title to fleet assets (trailers and vehicles) that are deployed across the operating entities. Both are part of the **Avon reporting entity** for consolidated reporting purposes.

| Entity | Description |
|--------|-------------|
| **Two Family** | Owns trailers and vehicles used by the organization. Intercompany due-from/due-to balances with operating entities reflect asset usage and cost allocation. |
| **NCNT Holdings** | Owns trailers and vehicles used by the organization. Intercompany due-from/due-to balances with operating entities reflect asset usage and cost allocation. |

### Related Parties (External to the Consolidation)

The following entity appears in the intercompany due-from/due-to structure but is **not consolidated** in the CloseBook financial model:

- **Bearcat** — Related entity with due-from/due-to balances

This entity has intercompany receivable/payable balances tracked in the GL but is treated as an external counterparty for consolidation purposes.

### Consolidation Hierarchy

```
CONSOLIDATED (Organization Level)
├── Silverco Enterprises (AVON)
│   └── Avon Reporting Entity also includes:
│       ├── Two Family (asset company — owns trailers & vehicles)
│       └── NCNT Holdings (asset company — owns trailers & vehicles)
├── Avon Rental Holdings (ARH)
├── Versatile Studios (VS)
├── Hollywood Depot Rentals (HDR)
└── HSS
```

The system also supports **Reporting Entities** — virtual sub-consolidated groupings. These let you create custom consolidation views (e.g., grouping Silverco + Versatile as a "Rental Operations" reporting entity) without any GL data of their own.

---

## 2. What the Business Does

### Industry

The company operates in the **entertainment production equipment rental** industry in Los Angeles. Clients are primarily film and television productions, studios, and entertainment industry professionals.

### Core Operations

**Vehicle Rentals** — Cargo vans, ProMaster vans, 3-ton trucks, loaded cube trucks. These are the primary revenue-generating assets for Silverco.

**Grip & Lighting (G&L)** — Grip equipment, lighting rigs, and related production hardware. Primarily operated through HDR and Versatile.

**Studio Equipment** — Production cubes, camera cubes, wardrobe cubes. Operated primarily through Versatile Studios at the Cahuenga location.

**Production Supplies** — Smaller equipment, expendable supplies, and miscellaneous production support items. This is the default/catch-all category.

**Parking** — Parking services for production vehicles and equipment.

**Labor & Services** — Driver services, delivery, setup labor, and related production support services.

**Restroom/Bathroom Trailers** — Portable restroom trailers for production locations. Allocated to HDR.

**Trash Services** — Waste management for production locations, operated through HDR.

**A/C and Communications** — HVAC and communication equipment rentals, operated through HDR.

### Operating Locations

The business operates from **5 warehouses** in the RentalWorks system, including:
- **AVON - SATICOY** (Silverco's primary lot)
- **VERSATILE - CAHUENGA** (Versatile Studios location)
- Plus 3 additional warehouse locations

---

## 3. Revenue Streams & Key Drivers

### Revenue Account Structure (Master GL)

| Account | Revenue Stream | Description |
|---------|---------------|-------------|
| M4000 | Rental Revenue - Vehicles | Core vehicle fleet rentals (vans, trucks, cubes) |
| M4010 | Rental Revenue - Trailers | Trailer rentals (restroom, production) |
| M4020 | Rental Services | Service-based rental revenue |
| M4030 | Parking Revenue | Production vehicle parking |
| M4040 | Production Supplies Revenue | Small equipment and supplies |
| M4050 | Labor & Services Revenue | Drivers, delivery, setup labor |
| M4060 | Damage Reimbursement | Customer damage recovery |
| M4900 | Other Revenue | Miscellaneous income |
| M4950 | Other Income | Non-operating income |

### Key Business Drivers

1. **Fleet Utilization** — The single most important driver. Revenue scales with how many days vehicles and equipment are out on rental vs. sitting idle. Track reservation-to-contract conversion and average rental duration.

2. **Equipment Mix** — Vehicles carry different margin profiles than G&L, studio, or production supplies. Vehicles tend to be higher revenue per unit; production supplies are higher volume, lower per-unit.

3. **Customer Concentration & Rebates** — Major commercial customers have tiered rebate agreements that reduce effective revenue. Understanding the rebate structure is critical to understanding true net revenue (see Section 14).

4. **Seasonality** — Entertainment production in LA follows pilot season (roughly Jan–Apr) and a general summer/fall production cycle. Revenue can fluctuate significantly by month.

5. **Fleet Maintenance & Repair Costs** — Direct operating costs (COGS) are dominated by auto insurance (M5000), maintenance & repair (M5010), parts & supplies (M5020), and vehicle body repairs (M5030). Keeping these in check relative to revenue is key to margin.

6. **Personnel Costs** — The largest single operating expense line (M6010). All employees are technically on Silverco's payroll and allocated to entities via cost centers.

7. **Rent Expense** — Facility costs (M6000) for the Saticoy and Cahuenga lots and any additional locations.

8. **Depreciation** — Both vehicles (M7000) and fixed assets (M7050) are significant non-cash charges. Vehicle depreciation is the largest single below-the-line expense.

9. **Interest Expense** — Debt service on vehicle financing and working capital lines (M7010).

10. **Damage Reimbursement vs. Repair Costs** — The relationship between M4060 (damage recovery from customers) and M5030 (body repair costs) is a key profitability indicator.

### Income Statement Structure

```
Revenue
  - Direct Operating Costs (COGS: insurance, maintenance, parts, repairs)
  ─────────────────────────────
  = GROSS MARGIN

  - Other Operating Costs (rent, personnel, outside services, professional fees, other)
  ─────────────────────────────
  = OPERATING MARGIN (EBITDA proxy)

  - Other Expense (vehicle depreciation, interest, taxes, amortization, gain/loss on sale)
  + Other Income
  ─────────────────────────────
  = NET INCOME
```

The **EBITDA view** in CloseBook truncates the income statement at Operating Margin, excluding depreciation, interest, taxes, amortization, and gain/loss items. This is the primary view used for operational performance assessment.

---

## 4. Organizational & Departmental Structure

### Paylocity Company Structure

There are **two Paylocity employer companies**:

| Paylocity Co. ID | Entity | Employs |
|-----------------|--------|---------|
| **132427** | Silverco Enterprises | All employees for Silverco, ARH, and Versatile Studios |
| **316791** | Hollywood Depot Rentals | HDR's own employees |

**Important:** Even though Silverco is the employer for Versatile employees, their payroll costs are allocated to Versatile via cost center codes. The same is true for many HDR functions — some HDR workers are on the Silverco payroll (company 132427) with HDR cost centers.

### Cost Center → Entity Allocation Map

**Company 132427 (Silverco Payroll)**

| Cost Center | Department | Allocated To |
|------------|------------|-------------|
| 01 | Administrative | Silverco |
| 02 | Avon Lot Ops | Silverco |
| 03 | Fleet | Silverco |
| 04 | Sales | Silverco |
| 05 | Officer | Silverco |
| 06 | Bathroom Trailers | HDR |
| 07 | Versatile | Versatile Studios |
| 08 | Versatile Lot Ops | Versatile Studios |
| 09 | Versatile Administration | Versatile Studios |
| 010 | Versatile Sales | Versatile Studios |
| 100 | Silverco Employees | Silverco |
| 200 | Silverco Executive | Silverco |
| 300 | HDR A/C | HDR |
| 400 | HDR Communications | HDR |
| 500 | HDR G&L | HDR |
| 600 | HDR Locations | HDR |
| 700 | HDR Production Supplies | HDR |
| 800 | HDR Trash | HDR |
| 900 | HDR Operations | HDR |
| 1000 | Restroom Trailers | HDR |

**Company 316791 (HDR's own payroll)**

| Cost Center | Department | Allocated To |
|------------|------------|-------------|
| 100 | A/C | HDR |
| 200 | Communications | HDR |
| 300 | G&L | HDR |
| 400 | Locations | HDR |
| 500 | Production Supply | HDR |
| 600 | Trash | HDR |
| 700 | Operations | HDR |
| 800 | Restroom Trailers | HDR |

Note: Cost center codes overlap between companies (e.g., both have "100"). Lookups must be company-scoped.

---

## 5. Chart of Accounts & Financial Reporting

### Account Architecture

The system uses a **two-tier account structure**:

1. **Entity-Level Accounts** — Synced from each entity's QuickBooks Online company file. These are the "source of truth" for GL balances. Each entity has its own chart of accounts with QBO account numbers.

2. **Master GL (Consolidated Accounts)** — An organization-level chart of accounts defined in CloseBook. Master accounts aggregate entity accounts for consolidated reporting. Each entity account is mapped (many-to-one) to exactly one master account.

### Master GL Summary

**Assets (M1000–M1999)**
- M1000: Bank Accounts
- M1100: Accounts Receivable
- M1200: Other Current Assets
- M1300–M1370: **Intercompany Due-From accounts** (Two Family, NCNT Holdings, HSS, HDR, ARH, Bearcat, Versatile, Silverco)
- M1399: Other Current Assets (catch-all)
- M1700: Vehicles (Net)
- M1800: Trailers (Net)
- M1899: Other Fixed Assets
- M1900: Other Long Term Assets
- M1950: Right of Use Lease Assets (ASC 842)
- M1999: Other Non-Current Assets

**Liabilities (M2000–M2600)**
- M2000: Accounts Payable
- M2050: Credit Cards
- M2100: Other Current Liabilities
- M2200: LGJ / Short Term Line of Credit
- M2295–M2340: **Intercompany Due-To accounts** (HSS, Two Family, Silverco, ARH, NCNT Holdings, Versatile, HDR)
- M2399: Other Current Liabilities (catch-all)
- M2500: Right of Use Lease Liabilities (ASC 842)
- M2600: Other Long Term Liabilities

**Equity (M3000–M3900)**
- M3000: Retained Earnings
- M3100: Distributions
- M3200: Net Income
- M3900: Other Equity

**Revenue (M4000–M4950)** — See Section 3 above.

**Expenses (M5000–M7900)**
- M5000–M5090: Direct Operating Costs (COGS) — auto insurance, maintenance, parts, body repairs
- M6000–M6090: Other Operating Costs — rent, personnel, outside services, professional fees
- M7000–M7900: Other (Non-Operating) Expenses — vehicle depreciation, interest, taxes, amortization, gain/loss on sales, fixed asset depreciation

### Financial Statements

CloseBook produces three financial statements:

**1. Income Statement (P&L)**
- Revenue → Gross Margin → Operating Margin → Net Income
- Supports standalone monthly and YTD views
- EBITDA toggle cuts off at Operating Margin
- Budget vs. Actual with dollar and percentage variance
- Prior year comparison

**2. Balance Sheet**
- Current Assets → Fixed Assets → Other Assets → Total Assets
- Current Liabilities → Long-Term Liabilities → Total Liabilities
- Stockholders' Equity → Total Liabilities & Equity
- **Must balance every period** (Assets = Liabilities + Equity) — this is a critical gate check

**3. Cash Flow Statement (Indirect Method)**
- Operating: Cash + changes in current assets/liabilities (excluding ROU items)
- Investing: Changes in fixed and other assets
- Financing: Changes in long-term liabilities and equity
- ASC 842 ROU items are reclassified from Investing/Financing to Operating

### Reporting Scopes

- **Entity** — Single entity's GL
- **Consolidated (Organization)** — All entities combined, with intercompany eliminations
- **Reporting Entity** — Custom sub-consolidated group of entities

---

## 6. Key Systems & Integrations

### QuickBooks Online (QBO)

**Role:** System of record for the general ledger. Each entity has its own QBO company file.

**Data Flow:** QBO → CloseBook (one-way sync via OAuth2 API)
- Accounts (chart of accounts) sync
- GL balances sync (monthly period data)
- **Daily cron job** syncs the current year + prior December

**What stays in QBO:** All journal entries, invoice processing, bill payments, bank reconciliations. QBO is where the day-to-day transactional accounting happens.

**What CloseBook adds:** Consolidation, master GL mapping, intercompany eliminations, financial modeling, close management, pro forma adjustments, budgets.

### RentalWorks (Database Works)

**Role:** The operational rental management system. Tracks orders, contracts, invoices, inventory, customers, and deals.

**Instance:** HDR (hdr.rentalworks.cloud)

**Key Entities:**
```
Customer → Deal → Quote/Order → Contract (check-out/check-in) → Invoice → Invoice Items
```

**Data Flow:** RentalWorks → CloseBook (API sync for rebate calculations, revenue analysis)

**Equipment Classification (auto-derived from order descriptions):**
- VEHICLE: "VEHICLE", "CARGO VAN", "PROMASTER", "3 TON", "LOADED CUBE"
- GRIP & LIGHTING: "GRIP", "G&L", "G & L", "G+L"
- STUDIO: "STUDIO", "PROD CUBE", "CAMERA CUBE", "WARDROBE CUBE"
- PRO SUPPLIES: Everything else (default)

**5 Warehouses** in the system, including AVON-SATICOY and VERSATILE-CAHUENGA.

### Paylocity

**Role:** Payroll processing and HR management.

**Two API endpoints:**
- **NextGen API** (dc1prodgwext.paylocity.com) — Employees, earnings, deductions, punch details, cost centers
- **WebLink API** (api.paylocity.com) — Pay statements (summary + detail), local taxes

**Two Companies:**
- 132427: Silverco (covers Silverco, ARH, Versatile employees)
- 316791: HDR (covers HDR's own employees)

**Data Flow:** Paylocity → CloseBook (monthly payroll sync for accrual calculations, cost allocation, overtime analysis)

### CloseBook (This Application)

**URL:** closebook.vercel.app

**Role:** The financial consolidation, reporting, and close management platform. It pulls data from QBO, RentalWorks, and Paylocity, then adds:
- Master GL mapping and consolidation
- Intercompany elimination
- Month-end close workflow with gate checks
- Financial statement generation (P&L, BS, CFS)
- Budget vs. actual comparison
- Pro forma / what-if adjustments
- Depreciation schedules (book and tax)
- Debt amortization schedules
- Revenue accrual/deferral calculations
- Rebate tracking and calculations
- Payroll accrual engine
- Lease management (ASC 842)
- Insurance tracking
- Asset management

---

## 7. Month-End Close Process

### Close Phases

The close follows a **four-phase gated workflow** in CloseBook. Each phase must be completed before the next can begin.

#### Phase 1: Pre-Close — Data Sync, Cutoffs & Period Setup
- Sync QBO data for the period (automated daily, but verify completeness)
- Confirm all bank reconciliations are complete in QBO
- Verify revenue cutoff dates
- Confirm all invoices for the period are entered

#### Phase 2: Adjustments — Depreciation, Accruals & Journal Entries
- Run and record **payroll accruals** (wages earned but not paid at period end)
- Record **depreciation** — both vehicle and fixed asset
- Record **revenue accruals/deferrals** (earned but unbilled, or billed but unearned)
- Post any manual journal entries (reclassifications, corrections)
- Verify allocation adjustments (inter-entity cost transfers)

#### Phase 3: Reconciliations — Subledger-to-GL
- **Debt Reconciliation** — GL balances match amortization schedules
- **Asset Reconciliation** — GL balances match the fixed asset register
- **Lease Reconciliation** — ROU assets and lease liabilities match lease schedules
- **Payroll Reconciliation** — Verify accrual entries tie to Paylocity data

#### Phase 4: Review & Reporting — TB Review, Flux Analysis, Sign-Off
- Review **Trial Balance** for anomalies and unmatched accounts
- Run **flux analysis** (month-over-month, budget-to-actual variance)
- Verify **intercompany eliminations** net to zero
- Generate and review **financial statements** (all three)
- Management sign-off

### Gate Checks (Must Pass Before Close)

**Critical (blocking):**
- **Balance Sheet Balance** — Assets = Liabilities + Equity (every entity, every period)
- **Trial Balance Footing** — Total Debits = Total Credits
- **Intercompany Net-Zero** — All IC elimination pairs net to zero across entities

**Non-Critical (informational):**
- **Debt Reconciliation** — GL groups reconciled to amortization schedule
- **Asset Reconciliation** — GL groups reconciled to asset register

### Phase Blocking

Phase 2 is blocked until all Phase 1 tasks are approved. Phase 3 is blocked until Phases 1 and 2 are complete. Phase 4 is blocked until Phases 1–3 are complete. Tasks can be marked as "N/A" if not applicable for the period.

---

## 8. Payroll & Benefits

### Employment Structure

All employees across Silverco, ARH, and Versatile are employed by **Silverco Enterprises** (Paylocity company 132427). HDR has its own Paylocity company (316791). Payroll costs are allocated to the correct operating entity based on the employee's **cost center assignment**.

### Payroll Accrual Calculation

At month-end, CloseBook calculates:

**Wage Accrual** — Pro-rata from the last pay date to period end:
- Salaried: Annual salary / 365 days × accrual days
- Hourly: Annual estimated comp (hourly rate × 40 hrs × 52 weeks) / 260 working days × accrual days

**Employer Payroll Tax Accrual** — Per employee, respecting annual caps and YTD wages:

| Tax | Rate | Annual Wage Cap |
|-----|------|----------------|
| FICA Social Security | 6.2% | $176,100 |
| Medicare | 1.45% | Unlimited |
| FUTA | 0.6% | $7,000 |
| CA SUI | 3.4% | $7,000 |
| CA ETT | 0.1% | $7,000 |
| CA SDI | 1.1% | $145,600 |

### Employer-Paid Benefits

Extracted from Paylocity pay statement details (MEMO-type entries only):
- **ERMED** — Employer medical/dental/vision contribution
- **401ER** — Employer 401(k) match

These are employer costs, NOT employee deductions. Employee deductions (DNTL, MDCL, 401K, VISON, LIFE) come out of the employee's paycheck and are not included in employer cost calculations.

---

## 9. Fixed Assets & Depreciation

### Asset Categories

The primary fixed asset categories are:

- **Vehicles (M1700)** — The fleet: cargo vans, ProMaster vans, trucks, cube trucks. These are the revenue-generating assets.
- **Trailers (M1800)** — Production trailers, restroom trailers.
- **Other Fixed Assets (M1899)** — Equipment, computers, furniture, leasehold improvements.

### Depreciation Methods

**Book Depreciation:**
- Straight-line (most common)
- Declining balance (double declining with switchover to straight-line)

**Tax Depreciation:**
- MACRS 5-year (vehicles, computers)
- MACRS 7-year (furniture, equipment)
- MACRS 10-year (certain assets)
- Section 179 immediate expensing
- Bonus depreciation (100%/80%/60% depending on year placed in service)

**MACRS Half-Year Convention Tables:**
| Year | 5-Year | 7-Year | 10-Year |
|------|--------|--------|---------|
| 1 | 20.00% | 14.29% | 10.00% |
| 2 | 32.00% | 24.49% | 18.00% |
| 3 | 19.20% | 17.49% | 14.40% |
| 4 | 11.52% | 12.49% | 11.52% |
| 5 | 11.52% | 8.93% | 9.22% |
| 6 | 5.76% | 8.92% | 7.37% |
| 7 | — | 8.93% | 6.55% |
| 8 | — | 4.46% | 6.55% |

### Asset Lifecycle

1. **Acquisition** — Add to GL with cost basis and depreciation method
2. **In-Service** — Depreciation begins
3. **Operate** — Monthly depreciation posted
4. **Disposal/Sale** — Calculate book and tax gain/loss, remove from register

### Reconciliation

Asset GL groups (vehicles_cost, vehicles_accum_depr, trailers_cost, trailers_accum_depr) must reconcile to the asset register each period. This is a Phase 3 close task.

---

## 10. Debt & Financing

### Debt Types

- **Term Loans** — Standard principal + interest amortization schedules. Used for vehicle fleet financing.
- **Lines of Credit (LOC)** — Revolving credit with interest-only payments. Working capital facility.

### Key Accounts

- **M2200: LGJ / Short Term Line of Credit** — Working capital lines, First Source facility, and related short-term borrowings
- **M2600: Other Long Term Liabilities** — Long-term debt
- **M7010: Interest Expense** — Interest on all debt instruments

### Amortization Features

- Standard P&I schedules
- Interest-only (revolving credit)
- Balloon loans (regular P&I with lump sum at maturity)
- Variable rate support (rate changes tracked over time)
- Day count conventions: 30/360, actual/360, actual/365, actual/actual
- Automatic current/long-term split (next 12 months = current; remainder = long-term)

### Reconciliation

Debt GL balances must reconcile to amortization schedules each period (Phase 3 close task).

---

## 11. Real Estate & Leases

### Lease Accounting (ASC 842)

The company follows ASC 842 for lease accounting. Right-of-use (ROU) assets and lease liabilities are recorded on the balance sheet:

- **M1950: Right of Use Lease Assets** — ROU asset balances
- **M2500: Right of Use Lease Liabilities** — Lease liability balances

### Lease Types

- **Operating Leases** — Most facility leases. ROU asset amortized straight-line; lease liability reduced by payments.
- **Finance Leases** — If applicable. Interest expense recognized separately from amortization.

### Maintenance Types

- **Triple Net (NNN)** — Tenant pays base rent + property taxes + insurance + maintenance
- **Gross** — Landlord includes operating costs in rent
- **Modified Gross** — Hybrid structure

### Sublease Support

The system tracks subleases against master leases, including separate payment schedules and profit/loss tracking.

### Cash Flow Reclassification

On the cash flow statement, ROU asset and lease liability changes are reclassified from Investing/Financing to Operating activities. This ensures lease payments appear as operating cash flows consistent with ASC 842 presentation.

---

## 12. Insurance

CloseBook tracks insurance policies including:
- Policy master data (carrier, policy number, premium)
- Coverage types (general liability, property, vehicle, workers' comp, etc.)
- Claims history
- Renewal dates
- Premium allocation by entity

Insurance PDFs can be uploaded and automatically parsed for key terms.

---

## 13. Intercompany Transactions

### How It Works

Intercompany balances are tracked through **Due From / Due To** accounts in the Master GL:

| Due From (Asset) | Due To (Liability) | Counterparty |
|------------------|--------------------|-------------- |
| M1300 | M2300 | Two Family |
| M1310 | M2320 | NCNT Holdings |
| M1320 | M2295 | HSS |
| M1330 | M2340 | HDR |
| M1340 | M2310 | ARH |
| M1350 | — | Bearcat |
| M1360 | M2330 | Versatile |
| M1370 | M2305 | Silverco |

### Elimination Logic

On **consolidated statements**, intercompany accounts flagged as `is_intercompany = true` are zeroed out. At the **entity level**, these balances remain visible.

For any pair of entities A and B:
```
(A's Due From B − A's Due To B) + (B's Due From A − B's Due To A) = 0
```

If this does not equal zero, there is an intercompany imbalance that must be investigated and resolved before close.

### Sign Convention

- Due From (asset, debit-normal): Positive GL balance = normal receivable
- Due To (liability, credit-normal): Negative GL balance in the system = normal payable (displayed as positive for readability)

### Critical Rule

**Intercompany Net-Zero is a critical gate check.** The close cannot be finalized if IC eliminations do not net to zero. Imbalances typically arise from:
- Timing differences in recording transactions between entities
- Misclassified intercompany entries
- Missing offsetting entries in the counterparty entity

---

## 14. Rebate Programs

### Overview

The company has **tiered rebate agreements** with major commercial customers. These rebates reduce the effective revenue earned on rental transactions and represent a significant financial commitment.

### How Rebates Work

1. **Invoice data syncs from RentalWorks** — Header and line-item detail
2. **Equipment type is classified** from order descriptions (vehicle, G&L, studio, pro supplies)
3. **Excluded items are removed** — Loss & damage items (record type "F" or "L") and excluded I-Codes
4. **Taxable sales are backed out** — `Taxable Sales = Tax Amount / (Tax Rate / 100)`
5. **Before-discount base is calculated** — `List Total - Excluded Total - Taxable Sales - Tax Amount`
6. **Discount percentage is computed** — From the actual discount on the invoice
7. **Tier is determined** — Based on cumulative revenue thresholds
8. **Rebate rate applied** — Per equipment type, per tier, with remaining rebate adjusted for discounts already given
9. **Net rebate calculated** — `Before-Discount Base × Remaining Rebate %`

### Tier Structure

Each customer has multiple tiers defined by cumulative revenue thresholds. As the customer spends more through the year, they may move into higher tiers with different rebate rates. Rates vary by equipment type — vehicles may have different rebate rates than grip & lighting equipment.

### Agreement Types

- **Commercial** — Automated calculation from RentalWorks invoice data. Tiered by cumulative revenue.
- **Freelancer** — Manual invoice entry. Simplified calculation with a max discount percent override.

### Key Rebate Insight

Use **InvoiceListTotal** (not InvoiceGrossTotal) for rebate calculations. GrossTotal includes labor, misc charges, and other non-rental items that inflate the base and distort rebate calculations.

---

## 15. Budgeting & Variance Analysis

### Budget Process

1. **Template Generation** — CloseBook generates an Excel template with all Master GL revenue and expense accounts × 12 months
2. **Budget Entry** — Fill in monthly budget amounts
3. **Upload & Approval** — Import back into CloseBook. Budget versions can be draft, approved, or archived. Only one active version per entity per fiscal year.
4. **Variance Reporting** — Actual vs. budget shown on financial statements with dollar and percentage variance

### Variance Calculation

- `Variance = Actual - Budget`
- **Favorable** variance: Revenue actual > budget; Expense actual < budget
- **Unfavorable** variance: Revenue actual < budget; Expense actual > budget

### Pro Forma Adjustments

For what-if modeling, CloseBook supports **double-entry pro forma adjustments**:
- Primary account gets +amount, offset account gets −amount
- Ensures balance sheet stays balanced even with hypothetical adjustments
- Can be included or excluded from financial statement views
- Period-specific (not cumulative)

---

## 16. Day-to-Day Responsibilities

### Daily

- [ ] Monitor QBO sync status in CloseBook (daily cron runs automatically)
- [ ] Review any outstanding invoices or payment approvals in QBO
- [ ] Check for new rental contracts and ensure proper revenue recognition timing

### Weekly

- [ ] Review accounts receivable aging — follow up on past-due balances
- [ ] Review accounts payable — ensure timely vendor payments
- [ ] Check intercompany balances for any unexpected movements
- [ ] Review payroll cost allocation reports for accuracy

### Monthly (Close Cycle)

**Week 1 after period end:**
- [ ] Verify QBO data sync is complete for the closed month
- [ ] Complete all bank reconciliations in QBO
- [ ] Confirm revenue cutoff (all period invoices entered)
- [ ] Process payroll accrual in CloseBook
- [ ] Run depreciation calculations and post entries
- [ ] Record any manual adjusting journal entries

**Week 2 after period end:**
- [ ] Complete subledger reconciliations (debt, assets, leases)
- [ ] Reconcile payroll to Paylocity reports
- [ ] Review and resolve any intercompany imbalances
- [ ] Run trial balance review — investigate anomalies

**Week 3 after period end:**
- [ ] Generate and review financial statements (P&L, BS, CFS) for all entities
- [ ] Run consolidated statements and verify eliminations
- [ ] Perform flux analysis (month-over-month, budget-to-actual)
- [ ] Run gate checks — all three critical checks must pass
- [ ] Management review and sign-off

### Quarterly

- [ ] Rebate calculations and accruals for commercial customers
- [ ] Review customer tier progressions
- [ ] Insurance renewal tracking
- [ ] Lease payment verification and ASC 842 schedule updates

### Annually

- [ ] Budget preparation (Excel template → CloseBook upload)
- [ ] Tax depreciation schedules (MACRS, Section 179, Bonus)
- [ ] Annual insurance renewal processing
- [ ] Debt schedule updates for new/maturing instruments
- [ ] Year-end closing entries and retained earnings rollforward
- [ ] Support external tax preparation (book-to-tax differences)

---

## 17. Key Contacts & Access

### Systems Access Needed

| System | Purpose | Access Type |
|--------|---------|-------------|
| **CloseBook** | Financial consolidation, close management, reporting | closebook.vercel.app — Request user account |
| **QuickBooks Online** | GL, journal entries, bank recs, AP/AR | Separate login per entity — Request Accountant access |
| **RentalWorks** | Rental operations, invoices, contracts | hdr.rentalworks.cloud — Request read access |
| **Paylocity** | Payroll, employee data, pay statements | Request access for both companies (132427, 316791) |

### CloseBook User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Full access to all entities, settings, master GL, user management |
| **Controller** | Full access to all entities, financial statements, close management |
| **Preparer** | Can work on assigned entities — enter data, run tasks |
| **Reviewer** | Read-only access — can review and approve close tasks |

---

## 18. Common Pitfalls & Gotchas

### Entity Confusion
- **ARH ≠ Silverco.** Despite "Avon Rental Holdings" sounding like the parent, ARH and Silverco are distinct entities. Intercompany transactions between them must be properly eliminated.

### Payroll Allocation
- Employees on Silverco's payroll (company 132427) may actually work for HDR or Versatile. Always check cost center assignments. An employee with cost center "07" (Versatile) or "300" (HDR A/C) has their costs allocated to those entities, not Silverco.

### RentalWorks API
- Browse responses return **positional arrays**, not named objects. Always use the ColumnIndex mapping.
- The `Deal` endpoint has a **capital D** — case-sensitive.
- **InvoiceListTotal** for rebate/revenue analysis; **InvoiceGrossTotal** only for total billing amounts.

### Financial Statements
- Balance sheet **must balance every period** — this is enforced as a critical gate check.
- Pro forma adjustments are **period-specific**, not cumulative. Each adjustment applies only to its designated month.
- Cash flow statement reclassifies ROU lease items from Investing/Financing to Operating.

### Intercompany
- IC eliminations must **net to zero** — this is a blocking gate check for close.
- **Two Family and NCNT Holdings** are asset companies within the Avon reporting entity — their intercompany balances reflect vehicle and trailer ownership and ARE eliminated on consolidated statements.
- **Bearcat** is external to the consolidation — its due-from/due-to balances are NOT eliminated on consolidated statements.

### QBO Sync
- GL balances are synced, not individual transactions. CloseBook shows period-level balances.
- After making journal entries in QBO, wait for the next sync cycle (or trigger manually) before reviewing in CloseBook.
- **Paginate all Supabase queries** — never assume fewer than 1,000 rows.

### Rebates
- Rebate tiers are based on **cumulative** revenue — the tier lookup uses total revenue before the current invoice, not just the current period.
- Loss & damage items (record types "F" and "L") are automatically excluded from rebate-eligible revenue.

### Deployment
- CloseBook is deployed via Vercel from the `main` git branch. Pushing to main triggers automatic deployment.
- **Never move published content to draft** during deployments.
- User testing happens in **production** (closebook.vercel.app), not localhost.

---

## Appendix: CloseBook Module Reference

| Module | URL Pattern | Purpose |
|--------|-------------|---------|
| Dashboard | `/dashboard` | Organization-level overview |
| Entity Dashboard | `/{entityId}/dashboard` | Entity-specific overview |
| Accounts | `/{entityId}/accounts` | Chart of accounts (from QBO) |
| Trial Balance | `/{entityId}/trial-balance` | Period GL balances |
| Financial Statements | `/{entityId}/reports` | Entity-level P&L, BS, CFS |
| Financial Model | `/reports/financial-model` | Consolidated financial statements |
| Close | `/{entityId}/close` | Month-end close workflow |
| Close Dashboard | `/close-dashboard` | Cross-entity close progress |
| Assets | `/{entityId}/assets` | Fixed asset register & depreciation |
| Debt | `/{entityId}/debt` | Debt instruments & amortization |
| Real Estate | `/{entityId}/real-estate` | Leases & ASC 842 |
| Insurance | `/{entityId}/insurance` | Insurance policies & claims |
| Employees | `/{entityId}/employees` | Employee roster & cost allocation |
| Payroll | `/payroll` | Payroll summary & accruals |
| Payroll Monthly | `/payroll/monthly` | Monthly payroll detail |
| Revenue | `/{entityId}/revenue` | Revenue accruals & deferrals |
| Revenue Projection | `/{entityId}/revenue-projection` | Forward-looking revenue forecast |
| Rebates | `/{entityId}/rebates` | Rebate tracking & calculations |
| Commissions | `/{entityId}/commissions` | Commission analysis |
| Schedules | `/{entityId}/schedules` | Supporting schedules |
| IC Eliminations | `/ic-eliminations` | Intercompany elimination dashboard |
| TB Variance | `/tb-variance` | Trial balance variance analysis |
| QBO Sync | `/sync` | Data sync status & triggers |
| Settings | `/settings` | Organization settings |
| Master GL | `/settings/master-gl` | Master chart of accounts & mappings |
| Reporting Entities | `/settings/reporting-entities` | Consolidation group management |
| Members | `/settings/members` | User access management |
