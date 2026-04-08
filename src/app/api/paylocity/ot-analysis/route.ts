import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { getISOWeek, getISOWeekYear } from "date-fns";
import type { PunchDetail, PayStatementSummary } from "@/lib/paylocity/types";
import {
  groupPunchesToDailyInputs,
  applyCAOvertimeRules,
  fetchPunchDetailsChunked,
  type DailyOTResult,
} from "@/lib/paylocity/overtime-rules";
import {
  AllocationResolver,
  type AllocationRow,
} from "@/lib/paylocity/allocation-resolver";

/**
 * GET /api/paylocity/ot-analysis?year=2026
 *
 * Returns overtime analysis for all active employees across all configured
 * Paylocity companies, broken down by month.
 *
 * DATA SOURCES:
 *   - PunchDetails (NextGen API) — per-employee daily punch segments with
 *     CA daily + weekly OT rules applied.
 *   - employee_allocations (Supabase) — user-maintained date-effective
 *     overrides for department, class, and company (entity) assignment.
 *
 * Hours are bucketed by ACTUAL WORK DATE, not by paycheck check date.
 * When an employee has multiple allocation periods, their data is split
 * into separate OTEmployee entries — one per allocation period.
 *
 * CA OVERTIME RULES (via shared overtime-rules utility):
 *   - Daily: >8hrs = OT (1.5x), >12hrs = DT (2.0x)
 *   - Weekly: >40 regular hrs in a workweek (Sun-Sat) = OT (1.5x)
 *   - Meal premium: "No Meal" / "Late Meal" punch types
 *
 * Entity/department/class resolution priority:
 *   1. employee_allocations override (date-effective, if exists)
 *   2. Paylocity cost center config fallback
 */

interface MonthlyHours {
  otHours: number;
  otDollars: number;
  dtHours: number;
  dtDollars: number;
  mealHours: number;
  mealDollars: number;
  regHours: number;
  regDollars: number;
}

type DataStatus = "ok" | "punch_failed";

interface OTEmployee {
  id: string;
  companyId: string;
  displayName: string;
  department: string;
  classValue: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  payType: string;
  baseRate: number;
  costCenterCode: string;
  monthlyHours: Record<string, MonthlyHours>;
  weeklyHours: Record<string, MonthlyHours>;
  dailyHours: Record<string, MonthlyHours>;
  dataStatus: DataStatus;
  allocationPeriod?: { from: string; through: string | null };
  totals: {
    otHours: number;
    otDollars: number;
    dtHours: number;
    dtDollars: number;
    mealHours: number;
    mealDollars: number;
    regHours: number;
    regDollars: number;
    premiumHours: number;
    premiumDollars: number;
  };
}

/** Convert a "YYYY-MM-DD" date to an ISO week key like "2026-W10" */
function toWeekKey(dateStr: string): string | null {
  const d = new Date(dateStr + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  const isoYear = getISOWeekYear(d);
  const isoWeek = getISOWeek(d);
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

function ensureBucket(
  map: Record<string, MonthlyHours>,
  key: string
): MonthlyHours {
  if (!map[key]) {
    map[key] = {
      otHours: 0, otDollars: 0, dtHours: 0, dtDollars: 0,
      mealHours: 0, mealDollars: 0, regHours: 0, regDollars: 0,
    };
  }
  return map[key];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundBucket(b: MonthlyHours): void {
  b.otHours = round2(b.otHours);
  b.otDollars = round2(b.otDollars);
  b.dtHours = round2(b.dtHours);
  b.dtDollars = round2(b.dtDollars);
  b.mealHours = round2(b.mealHours);
  b.mealDollars = round2(b.mealDollars);
  b.regHours = round2(b.regHours);
  b.regDollars = round2(b.regDollars);
}

function deriveEntityCode(entityName: string, fallbackCode: string): string {
  if (entityName.includes("Silverco")) return "AVON";
  if (entityName.includes("Avon Rental")) return "ARH";
  if (entityName.includes("Versatile")) return "VS";
  if (entityName.includes("Hollywood Depot")) return "HDR";
  return fallbackCode;
}

/** Subtract one day from a "YYYY-MM-DD" string */
function subtractOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Bucket a set of daily results into monthly/weekly/daily maps and totals */
function bucketDailyResults(
  days: DailyOTResult[],
  yearPrefix: string
) {
  const monthlyHours: Record<string, MonthlyHours> = {};
  const weeklyHours: Record<string, MonthlyHours> = {};
  const dailyHours: Record<string, MonthlyHours> = {};
  const totals = {
    otHours: 0, otDollars: 0, dtHours: 0, dtDollars: 0,
    mealHours: 0, mealDollars: 0, regHours: 0, regDollars: 0,
    premiumHours: 0, premiumDollars: 0,
  };

  for (const day of days) {
    if (!day.date.startsWith(yearPrefix)) continue;

    const month = day.date.slice(0, 7);
    const week = toWeekKey(day.date);

    const m = ensureBucket(monthlyHours, month);
    m.otHours += day.otHours; m.otDollars += day.otDollars;
    m.dtHours += day.dtHours; m.dtDollars += day.dtDollars;
    m.mealHours += day.mealHours; m.mealDollars += day.mealDollars;
    m.regHours += day.regHours; m.regDollars += day.regDollars;

    if (week) {
      const w = ensureBucket(weeklyHours, week);
      w.otHours += day.otHours; w.otDollars += day.otDollars;
      w.dtHours += day.dtHours; w.dtDollars += day.dtDollars;
      w.mealHours += day.mealHours; w.mealDollars += day.mealDollars;
      w.regHours += day.regHours; w.regDollars += day.regDollars;
    }

    dailyHours[day.date] = {
      otHours: day.otHours, otDollars: day.otDollars,
      dtHours: day.dtHours, dtDollars: day.dtDollars,
      mealHours: day.mealHours, mealDollars: day.mealDollars,
      regHours: day.regHours, regDollars: day.regDollars,
    };

    totals.otHours += day.otHours; totals.otDollars += day.otDollars;
    totals.dtHours += day.dtHours; totals.dtDollars += day.dtDollars;
    totals.mealHours += day.mealHours; totals.mealDollars += day.mealDollars;
    totals.regHours += day.regHours; totals.regDollars += day.regDollars;
  }

  totals.premiumHours = totals.otHours + totals.dtHours + totals.mealHours;
  totals.premiumDollars = totals.otDollars + totals.dtDollars + totals.mealDollars;

  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[key] = round2(totals[key]);
  }
  for (const m of Object.values(monthlyHours)) roundBucket(m);
  for (const w of Object.values(weeklyHours)) roundBucket(w);

  return { monthlyHours, weeklyHours, dailyHours, totals };
}

// In-memory cache (5 min TTL)
let cachedData: { data: unknown; year: number; fetchedAt: number } | null =
  null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const year =
    Number(request.nextUrl.searchParams.get("year")) ||
    new Date().getFullYear();

  try {
    const bustCache = request.nextUrl.searchParams.get("bustCache") === "1";

    // Check cache
    if (
      !bustCache &&
      cachedData &&
      cachedData.year === year &&
      Date.now() - cachedData.fetchedAt < CACHE_TTL_MS
    ) {
      return NextResponse.json(cachedData.data, {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        },
      });
    }

    // Fetch allocation overrides from Supabase → date-aware resolver
    let resolver = new AllocationResolver([]);
    try {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("employee_allocations")
        .select("*");
      if (data) {
        resolver = new AllocationResolver(data as AllocationRow[]);
      }
    } catch {
      // Allocations unavailable — fall back to cost center config only
    }

    // Punch date range — extend ±6 days to capture full workweeks at
    // year boundaries so weekly OT is calculated correctly.
    const startDate = `${year - 1}-12-26`;
    const today = new Date().toISOString().slice(0, 10);
    const yearEnd = `${year + 1}-01-06`;
    const endDate = yearEnd < today ? yearEnd : today;
    const yearPrefix = String(year);

    // Fetch all active employees from all companies
    const clients = getAllCompanyClients();
    const companyResults = await Promise.all(
      clients.map(async (client) => {
        const employees = await client.getEmployees({
          activeOnly: true,
          include: ["info", "position", "payrate"],
        });
        return { companyId: client.companyId, client, employees };
      })
    );

    const otEmployees: OTEmployee[] = [];

    for (const {
      companyId,
      client,
      employees: rawEmployees,
    } of companyResults) {
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (emp) => {
            let punches: PunchDetail[] = [];
            let summaries: PayStatementSummary[] = [];
            let punchFailed = false;

            // Fetch punch data and pay statement summaries in parallel
            const [punchResult, summaryResult] = await Promise.allSettled([
              fetchPunchDetailsChunked(
                (s, e) => client.getPunchDetails(emp.id, s, e),
                startDate,
                endDate
              ),
              client.getPayStatementSummary(emp.id, year),
            ]);

            if (punchResult.status === "fulfilled") {
              punches = punchResult.value;
            } else {
              punchFailed = true;
              console.warn(
                `[OT-Analysis] Punch fetch failed for employee ${emp.id} (company ${companyId}):`,
                punchResult.reason instanceof Error ? punchResult.reason.message : punchResult.reason
              );
            }

            if (summaryResult.status === "fulfilled") {
              summaries = summaryResult.value;
            }

            return { emp, punches, summaries, punchFailed };
          })
        );

        for (const { emp, punches, summaries, punchFailed } of batchResults) {
          const firstName = emp.info?.firstName ?? "";
          const lastName = emp.info?.lastName ?? emp.lastName ?? "";
          const displayName =
            emp.displayName ??
            (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);
          if (!displayName) continue;

          // Cost center config fallback
          const cc = getOperatingEntityForCostCenter(
            emp.position?.costCenter1,
            companyId
          );

          const baseRate = emp.currentPayRate?.baseRate ?? 0;
          const dataStatus: DataStatus = punchFailed ? "punch_failed" : "ok";
          const payType = emp.currentPayRate?.payType ?? "Unknown";
          const costCenterCode = emp.position?.costCenter1 ?? "UNKNOWN";

          // ── Process punch data through CA OT rules ──
          const dailyInputs = groupPunchesToDailyInputs(punches);
          const dailyResults = applyCAOvertimeRules(dailyInputs, baseRate);

          // ── Fallback: for employees with no punch data (e.g. salaried),
          //    populate reg hours/dollars from pay statement summaries ──
          const hasPunchData = dailyResults.some((d) =>
            d.date.startsWith(yearPrefix)
          );

          let payStatementReg:
            | { monthlyHours: Record<string, MonthlyHours>; totals: { regHours: number; regDollars: number } }
            | null = null;

          if (!hasPunchData && summaries.length > 0) {
            const monthly: Record<string, MonthlyHours> = {};
            let totalRegH = 0;
            let totalRegD = 0;

            for (const ps of summaries) {
              const month = ps.checkDate?.slice(0, 7);
              if (!month || !month.startsWith(yearPrefix)) continue;

              const regH = ps.regularHours || 0;
              const regD = ps.regularDollars || 0;

              const m = ensureBucket(monthly, month);
              m.regHours += regH;
              m.regDollars += regD;
              totalRegH += regH;
              totalRegD += regD;
            }

            for (const m of Object.values(monthly)) roundBucket(m);

            payStatementReg = {
              monthlyHours: monthly,
              totals: { regHours: round2(totalRegH), regDollars: round2(totalRegD) },
            };
          }

          // ── Get allocation periods for this employee ──
          const periods = resolver.getAllPeriods(emp.id, companyId);

          if (periods.length <= 1) {
            // ── Fast path: single allocation (or none) ──
            const alloc = periods[0] ?? null;
            const dept = alloc?.department || cc.department;
            const cls = alloc?.class || "";
            const entityId = alloc?.allocated_entity_id || cc.operatingEntityId;
            const entityName = alloc?.allocated_entity_name || cc.operatingEntityName;
            const entityCode = deriveEntityCode(entityName, cc.operatingEntityCode);

            const bucketed = bucketDailyResults(dailyResults, yearPrefix);

            // Merge pay statement reg data if employee has no punch data
            if (payStatementReg) {
              for (const [month, hrs] of Object.entries(payStatementReg.monthlyHours)) {
                const m = ensureBucket(bucketed.monthlyHours, month);
                m.regHours += hrs.regHours;
                m.regDollars += hrs.regDollars;
              }
              bucketed.totals.regHours += payStatementReg.totals.regHours;
              bucketed.totals.regDollars += payStatementReg.totals.regDollars;
            }

            otEmployees.push({
              id: emp.id,
              companyId,
              displayName,
              department: dept,
              classValue: cls,
              operatingEntityId: entityId,
              operatingEntityCode: entityCode,
              operatingEntityName: entityName,
              payType,
              baseRate,
              costCenterCode,
              ...bucketed,
              dataStatus,
            });
          } else {
            // ── Multi-period: split daily data by allocation period ──
            // Build date ranges for each period
            const periodRanges = periods.map((p, idx) => ({
              alloc: p,
              startDate: p.effective_date,
              endDate:
                idx < periods.length - 1
                  ? subtractOneDay(periods[idx + 1].effective_date)
                  : null, // null = ongoing
            }));

            for (const range of periodRanges) {
              // Filter daily results to this period
              const periodDays = dailyResults.filter((day) => {
                if (day.date < range.startDate) return false;
                if (range.endDate && day.date > range.endDate) return false;
                return true;
              });

              const alloc = range.alloc;
              const dept = alloc.department || cc.department;
              const cls = alloc.class || "";
              const entityId = alloc.allocated_entity_id || cc.operatingEntityId;
              const entityName = alloc.allocated_entity_name || cc.operatingEntityName;
              const entityCode = deriveEntityCode(entityName, cc.operatingEntityCode);

              const bucketed = bucketDailyResults(periodDays, yearPrefix);

              // Merge pay statement reg for months that fall within this period
              if (payStatementReg) {
                for (const [month, hrs] of Object.entries(payStatementReg.monthlyHours)) {
                  // Use first of month to determine which period owns this month
                  const firstOfMonth = `${month}-01`;
                  if (firstOfMonth < range.startDate) continue;
                  if (range.endDate && firstOfMonth > range.endDate) continue;
                  const m = ensureBucket(bucketed.monthlyHours, month);
                  m.regHours += hrs.regHours;
                  m.regDollars += hrs.regDollars;
                  bucketed.totals.regHours = round2(bucketed.totals.regHours + hrs.regHours);
                  bucketed.totals.regDollars = round2(bucketed.totals.regDollars + hrs.regDollars);
                }
              }

              // Skip periods with no data at all
              const hasAnyData = bucketed.totals.regHours > 0 ||
                bucketed.totals.otHours > 0 || bucketed.totals.dtHours > 0 ||
                bucketed.totals.mealHours > 0;
              if (!hasAnyData) continue;

              otEmployees.push({
                id: `${emp.id}:${alloc.effective_date}`,
                companyId,
                displayName,
                department: dept,
                classValue: cls,
                operatingEntityId: entityId,
                operatingEntityCode: entityCode,
                operatingEntityName: entityName,
                payType,
                baseRate,
                costCenterCode,
                ...bucketed,
                dataStatus,
                allocationPeriod: {
                  from: range.startDate,
                  through: range.endDate,
                },
              });
            }
          }
        }
      }
    }

    // Collect all months, weeks, and days
    const monthSet = new Set<string>();
    const weekSet = new Set<string>();
    const daySet = new Set<string>();
    for (const emp of otEmployees) {
      for (const m of Object.keys(emp.monthlyHours)) monthSet.add(m);
      for (const w of Object.keys(emp.weeklyHours)) weekSet.add(w);
      for (const d of Object.keys(emp.dailyHours)) daySet.add(d);
    }
    const months = [...monthSet].sort();
    const weeks = [...weekSet].sort();
    const days = [...daySet].sort();

    // Compute org-level KPIs
    const kpis = {
      totalOTHours: round2(otEmployees.reduce((s, e) => s + e.totals.otHours, 0)),
      totalOTDollars: round2(otEmployees.reduce((s, e) => s + e.totals.otDollars, 0)),
      totalDTHours: round2(otEmployees.reduce((s, e) => s + e.totals.dtHours, 0)),
      totalDTDollars: round2(otEmployees.reduce((s, e) => s + e.totals.dtDollars, 0)),
      totalMealHours: round2(otEmployees.reduce((s, e) => s + e.totals.mealHours, 0)),
      totalMealDollars: round2(otEmployees.reduce((s, e) => s + e.totals.mealDollars, 0)),
      totalPremiumHours: round2(otEmployees.reduce((s, e) => s + e.totals.premiumHours, 0)),
      totalPremiumDollars: round2(otEmployees.reduce((s, e) => s + e.totals.premiumDollars, 0)),
      totalRegHours: round2(otEmployees.reduce((s, e) => s + e.totals.regHours, 0)),
      employeesWithPremium: otEmployees.filter((e) => e.totals.premiumHours > 0).length,
      totalEmployees: otEmployees.length,
    };

    // Diagnostics
    const punchFailed = otEmployees.filter(
      (e) => e.dataStatus === "punch_failed"
    ).length;

    if (punchFailed > 0) {
      console.warn(
        `[OT-Analysis] Punch data failures: ${punchFailed} out of ${otEmployees.length} employees`
      );
    }

    const responseData = {
      year,
      employees: otEmployees,
      months,
      weeks,
      days,
      kpis,
      diagnostics: {
        totalEmployees: otEmployees.length,
        dataOk: otEmployees.filter((e) => e.dataStatus === "ok").length,
        punchFailed,
      },
    };

    cachedData = { data: responseData, year, fetchedAt: Date.now() };

    return NextResponse.json(responseData, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch OT analysis data",
      },
      { status: 500 }
    );
  }
}
