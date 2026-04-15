// One-time backfill for the "no book depreciation in disposal month" policy.
//
// BOOK-ONLY. Tax depreciation continues to follow MACRS conventions and
// accrues through the disposal month — we do not touch tax_accumulated or
// disposed_tax_gain_loss here.
//
// For every disposed asset it:
//   1. Re-derives book accumulated-at-disposal from the most recent subledger
//      row strictly BEFORE the disposal month (falls back to asset header).
//   2. Recomputes disposed_book_gain_loss from that accumulated and the
//      recorded sale price.
//   3. Updates the asset header's book_accumulated_depreciation so it matches
//      the at-disposal value (stops header drift).
//   4. In the subledger's disposal-month row: sets book_depreciation=0 and
//      book_accumulated=(end-of-prior-month). Leaves tax fields untouched.
//   5. Deletes any subledger rows strictly AFTER the disposal month.
//
// Run: node scripts/backfill-no-depr-in-disposal-month.mjs [--apply]
// Without --apply, prints a dry run. Pass --apply to execute.

import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

const envPath = path.resolve("./.env.local");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing Supabase env vars.");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${URL}/rest/v1${pathAndQuery}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

const round2 = (n) => Math.round(n * 100) / 100;
const splitYM = (iso) => {
  const [y, m] = iso.split("T")[0].split("-").map(Number);
  return { y, m };
};

const assets = await rest(
  "/fixed_assets?select=id,entity_id,asset_tag,asset_name,acquisition_cost,disposed_date,disposed_sale_price,disposed_book_gain_loss,book_accumulated_depreciation&status=eq.disposed"
);

console.log(
  `\n${APPLY ? "APPLYING" : "DRY RUN"} — book-only policy — ${assets.length} disposed assets\n`
);

const summary = {
  headerUpdates: 0,
  subledgerRowsZeroed: 0,
  subledgerRowsDeleted: 0,
  totalBookGLDelta: 0,
};

const changes = [];

for (const a of assets) {
  if (!a.disposed_date) continue;
  const { y: dy, m: dm } = splitYM(a.disposed_date);

  // Book accumulated as of end of prior month (strict lt).
  const priorBook = await rest(
    `/fixed_asset_depreciation?select=book_accumulated` +
      `&fixed_asset_id=eq.${a.id}` +
      `&or=(period_year.lt.${dy},and(period_year.eq.${dy},period_month.lt.${dm}))` +
      `&order=period_year.desc,period_month.desc&limit=1`
  );
  const atDispBook =
    priorBook.length > 0
      ? Number(priorBook[0].book_accumulated)
      : Number(a.book_accumulated_depreciation ?? 0);

  const cost = Number(a.acquisition_cost);
  const sale = Number(a.disposed_sale_price ?? 0);
  const newBookGL = round2(sale - (cost - atDispBook));
  const storedBookGL = Number(a.disposed_book_gain_loss ?? 0);
  const bookGLDelta = round2(newBookGL - storedBookGL);

  // Disposal month subledger row — does it have non-zero book_depreciation?
  const dispMonthRows = await rest(
    `/fixed_asset_depreciation?select=id,book_depreciation,book_accumulated` +
      `&fixed_asset_id=eq.${a.id}` +
      `&period_year=eq.${dy}&period_month=eq.${dm}`
  );
  const needsDispMonthZero =
    dispMonthRows.length > 0 &&
    (Math.abs(Number(dispMonthRows[0].book_depreciation)) > 0.01 ||
      Math.abs(Number(dispMonthRows[0].book_accumulated) - atDispBook) > 0.01);

  // Rows strictly after disposal.
  const postRows = await rest(
    `/fixed_asset_depreciation?select=period_year,period_month` +
      `&fixed_asset_id=eq.${a.id}` +
      `&or=(period_year.gt.${dy},and(period_year.eq.${dy},period_month.gt.${dm}))`
  );

  const needsHeaderUpdate =
    Math.abs(bookGLDelta) > 0.01 ||
    Math.abs(Number(a.book_accumulated_depreciation) - atDispBook) > 0.01;

  if (!needsHeaderUpdate && !needsDispMonthZero && postRows.length === 0)
    continue;

  changes.push({
    tag: a.asset_tag ?? a.asset_name,
    disposed: a.disposed_date,
    sale,
    storedBookGL,
    newBookGL,
    bookGLDelta,
    dispMonthZero: needsDispMonthZero ? "Y" : "-",
    postRows: postRows.length,
  });
  summary.totalBookGLDelta += bookGLDelta;

  if (APPLY) {
    if (needsHeaderUpdate) {
      await rest(`/fixed_assets?id=eq.${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          disposed_book_gain_loss: newBookGL,
          book_accumulated_depreciation: atDispBook,
        }),
      });
      summary.headerUpdates++;
    }
    if (needsDispMonthZero) {
      await rest(
        `/fixed_asset_depreciation?fixed_asset_id=eq.${a.id}` +
          `&period_year=eq.${dy}&period_month=eq.${dm}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            book_depreciation: 0,
            book_accumulated: atDispBook,
          }),
        }
      );
      summary.subledgerRowsZeroed++;
    }
    if (postRows.length > 0) {
      await rest(
        `/fixed_asset_depreciation?fixed_asset_id=eq.${a.id}` +
          `&or=(period_year.gt.${dy},and(period_year.eq.${dy},period_month.gt.${dm}))`,
        { method: "DELETE" }
      );
      summary.subledgerRowsDeleted += postRows.length;
    }
  }
}

console.log(
  "Tag".padEnd(10) +
    "Disposed".padEnd(12) +
    "Sale".padStart(12) +
    "Old Book G/L".padStart(14) +
    "New Book G/L".padStart(14) +
    "Δ Book".padStart(10) +
    "Zero?".padStart(7) +
    "Post".padStart(6)
);
console.log("-".repeat(85));
for (const c of changes) {
  console.log(
    String(c.tag).padEnd(10) +
      String(c.disposed).padEnd(12) +
      c.sale.toFixed(2).padStart(12) +
      c.storedBookGL.toFixed(2).padStart(14) +
      c.newBookGL.toFixed(2).padStart(14) +
      c.bookGLDelta.toFixed(2).padStart(10) +
      String(c.dispMonthZero).padStart(7) +
      String(c.postRows).padStart(6)
  );
}

console.log("");
console.log(`Assets needing change: ${changes.length} / ${assets.length}`);
console.log(
  `Total book G/L delta:  ${summary.totalBookGLDelta.toFixed(2)} (negative = more loss)`
);
if (APPLY) {
  console.log(
    `\nAPPLIED: ${summary.headerUpdates} headers updated, ${summary.subledgerRowsZeroed} disposal-month rows zeroed, ${summary.subledgerRowsDeleted} post-disposal rows deleted.`
  );
} else {
  console.log(`\nDry run complete — re-run with --apply to execute.`);
}
