import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { getISOWeek, getISOWeekYear } from "date-fns";
import type { PunchDetail } from "@/lib/paylocity/types";
import {
  groupPunchesToDailyInputs,
  applyCAOvertimeRules,
  fetchPunchDetailsChunked,
} from "@/lib/paylocity/overtime-rules";

/**
 * GET /api/paylocity/ot-analysis?year=2026
 *
 * Returns overtime analysis for all active employees across all configured
 * Paylocity companies, broken down by month.
 *
 * DATA SOURCES:
 *   - PunchDetails (NextGen API) — per-employee daily punch segments with
 *     CA daily + weekly OT rules applied.
 *   - employee_allocations (Supabase) — user-maintained overrides for
 *     department, class, and company (entity) assignment.
 *
 * Hours are bucketed by ACTUAL WORK DATE, not by paycheck check date.
 *
 * CA OVERTIME RULES (via shared overtime-rules utility):
 *   - Daily: >8hrs = OT (1.5x), >12hrs = DT (2.0x)
 *   - Weekly: >40 regular hrs in a workweek (Sun-Sat) = OT (1.5x)
 *   - Meal premium: "No Meal" / "Late Meal" punch types
 *
 * Entity/department/class resolution priority:
 *   1. employee_allocations override (if exists)
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
  costCenterCode: string;
  monthlyHours: Record<string, MonthlyHours>;
  weeklyHours: Record<string, MonthlyHours>;
  dailyHours: Record<string, MonthlyHours>;
  dataStatus: DataStatus;
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

interface AllocationRow {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
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
      otHours: 0,
      otDollars: 0,
      dtHours: 0,
      dtDollars: 0,
      mealHours: 0,
      mealDollars: 0,
      regHours: 0,
      regDollars: 0,
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

// In-memory cache (5 min TTL)
let cachedData: { data: unknown; year: number; fetchedAt: number } | null =
  null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const year =
    Number(request.nextUrl.searchParams.get("year")) ||
    new Date().getFullYear();

  try {
    // Check cache
    if (
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

    // Fetch allocation overrides from Supabase
    const allocationMap = new Map<string, AllocationRow>();
    try {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("employee_allocations")
        .select("*");
      if (data) {
        for (const row of data as AllocationRow[]) {
          allocationMap.set(
            `${row.employee_id}:${row.paylocity_company_id}`,
            row
          );
        }
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
      // Fetch punch details in batches of 5
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (emp) => {
            let punches: PunchDetail[] = [];
            let punchFailed = false;

            try {
              punches = await fetchPunchDetailsChunked(
                (s, e) => client.getPunchDetails(emp.id, s, e),
                startDate,
                endDate
              );
            } catch (err) {
              punchFailed = true;
              console.warn(
                `[OT-Analysis] Punch fetch failed for employee ${emp.id} (company ${companyId}):`,
                err instanceof Error ? err.message : err
              );
            }

            return { emp, punches, punchFailed };
          })
        );

        for (const { emp, punches, punchFailed } of batchResults) {
          // Skip employees with no name
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

          // Apply allocation overrides (priority over cost center config)
          const alloc = allocationMap.get(`${emp.id}:${companyId}`);
          const effectiveDepartment = alloc?.department || cc.department;
          const classValue = alloc?.class || "";
          const effectiveEntityId =
            alloc?.allocated_entity_id || cc.operatingEntityId;
          const effectiveEntityName =
            alloc?.allocated_entity_name || cc.operatingEntityName;
          // Derive entity code from name for backward compat
          const effectiveEntityCode = effectiveEntityName.includes("Silverco")
            ? "AVON"
            : effectiveEntityName.includes("Avon Rental")
              ? "ARH"
              : effectiveEntityName.includes("Versatile")
                ? "VS"
                : effectiveEntityName.includes("Hollywood Depot")
                  ? "HDR"
                  : cc.operatingEntityCode;

          const baseRate = emp.currentPayRate?.baseRate ?? 0;

          // ── Process punch data through CA OT rules ──
          const dailyInputs = groupPunchesToDailyInputs(punches);
          const dailyResults = applyCAOvertimeRules(dailyInputs, baseRate);

          // ── Bucket into monthly, weekly, daily ──
          // Only include days within the requested year (extended range
          // was only needed for correct weekly OT at boundaries).
          const monthlyHours: Record<string, MonthlyHours> = {};
          const weeklyHours: Record<string, MonthlyHours> = {};
          const dailyHours: Record<string, MonthlyHours> = {};
          const totals = {
            otHours: 0,
            otDollars: 0,
            dtHours: 0,
            dtDollars: 0,
            mealHours: 0,
            mealDollars: 0,
            regHours: 0,
            regDollars: 0,
            premiumHours: 0,
            premiumDollars: 0,
          };

          for (const day of dailyResults) {
            // Only include days within the requested year
            if (!day.date.startsWith(yearPrefix)) continue;

            const month = day.date.slice(0, 7); // "YYYY-MM"
            const week = toWeekKey(day.date);

            // Monthly bucket
            const m = ensureBucket(monthlyHours, month);
            m.otHours += day.otHours;
            m.otDollars += day.otDollars;
            m.dtHours += day.dtHours;
            m.dtDollars += day.dtDollars;
            m.mealHours += day.mealHours;
            m.mealDollars += day.mealDollars;
            m.regHours += day.regHours;
            m.regDollars += day.regDollars;

            // Weekly bucket (ISO weeks for display grouping)
            if (week) {
              const w = ensureBucket(weeklyHours, week);
              w.otHours += day.otHours;
              w.otDollars += day.otDollars;
              w.dtHours += day.dtHours;
              w.dtDollars += day.dtDollars;
              w.mealHours += day.mealHours;
              w.mealDollars += day.mealDollars;
              w.regHours += day.regHours;
              w.regDollars += day.regDollars;
            }

            // Daily bucket
            dailyHours[day.date] = {
              otHours: day.otHours,
              otDollars: day.otDollars,
              dtHours: day.dtHours,
              dtDollars: day.dtDollars,
              mealHours: day.mealHours,
              mealDollars: day.mealDollars,
              regHours: day.regHours,
              regDollars: day.regDollars,
            };

            // Running totals
            totals.otHours += day.otHours;
            totals.otDollars += day.otDollars;
            totals.dtHours += day.dtHours;
            totals.dtDollars += day.dtDollars;
            totals.mealHours += day.mealHours;
            totals.mealDollars += day.mealDollars;
            totals.regHours += day.regHours;
            totals.regDollars += day.regDollars;
          }

          // Premium = OT + DT + MEAL combined
          totals.premiumHours =
            totals.otHours + totals.dtHours + totals.mealHours;
          totals.premiumDollars =
            totals.otDollars + totals.dtDollars + totals.mealDollars;

          // Round totals
          for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
            totals[key] = round2(totals[key]);
          }

          // Round all bucket values
          for (const m of Object.values(monthlyHours)) roundBucket(m);
          for (const w of Object.values(weeklyHours)) roundBucket(w);

          // Include ALL active employees (even those with zero OT / no punch data)
          otEmployees.push({
            id: emp.id,
            companyId,
            displayName,
            department: effectiveDepartment,
            classValue,
            operatingEntityId: effectiveEntityId,
            operatingEntityCode: effectiveEntityCode,
            operatingEntityName: effectiveEntityName,
            payType: emp.currentPayRate?.payType ?? "Unknown",
            costCenterCode: emp.position?.costCenter1 ?? "UNKNOWN",
            monthlyHours,
            weeklyHours,
            dailyHours,
            dataStatus: punchFailed ? "punch_failed" : "ok",
            totals,
          });
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
      totalOTHours: round2(
        otEmployees.reduce((s, e) => s + e.totals.otHours, 0)
      ),
      totalOTDollars: round2(
        otEmployees.reduce((s, e) => s + e.totals.otDollars, 0)
      ),
      totalDTHours: round2(
        otEmployees.reduce((s, e) => s + e.totals.dtHours, 0)
      ),
      totalDTDollars: round2(
        otEmployees.reduce((s, e) => s + e.totals.dtDollars, 0)
      ),
      totalMealHours: round2(
        otEmployees.reduce((s, e) => s + e.totals.mealHours, 0)
      ),
      totalMealDollars: round2(
        otEmployees.reduce((s, e) => s + e.totals.mealDollars, 0)
      ),
      totalPremiumHours: round2(
        otEmployees.reduce((s, e) => s + e.totals.premiumHours, 0)
      ),
      totalPremiumDollars: round2(
        otEmployees.reduce((s, e) => s + e.totals.premiumDollars, 0)
      ),
      totalRegHours: round2(
        otEmployees.reduce((s, e) => s + e.totals.regHours, 0)
      ),
      employeesWithPremium: otEmployees.filter(
        (e) => e.totals.premiumHours > 0
      ).length,
      totalEmployees: otEmployees.length,
    };

    // Diagnostics — how many employees had API failures
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

    // Update cache
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
