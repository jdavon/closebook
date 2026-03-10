import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PunchDetail } from "@/lib/paylocity/types";

/**
 * GET /api/paylocity/punch-calendar?year=2026&month=2
 *
 * Returns TRUE daily OT/DT/Meal premium data derived from the Paylocity
 * Punch Details API (NextGen). Unlike the ot-analysis endpoint which uses
 * WebLink pay statements (aggregated per pay period), this endpoint returns
 * actual per-day worked hours from employee punch-in/punch-out records.
 *
 * DATA SOURCES:
 *   - PunchDetails (NextGen API) — per-employee daily punch segments
 *   - employee_allocations (Supabase) — department/class/entity overrides
 *
 * CA DAILY OT RULES:
 *   - Regular: first 8 hours worked per day
 *   - OT (1.5x): hours 8–12 per day
 *   - DT (2.0x): hours > 12 per day
 *   - Meal premium: "No Meal" / "Late Meal" punch types (1hr at base rate)
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
    regHours: 0, regDollars: 0,
    otHours: 0, otDollars: 0,
    dtHours: 0, dtDollars: 0,
    mealHours: 0, mealDollars: 0,
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

/** Check if a punchType represents a meal premium penalty */
function isMealPremium(punchType?: string): boolean {
  if (!punchType) return false;
  const t = punchType.toLowerCase();
  return t.includes("meal") && t !== "lunch";
}

// --- In-memory cache (5 min TTL) ---
let cachedData: { data: unknown; key: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get("year");
  const monthParam = request.nextUrl.searchParams.get("month");

  const year = Number(yearParam) || new Date().getFullYear();
  const month = Number(monthParam) || new Date().getMonth() + 1;

  // Date range for the month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // e.g., 28/29/30/31
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const cacheKey = `${year}-${month}`;

  try {
    // Check cache
    if (
      cachedData &&
      cachedData.key === cacheKey &&
      Date.now() - cachedData.fetchedAt < CACHE_TTL_MS
    ) {
      return NextResponse.json(cachedData.data, {
        headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
      });
    }

    // Fetch allocation overrides from Supabase
    const allocationMap = new Map<string, AllocationRow>();
    try {
      const supabase = createAdminClient();
      const { data } = await supabase.from("employee_allocations").select("*");
      if (data) {
        for (const row of data as AllocationRow[]) {
          allocationMap.set(`${row.employee_id}:${row.paylocity_company_id}`, row);
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

    for (const { companyId, client, employees: rawEmployees } of companyResults) {
      // Batch punch details fetching (5 at a time)
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (emp) => {
            let punches: PunchDetail[] = [];
            let fetchFailed = false;

            try {
              punches = await client.getPunchDetails(emp.id, startDate, endDate);
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
          const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, companyId);

          // Allocation overrides
          const alloc = allocationMap.get(`${emp.id}:${companyId}`);
          const effectiveDepartment = alloc?.department || cc.department;
          const classValue = alloc?.class || "";
          const effectiveEntityId = alloc?.allocated_entity_id || cc.operatingEntityId;
          const effectiveEntityName = alloc?.allocated_entity_name || cc.operatingEntityName;
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

          // --- Process punch segments into daily data ---
          const dailyData: Record<string, PunchDayData> = {};

          if (!fetchFailed && punches.length > 0) {
            // Group all segments by date across all punch records
            const segsByDate = new Map<string, { workHours: number; workEarnings: number; mealHours: number; mealEarnings: number }>();

            for (const punch of punches) {
              for (const seg of punch.segments || []) {
                const date = seg.date;
                if (!date) continue;

                let entry = segsByDate.get(date);
                if (!entry) {
                  entry = { workHours: 0, workEarnings: 0, mealHours: 0, mealEarnings: 0 };
                  segsByDate.set(date, entry);
                }

                if (isMealPremium(seg.punchType)) {
                  // Meal premium penalty
                  entry.mealHours += seg.durationHours || 0;
                  entry.mealEarnings += seg.earnings || 0;
                } else if (seg.punchType === "work") {
                  // Regular work
                  entry.workHours += seg.durationHours || 0;
                  entry.workEarnings += seg.earnings || 0;
                }
                // "lunch" segments are unpaid — skip
              }
            }

            // Calculate daily OT using CA rules
            for (const [date, entry] of segsByDate) {
              const worked = entry.workHours;
              const regHours = Math.min(worked, 8);
              const otHours = Math.max(0, Math.min(worked, 12) - 8);
              const dtHours = Math.max(0, worked - 12);

              dailyData[date] = {
                totalWorkHours: round2(worked),
                regHours: round2(regHours),
                regDollars: round2(regHours * baseRate),
                otHours: round2(otHours),
                otDollars: round2(otHours * baseRate * 1.5),
                dtHours: round2(dtHours),
                dtDollars: round2(dtHours * baseRate * 2.0),
                mealHours: round2(entry.mealHours),
                mealDollars: round2(entry.mealEarnings),
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

    const employeesWithData = punchEmployees.filter((e) => e.hasPunchData).length;

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
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch punch calendar data" },
      { status: 500 }
    );
  }
}
