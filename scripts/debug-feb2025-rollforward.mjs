// Debug: reproduce the Vehicles roll-forward math for NCNT Feb 2025.
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve("./.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const rest = async (p) => {
  const r = await fetch(`${URL}/rest/v1${p}`, { headers });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
};

const ENTITY = "cb56911c-8c00-4cba-9ea0-6f62b6c46ffd";
const TRAILER_CLASSES = new Set(["1R","2R","3R","13T","20T"]);
const isVehicle = (cls) => cls && !TRAILER_CLASSES.has(cls);

const assets = await rest(
  `/fixed_assets?select=id,asset_tag,vehicle_class,acquisition_cost,in_service_date,book_useful_life_months,book_salvage_value,book_depreciation_method,status,disposed_date&entity_id=eq.${ENTITY}`
);
const rules = await rest(
  `/asset_depreciation_rules?select=reporting_group,book_useful_life_months,book_salvage_pct,book_depreciation_method&entity_id=eq.${ENTITY}`
);
const rulesMap = {};
for (const r of rules) rulesMap[r.reporting_group] = r;

const classToGroup = {
  "31": "Cargo Van", "32": "Cargo Van", "29": "Cargo Van", "30": "Cargo Van",
  "28": "Passenger Van", "28P": "Passenger Van", "28S": "Passenger Van",
  "13": "Box Truck",
};

const parse = (iso) => { const [y, m] = iso.split("T")[0].split("-").map(Number); return { y, m }; };
const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

const openingRows = await rest(
  `/fixed_asset_depreciation?select=fixed_asset_id,book_accumulated&period_year=eq.2024&period_month=eq.12&is_manual_override=eq.true`
);
const openingMap = {};
for (const r of openingRows) openingMap[r.fixed_asset_id] = Number(r.book_accumulated);

function resolveAssetForCalc(a) {
  const group = classToGroup[a.vehicle_class];
  const rule = group ? rulesMap[group] : undefined;
  const salvagePct = rule?.book_salvage_pct;
  const ruleSalvage =
    salvagePct != null
      ? Math.round(Number(a.acquisition_cost) * (Number(salvagePct) / 100) * 100) / 100
      : null;
  const ul = rule?.book_useful_life_months > 0 ? rule.book_useful_life_months : a.book_useful_life_months;
  const salvage = ruleSalvage != null ? ruleSalvage : Number(a.book_salvage_value);
  const method = rule?.book_depreciation_method ?? a.book_depreciation_method;
  return {
    acquisition_cost: Number(a.acquisition_cost),
    in_service_date: a.in_service_date,
    book_useful_life_months: ul,
    book_salvage_value: salvage,
    book_depreciation_method: method,
    disposed_date: a.disposed_date,
  };
}

function monthlyBookDepr(asset, y, m) {
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
    return Math.round((basis / asset.book_useful_life_months) * 100) / 100;
  }
  return 0;
}

// Two variants: BUGGY (raw depr) and FIXED (capped depr)
function runSchedule(a, throughY, throughM, mode) {
  const calc = resolveAssetForCalc(a);
  const opening = openingMap[a.id] ?? 0;
  let bookAccum = opening;
  const ins = parse(a.in_service_date);
  let cy = ins.y, cm = ins.m;
  const entries = {};
  let emitting = false, openingApplied = false;
  while (cy < throughY || (cy === throughY && cm <= throughM)) {
    const rawDepr = monthlyBookDepr(calc, cy, cm);
    let delta = 0;
    if (!openingApplied) {
      if (cy > 2024 || (cy === 2024 && cm >= 13)) {
        bookAccum = opening + rawDepr;
        openingApplied = true; emitting = true;
        delta = rawDepr;
      }
    } else {
      bookAccum += rawDepr;
      delta = rawDepr;
    }
    if (emitting) {
      const before = bookAccum;
      bookAccum = Math.min(bookAccum, calc.acquisition_cost - calc.book_salvage_value);
      if (bookAccum < before) delta -= (before - bookAccum);
      // Allow negative delta — reflects a reversal when opening was above
      // the new rule's salvage cap.
      entries[monthKey(cy, cm)] = {
        book_depreciation: mode === "fixed"
          ? Math.round(delta * 100) / 100
          : Math.round(rawDepr * 100) / 100,
        book_accumulated: Math.round(bookAccum * 100) / 100,
      };
    }
    if (calc.disposed_date) {
      const d = parse(calc.disposed_date);
      if (cy > d.y || (cy === d.y && cm >= d.m)) break;
    }
    cm++; if (cm > 12) { cm = 1; cy++; }
  }
  return entries;
}

function computeRF(mode) {
  const scheduleMap = {};
  for (const a of assets) scheduleMap[a.id] = runSchedule(a, 2025, 3, mode);

  const groupAssets = assets.filter((a) => isVehicle(a.vehicle_class));
  const isInServiceBy = (a, y, m) => {
    const d = parse(a.in_service_date);
    return d.y < y || (d.y === y && d.m <= m);
  };
  const isDisposedBy = (a, y, m) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parse(a.disposed_date);
    return d.y < y || (d.y === y && d.m <= m);
  };
  const isDisposedIn = (a, y, m) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parse(a.disposed_date);
    return d.y === y && d.m === m;
  };
  const accumAt = (a, y, m) => {
    const e = scheduleMap[a.id]?.[monthKey(y, m)];
    if (e) return e.book_accumulated;
    if (y === 2024 && m === 12) return openingMap[a.id] ?? 0;
    return 0;
  };

  const run = (y, m) => {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const heldAtStart = groupAssets.filter((a) => isInServiceBy(a, py, pm) && !isDisposedBy(a, py, pm));
    const beg = heldAtStart.reduce((s, a) => s + accumAt(a, py, pm), 0);
    let depr = 0;
    for (const a of groupAssets) {
      const e = scheduleMap[a.id]?.[monthKey(y, m)];
      if (e) depr += e.book_depreciation;
    }
    const disp = heldAtStart.filter((a) => isDisposedIn(a, y, m));
    const dispAccum = disp.reduce((s, a) => s + accumAt(a, y, m), 0);
    return { beg, depr, dispAccum, end: beg + depr - dispAccum };
  };
  return { jan: run(2025, 1), feb: run(2025, 2) };
}

// Per-asset contribution delta between Jan-end and Feb-beg.
// If math is consistent, every delta should be 0.
function diag() {
  const scheduleMap = {};
  for (const a of assets) scheduleMap[a.id] = runSchedule(a, 2025, 3, "buggy");
  const groupAssets = assets.filter((a) => isVehicle(a.vehicle_class));
  const isInServiceBy = (a, y, m) => { const d = parse(a.in_service_date); return d.y < y || (d.y === y && d.m <= m); };
  const isDisposedBy = (a, y, m) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parse(a.disposed_date);
    return d.y < y || (d.y === y && d.m <= m);
  };
  const isDisposedIn = (a, y, m) => {
    if (!a.disposed_date || a.status !== "disposed") return false;
    const d = parse(a.disposed_date);
    return d.y === y && d.m === m;
  };
  const accumAt = (a, y, m) => {
    const e = scheduleMap[a.id]?.[monthKey(y, m)];
    if (e) return e.book_accumulated;
    if (y === 2024 && m === 12) return openingMap[a.id] ?? 0;
    return 0;
  };
  const deltas = [];
  for (const a of groupAssets) {
    const inJanHeld = isInServiceBy(a, 2024, 12) && !isDisposedBy(a, 2024, 12);
    const inFebHeld = isInServiceBy(a, 2025, 1) && !isDisposedBy(a, 2025, 1);
    const janDispose = inJanHeld && isDisposedIn(a, 2025, 1);
    const decAccum = inJanHeld ? accumAt(a, 2024, 12) : 0;
    const janDepr = scheduleMap[a.id]?.[monthKey(2025, 1)]?.book_depreciation ?? 0;
    const janAccumForDisp = janDispose ? accumAt(a, 2025, 1) : 0;
    const contribJanEnd = decAccum + janDepr - janAccumForDisp;
    const contribFebBeg = inFebHeld ? accumAt(a, 2025, 1) : 0;
    const d = contribJanEnd - contribFebBeg;
    if (Math.abs(d) > 0.01) deltas.push({ tag: a.asset_tag, class: a.vehicle_class, decAccum, janDepr, contribJanEnd, contribFebBeg, d, inService: a.in_service_date, disposed: a.disposed_date });
  }
  deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log(`\nAssets where Jan-end contrib != Feb-beg contrib: ${deltas.length}`);
  for (const x of deltas.slice(0, 15)) {
    console.log(`  ${x.tag} cls=${x.class} inSvc=${x.inService} disp=${x.disposed ?? "-"} | dec=${x.decAccum.toFixed(2)} + janDepr=${x.janDepr.toFixed(2)} = ${x.contribJanEnd.toFixed(2)} vs febBeg=${x.contribFebBeg.toFixed(2)} → Δ=${x.d.toFixed(2)}`);
  }
  const total = deltas.reduce((s, x) => s + x.d, 0);
  console.log(`  Total delta: ${total.toFixed(2)}`);
}
diag();

console.log("\nMODE: BUGGY (raw depr emitted, no cap)");
const buggy = computeRF("buggy");
console.log(`  Jan: beg=${buggy.jan.beg.toFixed(2)} + depr=${buggy.jan.depr.toFixed(2)} - disp=${buggy.jan.dispAccum.toFixed(2)} = end=${buggy.jan.end.toFixed(2)}`);
console.log(`  Feb: beg=${buggy.feb.beg.toFixed(2)} + depr=${buggy.feb.depr.toFixed(2)} - disp=${buggy.feb.dispAccum.toFixed(2)} = end=${buggy.feb.end.toFixed(2)}`);
console.log(`  Jan-end vs Feb-beg delta: ${(buggy.jan.end - buggy.feb.beg).toFixed(2)}`);

console.log("\nMODE: FIXED (depr clamped to actual cap-adjusted delta)");
const fixed = computeRF("fixed");
console.log(`  Jan: beg=${fixed.jan.beg.toFixed(2)} + depr=${fixed.jan.depr.toFixed(2)} - disp=${fixed.jan.dispAccum.toFixed(2)} = end=${fixed.jan.end.toFixed(2)}`);
console.log(`  Feb: beg=${fixed.feb.beg.toFixed(2)} + depr=${fixed.feb.depr.toFixed(2)} - disp=${fixed.feb.dispAccum.toFixed(2)} = end=${fixed.feb.end.toFixed(2)}`);
console.log(`  Jan-end vs Feb-beg delta: ${(fixed.jan.end - fixed.feb.beg).toFixed(2)}`);
