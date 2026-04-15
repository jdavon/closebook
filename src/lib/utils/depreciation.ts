// Depreciation calculation engine for fixed assets
// Supports book (straight-line, declining balance) and tax (MACRS, Section 179, bonus) methods

export interface AssetForDepreciation {
  acquisition_cost: number;
  in_service_date: string; // ISO date
  book_useful_life_months: number;
  book_salvage_value: number;
  book_depreciation_method: string;
  tax_cost_basis: number | null;
  tax_depreciation_method: string;
  tax_useful_life_months: number | null;
  section_179_amount: number;
  bonus_depreciation_amount: number;
  // Book policy: no depreciation in the month of disposal or any month after.
  // Tax depreciation ignores this — MACRS has its own disposal conventions.
  disposed_date: string | null;
}

export interface DepreciationEntry {
  period_year: number;
  period_month: number;
  book_depreciation: number;
  book_accumulated: number;
  book_net_value: number;
  tax_depreciation: number;
  tax_accumulated: number;
  tax_net_value: number;
}

// MACRS percentage tables (half-year convention, 200% declining balance)
const MACRS_TABLES: Record<string, number[]> = {
  macrs_5: [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  macrs_7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  macrs_10: [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
};

function parseDate(dateStr: string): { year: number; month: number } {
  // Split the ISO date string directly to avoid timezone shift issues.
  // new Date("2023-06-01") parses as UTC midnight, which in US timezones
  // shifts to the previous day — potentially the wrong month/year.
  const parts = dateStr.split("T")[0].split("-");
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
}

function monthsBetween(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): number {
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}

// Book depreciation: straight-line or declining balance
export function calculateMonthlyBookDepreciation(
  asset: AssetForDepreciation,
  year: number,
  month: number
): number {
  if (asset.book_depreciation_method === "none") return 0;

  const inService = parseDate(asset.in_service_date);
  const monthsElapsed = monthsBetween(inService.year, inService.month, year, month);

  // Not yet in service or past useful life
  if (monthsElapsed < 0) return 0;
  if (monthsElapsed >= asset.book_useful_life_months) return 0;

  // Book policy: no depreciation in the disposal month or any month after.
  // Final accumulated depreciation is frozen at the end of the month prior
  // to disposal, so gain/loss = sale price − (cost − accum at prior month-end).
  if (asset.disposed_date) {
    const disp = parseDate(asset.disposed_date);
    if (year > disp.year || (year === disp.year && month >= disp.month)) return 0;
  }

  const depreciableBasis = asset.acquisition_cost - asset.book_salvage_value;
  if (depreciableBasis <= 0) return 0;

  if (asset.book_depreciation_method === "straight_line") {
    return Math.round((depreciableBasis / asset.book_useful_life_months) * 100) / 100;
  }

  if (asset.book_depreciation_method === "declining_balance") {
    // Double declining balance with switch to straight-line
    const rate = 2 / asset.book_useful_life_months;
    let accumulated = 0;
    const is = parseDate(asset.in_service_date);
    let cy = is.year;
    let cm = is.month;

    for (let i = 0; i <= monthsElapsed; i++) {
      const currentNbv = asset.acquisition_cost - accumulated;
      const ddbAmount = currentNbv * rate;
      const remainingMonths = asset.book_useful_life_months - i;
      const slAmount = remainingMonths > 0 ? (currentNbv - asset.book_salvage_value) / remainingMonths : 0;
      const depr = Math.max(ddbAmount, slAmount);
      const capped = Math.min(depr, currentNbv - asset.book_salvage_value);
      const finalDepr = Math.max(0, Math.round(capped * 100) / 100);

      if (cy === year && cm === month) {
        return finalDepr;
      }

      accumulated += finalDepr;
      cm++;
      if (cm > 12) { cm = 1; cy++; }
    }
  }

  return 0;
}

// Tax depreciation: MACRS, Section 179, bonus depreciation
export function calculateMonthlyTaxDepreciation(
  asset: AssetForDepreciation,
  year: number,
  month: number
): number {
  const method = asset.tax_depreciation_method;
  if (method === "none") return 0;

  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;
  const inService = parseDate(asset.in_service_date);
  const monthsElapsed = monthsBetween(inService.year, inService.month, year, month);

  if (monthsElapsed < 0) return 0;

  // Section 179: full deduction in the month placed in service
  if (method === "section_179") {
    if (monthsElapsed === 0) {
      return Math.round(Math.min(asset.section_179_amount || taxBasis, taxBasis) * 100) / 100;
    }
    return 0;
  }

  // Bonus depreciation: full percentage in the first month
  if (method === "bonus_100" || method === "bonus_80" || method === "bonus_60") {
    if (monthsElapsed === 0) {
      const pct = method === "bonus_100" ? 1.0 : method === "bonus_80" ? 0.8 : 0.6;
      const bonusAmount = asset.bonus_depreciation_amount || taxBasis * pct;
      return Math.round(Math.min(bonusAmount, taxBasis) * 100) / 100;
    }
    // Remaining basis depreciated via MACRS 5-year for the rest
    if (method !== "bonus_100") {
      const pct = method === "bonus_80" ? 0.8 : 0.6;
      const bonusUsed = asset.bonus_depreciation_amount || taxBasis * pct;
      const remainingBasis = taxBasis - bonusUsed;
      if (remainingBasis <= 0) return 0;
      return calculateMacrsMonthly(remainingBasis, "macrs_5", inService, year, month, monthsElapsed);
    }
    return 0;
  }

  // Straight-line tax
  if (method === "straight_line_tax") {
    const life = asset.tax_useful_life_months || 60;
    if (monthsElapsed >= life) return 0;
    return Math.round((taxBasis / life) * 100) / 100;
  }

  // MACRS methods
  if (method in MACRS_TABLES) {
    return calculateMacrsMonthly(taxBasis, method, inService, year, month, monthsElapsed);
  }

  return 0;
}

function calculateMacrsMonthly(
  basis: number,
  method: string,
  inService: { year: number; month: number },
  year: number,
  month: number,
  monthsElapsed: number
): number {
  const table = MACRS_TABLES[method];
  if (!table) return 0;

  // MACRS uses tax years from the in-service date
  // Year 1 starts in the in-service year
  const taxYear = year - inService.year;
  // In the in-service year, only count from in-service month
  // After that, it's a full 12-month year

  if (taxYear < 0 || taxYear >= table.length) return 0;

  const annualPct = table[taxYear] / 100;
  const annualDepr = basis * annualPct;

  // Distribute annual amount evenly across 12 months
  // In the first year, distribute across remaining months
  let monthsInYear: number;
  if (taxYear === 0) {
    monthsInYear = 13 - inService.month; // months remaining in first year
    // Only apply if we're in the in-service year
    if (year !== inService.year) return 0;
    if (month < inService.month) return 0;
  } else {
    // Full year — check we're in the right calendar year
    const expectedYear = inService.year + taxYear;
    if (year !== expectedYear) return 0;
    monthsInYear = 12;
  }

  if (monthsInYear <= 0) return 0;
  return Math.round((annualDepr / monthsInYear) * 100) / 100;
}

/**
 * Options for generating a depreciation schedule with an opening balance.
 * When provided, entries are only emitted from `fromYear/fromMonth` onward,
 * and accumulated depreciation starts from the opening values (imported
 * balances as of the opening date) rather than recalculating from the
 * in-service date. `fromYear/fromMonth` represents the first emitted period —
 * typically the month *after* the opening balance cutoff.
 */
export interface ScheduleOpeningBalance {
  fromYear: number;
  fromMonth: number;
  openingBookAccum: number;
  openingTaxAccum: number;
}

/**
 * Parse an ISO opening date (YYYY-MM-DD) into its year and month components
 * without timezone shift.
 */
export function parseOpeningDate(isoDate: string): {
  year: number;
  month: number;
} {
  const parts = isoDate.split("T")[0].split("-");
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
  };
}

/**
 * Build a ScheduleOpeningBalance anchored to the given opening date. Entries
 * are emitted starting the month *after* the opening date.
 */
export function buildOpeningBalance(
  openingDateIso: string,
  openingBookAccum: number,
  openingTaxAccum: number
): ScheduleOpeningBalance {
  const { year, month } = parseOpeningDate(openingDateIso);
  return {
    fromYear: year,
    fromMonth: month + 1,
    openingBookAccum,
    openingTaxAccum,
  };
}

// Generate full depreciation schedule from in-service date through target period
export function generateDepreciationSchedule(
  asset: AssetForDepreciation,
  throughYear: number,
  throughMonth: number,
  opening?: ScheduleOpeningBalance
): DepreciationEntry[] {
  const entries: DepreciationEntry[] = [];
  const inService = parseDate(asset.in_service_date);
  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;

  // Effective ceiling — never let the cap pull accumulated BELOW the opening
  // balance. If a historical opening was imported above (cost − salvage), we
  // freeze accumulated at that opening rather than reversing the excess.
  // Subsequent periods emit book_depreciation = 0 as long as the freeze holds.
  const bookCeiling = Math.max(
    asset.acquisition_cost - asset.book_salvage_value,
    opening?.openingBookAccum ?? 0
  );
  const taxCeiling = Math.max(taxBasis, opening?.openingTaxAccum ?? 0);

  let bookAccum = 0;
  let taxAccum = 0;
  let cy = inService.year;
  let cm = inService.month;

  // If we have an opening balance, we still iterate from in-service (so
  // calculateMonthly* sees correct monthsElapsed), but we only emit entries
  // from the opening period onward and reset accumulated to the opening values.
  let emitting = !opening;
  let openingApplied = false;

  while (cy < throughYear || (cy === throughYear && cm <= throughMonth)) {
    const rawBookDepr = calculateMonthlyBookDepreciation(asset, cy, cm);
    const rawTaxDepr = calculateMonthlyTaxDepreciation(asset, cy, cm);

    // Baseline for computing emitted depreciation as the change in
    // accumulated. Normal month: prior bookAccum. Opening emit: the pinned
    // opening balance (so depreciation reflects only this month's
    // contribution). Keeps the roll-forward identity
    // `ending = beginning + depreciation − disposals` balanced.
    let bookBaseline = bookAccum;
    let taxBaseline = taxAccum;

    if (opening && !openingApplied) {
      if (cy > opening.fromYear || (cy === opening.fromYear && cm >= opening.fromMonth)) {
        bookAccum = opening.openingBookAccum + rawBookDepr;
        taxAccum = opening.openingTaxAccum + rawTaxDepr;
        bookBaseline = opening.openingBookAccum;
        taxBaseline = opening.openingTaxAccum;
        openingApplied = true;
        emitting = true;
      }
    } else {
      bookAccum += rawBookDepr;
      taxAccum += rawTaxDepr;
    }

    if (emitting) {
      bookAccum = Math.min(bookAccum, bookCeiling);
      taxAccum = Math.min(taxAccum, taxCeiling);

      const emittedBookDepr = bookAccum - bookBaseline;
      const emittedTaxDepr = taxAccum - taxBaseline;

      entries.push({
        period_year: cy,
        period_month: cm,
        book_depreciation: Math.round(emittedBookDepr * 100) / 100,
        book_accumulated: Math.round(bookAccum * 100) / 100,
        book_net_value: Math.round((asset.acquisition_cost - bookAccum) * 100) / 100,
        tax_depreciation: Math.round(emittedTaxDepr * 100) / 100,
        tax_accumulated: Math.round(taxAccum * 100) / 100,
        tax_net_value: Math.round((taxBasis - taxAccum) * 100) / 100,
      });
    }

    // Stop emitting entries after the disposal month — the asset is off the
    // books. The disposal month row itself is still written (book_depreciation
    // will be 0 under the no-depreciation-in-disposal-month policy) so the
    // subledger shows the final accumulated balance at disposal.
    if (asset.disposed_date) {
      const disp = parseDate(asset.disposed_date);
      if (cy > disp.year || (cy === disp.year && cm >= disp.month)) break;
    }

    cm++;
    if (cm > 12) { cm = 1; cy++; }
  }

  return entries;
}

// Calculate gain/loss on disposition
export function calculateDispositionGainLoss(
  acquisitionCost: number,
  bookAccumulatedDepreciation: number,
  bookSalvageValue: number,
  taxCostBasis: number,
  taxAccumulatedDepreciation: number,
  salePrice: number
): { bookGainLoss: number; taxGainLoss: number } {
  const bookNbv = acquisitionCost - bookAccumulatedDepreciation;
  const taxNbv = taxCostBasis - taxAccumulatedDepreciation;

  return {
    bookGainLoss: Math.round((salePrice - bookNbv) * 100) / 100,
    taxGainLoss: Math.round((salePrice - taxNbv) * 100) / 100,
  };
}
