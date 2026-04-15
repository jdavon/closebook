// One-time backfill for the freeze-at-opening engine change.
//
// For every asset:
//   1. Regenerate the subledger using the current engine (via the API that
//      the dispose flow already calls) so book_accumulated reflects the
//      freeze-at-opening policy.
//   2. Update the asset header's book_accumulated_depreciation to the last
//      emitted subledger row.
//   3. For disposed assets: recompute disposed_book_gain_loss using the
//      prior-month book_accumulated (under the no-depreciation-in-disposal
//      -month policy) and the recorded sale price.
//
// Run: node scripts/regenerate-all-and-recompute-disposals.mjs [--apply]
// Without --apply, prints dry-run summary. Pass --apply to execute.

import fs from "node:fs";
import path from "node:path";
import {
  generateDepreciationSchedule,
  buildOpeningBalance,
} from "../src/lib/utils/depreciation.ts";

// Since Node can't import .ts directly without a loader, we'll re-implement
// the minimum engine logic inline. The critical pieces: freeze-at-opening,
// no-book-depr-in-disposal-month, emitted depreciation = change in accum.

const APPLY = process.argv.includes("--apply");

const envText = fs.readFileSync(path.resolve("./.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
const rest = async (p, init = {}) => {
  const r = await fetch(`${URL}/rest/v1${p}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const parse = (iso) => {
  const [y, m] = iso.split("T")[0].split("-").map(Number);
  return { y, m };
};
const r2 = (n) => Math.round(n * 100) / 100;
const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

// --- Engine (mirrors src/lib/utils/depreciation.ts) ----------------------

const MACRS = {
  macrs_5: [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  macrs_7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  macrs_10: [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
};

function macrsMonthly(basis, method, ins, y, m) {
  const table = MACRS[method];
  if (!table) return 0;
  const taxYear = y - ins.y;
  if (taxYear < 0 || taxYear >= table.length) return 0;
  const annual = basis * (table[taxYear] / 100);
  let monthsInYear;
  if (taxYear === 0) {
    monthsInYear = 13 - ins.m;
    if (y !== ins.y) return 0;
    if (m < ins.m) return 0;
  } else {
    const ey = ins.y + taxYear;
    if (y !== ey) return 0;
    monthsInYear = 12;
  }
  if (monthsInYear <= 0) return 0;
  return r2(annual / monthsInYear);
}

function bookDepr(asset, y, m) {
  if (asset.book_depreciation_method === "none") return 0;
  const ins = parse(asset.in_service_date);
  const elapsed = (y - ins.y) * 12 + (m - ins.m);
  if (elapsed < 0) return 0;
  if (elapsed >= asset.book_useful_life_months) return 0;
  if (asset.disposed_date) {
    const d = parse(asset.disposed_date);
    if (y > d.y || (y === d.y && m >= d.m)) return 0;
  }
  const basis = asset.acquisition_cost - asset.book_salvage_value;
  if (basis <= 0) return 0;
  if (asset.book_depreciation_method === "straight_line") {
    return r2(basis / asset.book_useful_life_months);
  }
  // DDB path omitted — not used by Avon's rental register.
  return 0;
}

function taxDeprMonthly(asset, y, m) {
  const method = asset.tax_depreciation_method;
  if (method === "none") return 0;
  const basis = asset.tax_cost_basis ?? asset.acquisition_cost;
  const ins = parse(asset.in_service_date);
  const elapsed = (y - ins.y) * 12 + (m - ins.m);
  if (elapsed < 0) return 0;
  if (method === "section_179") {
    return elapsed === 0 ? r2(Math.min(asset.section_179_amount || basis, basis)) : 0;
  }
  if (method === "bonus_100" || method === "bonus_80" || method === "bonus_60") {
    if (elapsed === 0) {
      const pct = method === "bonus_100" ? 1 : method === "bonus_80" ? 0.8 : 0.6;
      return r2(Math.min(asset.bonus_depreciation_amount || basis * pct, basis));
    }
    if (method !== "bonus_100") {
      const pct = method === "bonus_80" ? 0.8 : 0.6;
      const bonus = asset.bonus_depreciation_amount || basis * pct;
      const remaining = basis - bonus;
      if (remaining <= 0) return 0;
      return macrsMonthly(remaining, "macrs_5", ins, y, m);
    }
    return 0;
  }
  if (method === "straight_line_tax") {
    const life = asset.tax_useful_life_months || 60;
    if (elapsed >= life) return 0;
    return r2(basis / life);
  }
  if (method in MACRS) return macrsMonthly(basis, method, ins, y, m);
  return 0;
}

function genSchedule(asset, throughY, throughM, opening) {
  const entries = [];
  const ins = parse(asset.in_service_date);
  const taxBasis = asset.tax_cost_basis ?? asset.acquisition_cost;
  const bookCeiling = Math.max(
    asset.acquisition_cost - asset.book_salvage_value,
    opening?.openingBookAccum ?? 0
  );
  const taxCeiling = Math.max(taxBasis, opening?.openingTaxAccum ?? 0);
  let bookAccum = 0, taxAccum = 0;
  let cy = ins.y, cm = ins.m;
  let emitting = !opening;
  let openingApplied = false;
  while (cy < throughY || (cy === throughY && cm <= throughM)) {
    const rawBook = bookDepr(asset, cy, cm);
    const rawTax = taxDeprMonthly(asset, cy, cm);
    let bb = bookAccum, tb = taxAccum;
    if (opening && !openingApplied) {
      if (cy > opening.fromYear || (cy === opening.fromYear && cm >= opening.fromMonth)) {
        bookAccum = opening.openingBookAccum + rawBook;
        taxAccum = opening.openingTaxAccum + rawTax;
        bb = opening.openingBookAccum;
        tb = opening.openingTaxAccum;
        openingApplied = true; emitting = true;
      }
    } else {
      bookAccum += rawBook;
      taxAccum += rawTax;
    }
    if (emitting) {
      bookAccum = Math.min(bookAccum, bookCeiling);
      taxAccum = Math.min(taxAccum, taxCeiling);
      entries.push({
        period_year: cy,
        period_month: cm,
        book_depreciation: r2(bookAccum - bb),
        book_accumulated: r2(bookAccum),
        book_net_value: r2(asset.acquisition_cost - bookAccum),
        tax_depreciation: r2(taxAccum - tb),
        tax_accumulated: r2(taxAccum),
        tax_net_value: r2(taxBasis - taxAccum),
      });
    }
    if (asset.disposed_date) {
      const d = parse(asset.disposed_date);
      if (cy > d.y || (cy === d.y && cm >= d.m)) break;
    }
    cm++; if (cm > 12) { cm = 1; cy++; }
  }
  return entries;
}

// --- Backfill ------------------------------------------------------------

const now = new Date();
const throughY = now.getFullYear();
const throughM = now.getMonth() + 1;

const entities = await rest(`/entities?select=id,name,rental_asset_opening_date`);
const assets = await rest(
  `/fixed_assets?select=id,entity_id,asset_tag,acquisition_cost,in_service_date,book_useful_life_months,book_salvage_value,book_depreciation_method,tax_cost_basis,tax_depreciation_method,tax_useful_life_months,section_179_amount,bonus_depreciation_amount,status,disposed_date,disposed_sale_price,disposed_book_gain_loss,disposed_tax_gain_loss,book_accumulated_depreciation,tax_accumulated_depreciation&status=in.(active,disposed,fully_depreciated)`
);

const entityOpening = {};
for (const e of entities) entityOpening[e.id] = e.rental_asset_opening_date;

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — processing ${assets.length} assets across ${entities.length} entities\n`);

let regenCount = 0, headerChanges = 0, disposalGainLossChanges = 0, frozenAssets = 0;
const bookGLSamples = [];

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  const openingIso = entityOpening[a.entity_id];
  if (!openingIso) continue;
  const { y: oy, m: om } = parse(openingIso);

  const openingRows = await rest(
    `/fixed_asset_depreciation?select=book_accumulated,tax_accumulated&fixed_asset_id=eq.${a.id}&period_year=eq.${oy}&period_month=eq.${om}&is_manual_override=eq.true`
  );
  const openingBook = openingRows.length > 0 ? Number(openingRows[0].book_accumulated) : 0;
  const openingTax = openingRows.length > 0 ? Number(openingRows[0].tax_accumulated) : 0;
  const opening = { fromYear: oy, fromMonth: om + 1, openingBookAccum: openingBook, openingTaxAccum: openingTax };

  const assetForCalc = {
    acquisition_cost: Number(a.acquisition_cost),
    in_service_date: a.in_service_date,
    book_useful_life_months: a.book_useful_life_months,
    book_salvage_value: Number(a.book_salvage_value),
    book_depreciation_method: a.book_depreciation_method,
    tax_cost_basis: a.tax_cost_basis != null ? Number(a.tax_cost_basis) : null,
    tax_depreciation_method: a.tax_depreciation_method,
    tax_useful_life_months: a.tax_useful_life_months,
    section_179_amount: Number(a.section_179_amount ?? 0),
    bonus_depreciation_amount: Number(a.bonus_depreciation_amount ?? 0),
    disposed_date: a.disposed_date,
  };

  const ruleCeiling = assetForCalc.acquisition_cost - assetForCalc.book_salvage_value;
  const frozen = openingBook > ruleCeiling + 0.01;
  if (frozen) frozenAssets++;

  const schedule = genSchedule(assetForCalc, throughY, throughM, opening);
  if (schedule.length === 0) continue;

  const lastEntry = schedule[schedule.length - 1];
  const newHeaderBook = lastEntry.book_accumulated;
  const newHeaderTax = lastEntry.tax_accumulated;

  const headerBookChanged = Math.abs(newHeaderBook - Number(a.book_accumulated_depreciation)) > 0.01;
  const headerTaxChanged = Math.abs(newHeaderTax - Number(a.tax_accumulated_depreciation ?? 0)) > 0.01;

  // Compute new disposed_book_gain_loss for disposed assets — use the
  // accum from the entry strictly BEFORE the disposal month (book) and
  // through disposal month (tax).
  let newBookGL = null, newTaxGL = null;
  if (a.status === "disposed" && a.disposed_date) {
    const { y: dy, m: dm } = parse(a.disposed_date);
    const priorBookAccum = (() => {
      for (let i = schedule.length - 1; i >= 0; i--) {
        const e = schedule[i];
        if (e.period_year < dy || (e.period_year === dy && e.period_month < dm)) {
          return e.book_accumulated;
        }
      }
      return openingBook;
    })();
    const taxAccumAtDisp = (() => {
      for (let i = schedule.length - 1; i >= 0; i--) {
        const e = schedule[i];
        if (e.period_year < dy || (e.period_year === dy && e.period_month <= dm)) {
          return e.tax_accumulated;
        }
      }
      return openingTax;
    })();
    const sale = Number(a.disposed_sale_price ?? 0);
    const taxBasis = Number(a.tax_cost_basis ?? a.acquisition_cost);
    newBookGL = r2(sale - (Number(a.acquisition_cost) - priorBookAccum));
    newTaxGL = r2(sale - (taxBasis - taxAccumAtDisp));
    const storedBookGL = Number(a.disposed_book_gain_loss ?? 0);
    if (Math.abs(newBookGL - storedBookGL) > 0.01) {
      disposalGainLossChanges++;
      if (bookGLSamples.length < 20) {
        bookGLSamples.push({ tag: a.asset_tag, stored: storedBookGL, next: newBookGL, delta: r2(newBookGL - storedBookGL) });
      }
    }
  }

  if (!APPLY) {
    if (headerBookChanged || headerTaxChanged) headerChanges++;
    regenCount++;
    continue;
  }

  // APPLY path
  const manualRows = await rest(
    `/fixed_asset_depreciation?select=period_year,period_month&fixed_asset_id=eq.${a.id}&is_manual_override=eq.true`
  );
  const manual = new Set(manualRows.map((r) => `${r.period_year}-${r.period_month}`));

  await rest(
    `/fixed_asset_depreciation?fixed_asset_id=eq.${a.id}&is_manual_override=eq.false`,
    { method: "DELETE" }
  );

  const toInsert = schedule
    .filter((e) => !manual.has(`${e.period_year}-${e.period_month}`))
    .map((e) => ({
      fixed_asset_id: a.id,
      period_year: e.period_year,
      period_month: e.period_month,
      book_depreciation: e.book_depreciation,
      book_accumulated: e.book_accumulated,
      book_net_value: e.book_net_value,
      tax_depreciation: e.tax_depreciation,
      tax_accumulated: e.tax_accumulated,
      tax_net_value: e.tax_net_value,
      is_manual_override: false,
    }));
  if (toInsert.length > 0) {
    await rest(`/fixed_asset_depreciation`, { method: "POST", body: JSON.stringify(toInsert) });
  }

  const headerUpdate = {
    book_accumulated_depreciation: newHeaderBook,
    tax_accumulated_depreciation: newHeaderTax,
  };
  if (newBookGL != null) headerUpdate.disposed_book_gain_loss = newBookGL;
  if (newTaxGL != null) headerUpdate.disposed_tax_gain_loss = newTaxGL;

  await rest(`/fixed_assets?id=eq.${a.id}`, {
    method: "PATCH",
    body: JSON.stringify(headerUpdate),
  });
  if (headerBookChanged || headerTaxChanged) headerChanges++;
  regenCount++;

  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${assets.length} processed`);
}

console.log(`\nAssets regenerated:           ${regenCount}`);
console.log(`Headers updated:              ${headerChanges}`);
console.log(`Disposed gain/loss changes:   ${disposalGainLossChanges}`);
console.log(`Assets with frozen opening:   ${frozenAssets}`);
if (bookGLSamples.length > 0) {
  console.log(`\nSample gain/loss changes:`);
  console.log("Tag".padEnd(10) + "Stored".padStart(14) + "New".padStart(14) + "Δ".padStart(12));
  for (const s of bookGLSamples) {
    console.log(String(s.tag).padEnd(10) + s.stored.toFixed(2).padStart(14) + s.next.toFixed(2).padStart(14) + s.delta.toFixed(2).padStart(12));
  }
}
console.log(APPLY ? "\nAPPLIED." : "\nDry run — re-run with --apply.");
