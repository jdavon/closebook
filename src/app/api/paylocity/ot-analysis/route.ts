import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { getISOWeek, getISOWeekYear } from "date-fns";
import type {
  PayStatementSummary,
  PayStatementDetail,
} from "@/lib/paylocity/types";

/**
 * GET /api/paylocity/ot-analysis?year=2026
 *
 * Returns overtime analysis for all active employees across all configured
 * Paylocity companies, broken down by month.
 *
 * HYBRID DATA SOURCES:
 *   - PayStatementSummary (WebLink API) — trusted aggregate `overtimeHours`
 *     and `overtimeDollars` per pay check (used for OT + REG totals).
 *   - PayStatementDetail (WebLink API) — individual line items filtered for
 *     detCode = DT (double time 2x) and MEAL (meal premiums) only.
 *   - employee_allocations (Supabase) — user-maintained overrides for
 *     department, class, and company (entity) assignment.
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

// detCodes to extract from detail line items (supplemental to summary)
const DETAIL_CODES = new Set(["DT", "MEAL"]);

/** Convert a "YYYY-MM-DD" check date to an ISO week key like "2026-W10" */
function toWeekKey(checkDate: string): string | null {
  const d = new Date(checkDate);
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
      // Fetch pay statement summary + details in batches of 5
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (emp) => {
            // Fetch summary and details independently — if details fails,
            // we still keep the summary (which is the primary data source)
            let summaries: PayStatementSummary[] = [];
            let details: PayStatementDetail[] = [];

            try {
              summaries = await client.getPayStatementSummary(emp.id, year);
            } catch {
              // No summary data for this employee — skip
            }

            try {
              details = await client.getPayStatementDetails(emp.id, year);
            } catch {
              // Details unavailable — OK, we still have summary for OT/REG
            }

            return { emp, summaries, details };
          })
        );

        for (const { emp, summaries, details } of batchResults) {
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

          // ── Aggregate from SUMMARY (OT + REG) ──
          const monthlyHours: Record<string, MonthlyHours> = {};
          const weeklyHours: Record<string, MonthlyHours> = {};
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

          for (const ps of summaries) {
            const month = ps.checkDate?.slice(0, 7); // "YYYY-MM"
            if (!month) continue;
            const week = toWeekKey(ps.checkDate);

            const m = ensureBucket(monthlyHours, month);

            // OT from summary (trusted aggregate)
            const otH = ps.overtimeHours || 0;
            const otD = ps.overtimeDollars || 0;
            m.otHours += otH;
            m.otDollars += otD;
            totals.otHours += otH;
            totals.otDollars += otD;

            // REG from summary
            const regH = ps.regularHours || 0;
            const regD = ps.regularDollars || 0;
            m.regHours += regH;
            m.regDollars += regD;
            totals.regHours += regH;
            totals.regDollars += regD;

            // Weekly bucket (mirrors monthly)
            if (week) {
              const w = ensureBucket(weeklyHours, week);
              w.otHours += otH;
              w.otDollars += otD;
              w.regHours += regH;
              w.regDollars += regD;
            }
          }

          // ── Aggregate from DETAILS (DT + MEAL only) ──
          for (const d of details) {
            const code = d.detCode?.toUpperCase();
            if (!code || !DETAIL_CODES.has(code)) continue;

            const month = d.checkDate?.slice(0, 7);
            if (!month) continue;
            const week = toWeekKey(d.checkDate);

            const hrs = d.hours || 0;
            const amt = d.amount || 0;
            const m = ensureBucket(monthlyHours, month);

            if (code === "DT") {
              m.dtHours += hrs;
              m.dtDollars += amt;
              totals.dtHours += hrs;
              totals.dtDollars += amt;
            } else if (code === "MEAL") {
              m.mealHours += hrs;
              m.mealDollars += amt;
              totals.mealHours += hrs;
              totals.mealDollars += amt;
            }

            // Weekly bucket (mirrors monthly)
            if (week) {
              const w = ensureBucket(weeklyHours, week);
              if (code === "DT") {
                w.dtHours += hrs;
                w.dtDollars += amt;
              } else if (code === "MEAL") {
                w.mealHours += hrs;
                w.mealDollars += amt;
              }
            }
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

          // Include ALL active employees (even those with zero OT / no pay data)
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
            totals,
          });
        }
      }
    }

    // Collect all months and weeks
    const monthSet = new Set<string>();
    const weekSet = new Set<string>();
    for (const emp of otEmployees) {
      for (const m of Object.keys(emp.monthlyHours)) monthSet.add(m);
      for (const w of Object.keys(emp.weeklyHours)) weekSet.add(w);
    }
    const months = [...monthSet].sort();
    const weeks = [...weekSet].sort();

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

    const responseData = {
      year,
      employees: otEmployees,
      months,
      weeks,
      kpis,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
