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
  const d = new Date(dateStr);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
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

// Generate full depreciation schedule from in-service date through target period
export function generateDepreciationSchedule(
  asset: AssetForDepreciation,
  throughYear: number,
  throughMonth: number
): DepreciationEntry[] {
  const entries: DepreciationEntry[] = [];
  const inService = parseDate(asset.in_service_date);
  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;

  let bookAccum = 0;
  let taxAccum = 0;
  let cy = inService.year;
  let cm = inService.month;

  while (cy < throughYear || (cy === throughYear && cm <= throughMonth)) {
    const bookDepr = calculateMonthlyBookDepreciation(asset, cy, cm);
    const taxDepr = calculateMonthlyTaxDepreciation(asset, cy, cm);

    bookAccum += bookDepr;
    taxAccum += taxDepr;

    // Cap accumulated to not exceed basis
    bookAccum = Math.min(bookAccum, asset.acquisition_cost - asset.book_salvage_value);
    taxAccum = Math.min(taxAccum, taxBasis);

    entries.push({
      period_year: cy,
      period_month: cm,
      book_depreciation: Math.round(bookDepr * 100) / 100,
      book_accumulated: Math.round(bookAccum * 100) / 100,
      book_net_value: Math.round((asset.acquisition_cost - bookAccum) * 100) / 100,
      tax_depreciation: Math.round(taxDepr * 100) / 100,
      tax_accumulated: Math.round(taxAccum * 100) / 100,
      tax_net_value: Math.round((taxBasis - taxAccum) * 100) / 100,
    });

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
