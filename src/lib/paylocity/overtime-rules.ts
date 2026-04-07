/**
 * California Overtime Rules Engine
 *
 * Applies both daily and weekly overtime rules to punch data.
 * Used by both the ot-analysis and punch-calendar API endpoints
 * to ensure consistent OT calculation across views.
 *
 * CA Daily OT:
 *   - Regular: first 8 hours worked per day
 *   - OT (1.5x): hours 8-12 per day
 *   - DT (2.0x): hours > 12 per day
 *
 * CA Weekly OT:
 *   - Regular hours exceeding 40 in a workweek (Sun-Sat) become OT (1.5x)
 *   - Only applies to hours not already classified as daily OT/DT
 *   - Attributed LIFO (last working day of the week first)
 */

import type { PunchDetail } from "./types";

// ── Types ────────────────────────────────────────────────────────────

export interface DailyPunchInput {
  date: string; // "YYYY-MM-DD"
  workHours: number;
  mealHours: number;
  mealEarnings: number;
}

export interface DailyOTResult {
  date: string;
  regHours: number;
  regDollars: number;
  otHours: number;
  otDollars: number;
  dtHours: number;
  dtDollars: number;
  mealHours: number;
  mealDollars: number;
  totalWorkHours: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Check if a punchType represents a meal premium penalty */
export function isMealPremium(punchType?: string): boolean {
  if (!punchType) return false;
  const t = punchType.toLowerCase();
  return t.includes("meal") && t !== "lunch";
}

/** Get the Sunday that starts the workweek containing the given date */
function getWorkweekSunday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  const sun = new Date(d);
  sun.setUTCDate(d.getUTCDate() - day);
  return sun.toISOString().slice(0, 10);
}

// ── Chunked Fetch (Paylocity 31-day API limit) ──────────────────────

/**
 * Fetch punch details for an arbitrary date range by chunking into
 * <=31 day segments (Paylocity NextGen API limit).
 *
 * Returns an empty array if every chunk returns 404 (employee has no
 * punch data, e.g. salaried). Only throws if a non-404 error occurs.
 */
export async function fetchPunchDetailsChunked(
  fetchFn: (startDate: string, endDate: string) => Promise<PunchDetail[]>,
  startDate: string,
  endDate: string
): Promise<PunchDetail[]> {
  const allPunches: PunchDetail[] = [];
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");

  let chunkStart = new Date(start);

  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30); // 31 days inclusive
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const startStr = chunkStart.toISOString().slice(0, 10);
    const endStr = chunkEnd.toISOString().slice(0, 10);

    try {
      const punches = await fetchFn(startStr, endStr);
      allPunches.push(...punches);
    } catch (err) {
      // 404 = no punch data for this employee/range (e.g. salaried) — skip
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404")) throw err;
    }

    // Move to next chunk
    chunkStart = new Date(chunkEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
  }

  return allPunches;
}

// ── Punch Processing ─────────────────────────────────────────────────

/**
 * Process raw punch detail records into daily punch inputs.
 * Groups all punch segments by date, separating work vs meal premium.
 */
export function groupPunchesToDailyInputs(
  punches: PunchDetail[]
): DailyPunchInput[] {
  const segsByDate = new Map<
    string,
    { workHours: number; mealHours: number; mealEarnings: number }
  >();

  for (const punch of punches) {
    for (const seg of punch.segments || []) {
      const date = seg.date;
      if (!date) continue;

      let entry = segsByDate.get(date);
      if (!entry) {
        entry = { workHours: 0, mealHours: 0, mealEarnings: 0 };
        segsByDate.set(date, entry);
      }

      if (isMealPremium(seg.punchType)) {
        entry.mealHours += seg.durationHours || 0;
        entry.mealEarnings += seg.earnings || 0;
      } else if (seg.punchType === "work") {
        entry.workHours += seg.durationHours || 0;
      }
      // "lunch" segments are unpaid — skip
    }
  }

  return Array.from(segsByDate, ([date, entry]) => ({
    date,
    workHours: entry.workHours,
    mealHours: entry.mealHours,
    mealEarnings: entry.mealEarnings,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── CA Overtime Calculation ──────────────────────────────────────────

/**
 * Apply California overtime rules (daily + weekly) to punch data.
 *
 * 1. Daily OT applied first (>8h = OT, >12h = DT)
 * 2. Weekly OT applied second (>40h regular in Sun-Sat workweek = OT)
 *    Excess regular hours are converted to OT starting from the last
 *    working day of the week (LIFO attribution).
 */
export function applyCAOvertimeRules(
  dailyInputs: DailyPunchInput[],
  baseRate: number
): DailyOTResult[] {
  // Step 1: Apply daily OT rules
  const results: DailyOTResult[] = dailyInputs.map((p) => {
    const worked = p.workHours;
    const regHours = Math.min(worked, 8);
    const otHours = Math.max(0, Math.min(worked, 12) - 8);
    const dtHours = Math.max(0, worked - 12);

    return {
      date: p.date,
      totalWorkHours: round2(worked),
      regHours: round2(regHours),
      regDollars: round2(regHours * baseRate),
      otHours: round2(otHours),
      otDollars: round2(otHours * baseRate * 1.5),
      dtHours: round2(dtHours),
      dtDollars: round2(dtHours * baseRate * 2.0),
      mealHours: round2(p.mealHours),
      mealDollars: round2(p.mealEarnings),
    };
  });

  // Step 2: Group by workweek (Sun-Sat)
  const weekMap = new Map<string, DailyOTResult[]>();
  for (const day of results) {
    const weekKey = getWorkweekSunday(day.date);
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
    weekMap.get(weekKey)!.push(day);
  }

  // Step 3: Apply weekly OT (>40 reg hours → OT, attributed LIFO)
  for (const [, weekDays] of weekMap) {
    const totalWeeklyReg = weekDays.reduce((s, d) => s + d.regHours, 0);

    if (totalWeeklyReg > 40) {
      let excess = round2(totalWeeklyReg - 40);

      // LIFO: convert from last day of week backwards
      const sorted = [...weekDays].sort((a, b) =>
        b.date.localeCompare(a.date)
      );

      for (const day of sorted) {
        if (excess <= 0) break;
        const convert = round2(Math.min(day.regHours, excess));
        if (convert > 0) {
          day.regHours = round2(day.regHours - convert);
          day.otHours = round2(day.otHours + convert);
          // Recompute dollars after adjustment
          day.regDollars = round2(day.regHours * baseRate);
          day.otDollars = round2(day.otHours * baseRate * 1.5);
          excess = round2(excess - convert);
        }
      }
    }
  }

  return results;
}
