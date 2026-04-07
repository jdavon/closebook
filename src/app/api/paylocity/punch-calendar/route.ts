import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PunchDetail } from "@/lib/paylocity/types";
import {
  groupPunchesToDailyInputs,
  applyCAOvertimeRules,
} from "@/lib/paylocity/overtime-rules";

/**
 * GET /api/paylocity/punch-calendar?year=2026&month=2
 *
 * Returns daily OT/DT/Meal premium data derived from the Paylocity
 * Punch Details API (NextGen), with CA daily + weekly overtime rules
 * applied via the shared overtime-rules utility.
 *
 * DATA SOURCES:
 *   - PunchDetails (NextGen API) — per-employee daily punch segments
 *   - employee_allocations (Supabase) — department/class/entity overrides
 *
 * CA OVERTIME RULES (via shared overtime-rules utility):
 *   - Daily: >8hrs = OT (1.5x), >12hrs = DT (2.0x)
 *   - Weekly: >40 regular hrs in a workweek (Sun-Sat) = OT (1.5x)
 *   - Meal premium: "No Meal" / "Late Meal" punch types (1hr at base rate)
 *
 * The date range is extended ±6 days beyond the requested month to capture
 * full workweeks at month boundaries for accurate weekly OT calculation.
 * Only days within the requested month are included in the response.
 */

// --- Types ---

interface PunchDayData {
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

interface PunchCalendarEmployee {
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
  hasPunchData: boolean;
  dailyData: Record<string, PunchDayData>;
  monthTotals: PunchDayData;
}

interface AllocationRow {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
}

// --- Helpers ---

function emptyDay(): PunchDayData {
  return {
    regHours: 0,
    regDollars: 0,
    otHours: 0,
    otDollars: 0,
    dtHours: 0,
    dtDollars: 0,
    mealHours: 0,
    mealDollars: 0,
    totalWorkHours: 0,
  };
}

function addDay(a: PunchDayData, b: PunchDayData): PunchDayData {
  return {
    regHours: a.regHours + b.regHours,
    regDollars: a.regDollars + b.regDollars,
    otHours: a.otHours + b.otHours,
    otDollars: a.otDollars + b.otDollars,
    dtHours: a.dtHours + b.dtHours,
    dtDollars: a.dtDollars + b.dtDollars,
    mealHours: a.mealHours + b.mealHours,
    mealDollars: a.mealDollars + b.mealDollars,
    totalWorkHours: a.totalWorkHours + b.totalWorkHours,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundDay(d: PunchDayData): PunchDayData {
  return {
    regHours: round2(d.regHours),
    regDollars: round2(d.regDollars),
    otHours: round2(d.otHours),
    otDollars: round2(d.otDollars),
    dtHours: round2(d.dtHours),
    dtDollars: round2(d.dtDollars),
    mealHours: round2(d.mealHours),
    mealDollars: round2(d.mealDollars),
    totalWorkHours: round2(d.totalWorkHours),
  };
}

// --- In-memory cache (5 min TTL) ---
let cachedData: { data: unknown; key: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get("year");
  const monthParam = request.nextUrl.searchParams.get("month");

  const year = Number(yearParam) || new Date().getFullYear();
  const month = Number(monthParam) || new Date().getMonth() + 1;

  // Target month prefix for filtering output (only include days in this month)
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  // Extend date range ±6 days to capture full workweeks at month boundaries
  // so weekly OT (>40h/week) is calculated correctly even for partial weeks.
  const extStart = new Date(year, month - 1, 1);
  extStart.setDate(extStart.getDate() - 6);
  const extEnd = new Date(year, month, 0); // last day of target month
  extEnd.setDate(extEnd.getDate() + 6);

  const startDate = extStart.toISOString().slice(0, 10);
  const endDate = extEnd.toISOString().slice(0, 10);

  const cacheKey = `${year}-${month}`;

  try {
    // Check cache
    if (
      cachedData &&
      cachedData.key === cacheKey &&
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

    const punchEmployees: PunchCalendarEmployee[] = [];
    let fetchErrors = 0;

    for (const {
      companyId,
      client,
      employees: rawEmployees,
    } of companyResults) {
      // Batch punch details fetching (5 at a time)
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (emp) => {
            let punches: PunchDetail[] = [];
            let fetchFailed = false;

            try {
              punches = await client.getPunchDetails(
                emp.id,
                startDate,
                endDate
              );
            } catch (err) {
              fetchFailed = true;
              fetchErrors++;
              console.warn(
                `[PunchCalendar] Punch fetch failed for employee ${emp.id} (company ${companyId}):`,
                err instanceof Error ? err.message : err
              );
            }

            return { emp, punches, fetchFailed };
          })
        );

        for (const { emp, punches, fetchFailed } of batchResults) {
          // Employee name
          const firstName = emp.info?.firstName ?? "";
          const lastName = emp.info?.lastName ?? emp.lastName ?? "";
          const displayName =
            emp.displayName ??
            (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);

          // Cost center → entity resolution
          const cc = getOperatingEntityForCostCenter(
            emp.position?.costCenter1,
            companyId
          );

          // Allocation overrides
          const alloc = allocationMap.get(`${emp.id}:${companyId}`);
          const effectiveDepartment = alloc?.department || cc.department;
          const classValue = alloc?.class || "";
          const effectiveEntityId =
            alloc?.allocated_entity_id || cc.operatingEntityId;
          const effectiveEntityName =
            alloc?.allocated_entity_name || cc.operatingEntityName;
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
          // The extended date range ensures weekly OT is accurate at month
          // boundaries, but we only keep days within the target month.
          const dailyInputs = groupPunchesToDailyInputs(punches);
          const dailyResults = applyCAOvertimeRules(dailyInputs, baseRate);

          const dailyData: Record<string, PunchDayData> = {};

          if (!fetchFailed) {
            for (const day of dailyResults) {
              // Only include days within the requested month
              if (!day.date.startsWith(monthPrefix)) continue;

              dailyData[day.date] = {
                totalWorkHours: day.totalWorkHours,
                regHours: day.regHours,
                regDollars: day.regDollars,
                otHours: day.otHours,
                otDollars: day.otDollars,
                dtHours: day.dtHours,
                dtDollars: day.dtDollars,
                mealHours: day.mealHours,
                mealDollars: day.mealDollars,
              };
            }
          }

          // Compute month totals
          const monthTotals = Object.values(dailyData).reduce(
            (sum, day) => addDay(sum, day),
            emptyDay()
          );

          punchEmployees.push({
            id: emp.id,
            companyId,
            displayName,
            department: effectiveDepartment,
            classValue,
            operatingEntityId: effectiveEntityId,
            operatingEntityCode: effectiveEntityCode,
            operatingEntityName: effectiveEntityName,
            payType: emp.currentPayRate?.payType ?? "Unknown",
            baseRate,
            hasPunchData: Object.keys(dailyData).length > 0,
            dailyData,
            monthTotals: roundDay(monthTotals),
          });
        }
      }
    }

    const employeesWithData = punchEmployees.filter(
      (e) => e.hasPunchData
    ).length;

    const responseData = {
      year,
      month,
      employees: punchEmployees,
      diagnostics: {
        totalEmployees: punchEmployees.length,
        withData: employeesWithData,
        withoutData: punchEmployees.length - employeesWithData,
        errors: fetchErrors,
      },
    };

    // Update cache
    cachedData = { data: responseData, key: cacheKey, fetchedAt: Date.now() };

    return NextResponse.json(responseData, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error
          ? err.message
          : "Failed to fetch punch calendar data",
      },
      { status: 500 }
    );
  }
}
