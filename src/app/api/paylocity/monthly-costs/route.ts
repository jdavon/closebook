import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAllCompanyClients } from "@/lib/paylocity";
import {
  getAnnualComp,
  estimateAnnualERTaxes,
} from "@/lib/utils/payroll-calculations";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";

// Use an untyped Supabase client since the table isn't in generated types yet
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/paylocity/monthly-costs?year=2026&entityId=...
 *
 * Reads monthly employee costs from Supabase (no Paylocity API calls).
 * Applies allocation overrides to filter by entity.
 */
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const entityId = request.nextUrl.searchParams.get("entityId");

  try {
    const supabase = getSupabase();

    // Paginate to avoid the Supabase 1000-row hard cap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchAll(table: string, filters: Record<string, string> = {}): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;

      while (true) {
        let q = supabase.from(table).select("*").range(from, from + pageSize - 1);
        for (const [key, val] of Object.entries(filters)) {
          q = q.eq(key, val);
        }
        const { data, error } = await q;
        if (error) throw new Error(`Query ${table} failed: ${error.message}`);
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }

      return all;
    }

    const [costs, allocations] = await Promise.all([
      fetchAll("employee_monthly_costs", { year: String(year) }),
      fetchAll("employee_allocations"),
    ]);

    // Build allocation lookup
    const allocMap: Record<string, typeof allocations[0]> = {};
    for (const a of allocations) {
      allocMap[`${a.employee_id}:${a.paylocity_company_id}`] = a;
    }

    // Apply allocation overrides to determine effective entity per row
    const enriched = costs.map((row) => {
      const override = allocMap[`${row.employee_id}:${row.paylocity_company_id}`];
      const defaultEntity = getOperatingEntityForCostCenter(
        row.cost_center_code,
        row.paylocity_company_id
      );

      const effectiveEntityId = override?.allocated_entity_id || defaultEntity.operatingEntityId;
      const effectiveDepartment = override?.department || defaultEntity.department;

      return {
        ...row,
        effective_entity_id: effectiveEntityId,
        effective_department: effectiveDepartment,
      };
    });

    // Filter by entity if requested
    const filtered = entityId
      ? enriched.filter((r) => r.effective_entity_id === entityId)
      : enriched;

    // Get last sync timestamp
    const lastSynced = costs.length > 0
      ? costs.reduce((latest, r) => {
          const t = r.synced_at ?? "";
          return t > latest ? t : latest;
        }, "")
      : null;

    return NextResponse.json({
      year,
      entityId: entityId ?? null,
      lastSynced,
      rows: filtered,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch monthly costs" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/paylocity/monthly-costs?year=2026
 *
 * Syncs pay statement data from Paylocity into Supabase using accrual
 * accounting. Pay periods that span month boundaries are pro-rated by
 * calendar days. Months (or partial months) not covered by any pay
 * period are filled with accrual estimates based on the employee's
 * annual comp rate.
 */
export async function POST(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();

  try {
    const supabase = getSupabase();
    const clients = getAllCompanyClients();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const syncedAt = now.toISOString();

    // Determine which months to generate (through current month for current year, all 12 for past years)
    const lastMonth = year < currentYear ? 12 : year === currentYear ? currentMonth : 0;

    const upsertRows: {
      employee_id: string;
      paylocity_company_id: string;
      employee_name: string;
      job_title: string;
      pay_type: string;
      cost_center_code: string;
      annual_comp: number;
      year: number;
      month: number;
      gross_pay: number;
      er_taxes: number;
      er_benefits: number;
      total_cost: number;
      hours_worked: number;
      regular_hours: number;
      overtime_hours: number;
      check_count: number;
      is_accrual: boolean;
      synced_at: string;
      updated_at: string;
    }[] = [];

    let totalEmployees = 0;

    for (const client of clients) {
      const companyId = client.companyId;

      const rawEmployees = await client.getEmployees({
        activeOnly: true,
        include: ["info", "position", "payrate", "status"],
      });

      totalEmployees += rawEmployees.length;

      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (emp) => {
            const firstName = emp.info?.firstName ?? "";
            const lastName = emp.info?.lastName ?? emp.lastName ?? "";
            const displayName =
              emp.displayName ?? (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);

            const annualComp = getAnnualComp(emp);
            const costCenterCode = emp.position?.costCenter1 ?? null;
            const jobTitle = emp.info?.jobTitle ?? "";
            const payType = emp.currentPayRate?.payType ?? "Unknown";

            // Daily rate for accrual estimates (calendar days)
            const dailyRate = annualComp / 365;

            // Fetch pay statements
            let summaries: Awaited<ReturnType<typeof client.getPayStatementSummary>> = [];
            try {
              summaries = await client.getPayStatementSummary(emp.id, year);
            } catch {
              // Silent fail — full accrual
            }

            let details: Awaited<ReturnType<typeof client.getPayStatementDetails>> = [];
            try {
              details = await client.getPayStatementDetails(emp.id, year);
            } catch {
              // Silent fail
            }

            // ── Pro-rate each pay period across months ──
            //
            // For each pay statement, split gross pay, hours, and benefits
            // proportionally by how many calendar days of the pay period
            // fall in each month within the target year.

            interface MonthBucket {
              actualGross: number;
              actualHours: number;
              actualRegHours: number;
              actualOtHours: number;
              actualBenefits: number;
              checks: number;
              daysCovered: number; // calendar days covered by actual pay periods
            }

            const buckets: Record<number, MonthBucket> = {};
            for (let m = 1; m <= 12; m++) {
              buckets[m] = {
                actualGross: 0, actualHours: 0, actualRegHours: 0,
                actualOtHours: 0, actualBenefits: 0, checks: 0, daysCovered: 0,
              };
            }

            // Build benefit amounts per checkDate for pro-rating
            const benefitsByCheck: Record<string, number> = {};
            for (const d of details) {
              const detTypeLower = (d.detType ?? "").toLowerCase();
              if (detTypeLower === "memo" || detTypeLower === "memoermatch") {
                const amount = d.amount ?? 0;
                if (amount > 0 && d.checkDate) {
                  benefitsByCheck[d.checkDate] = (benefitsByCheck[d.checkDate] ?? 0) + amount;
                }
              }
            }

            for (const ps of summaries) {
              const begin = parseDate(ps.beginDate || ps.checkDate);
              const end = parseDate(ps.endDate || ps.checkDate);
              const totalDays = daysBetween(begin, end);
              if (totalDays <= 0) continue;

              const checkBenefits = benefitsByCheck[ps.checkDate] ?? 0;

              // Walk each month the pay period touches
              const startMonth = begin.getMonth() + 1;
              const startYear = begin.getFullYear();
              const endMonth = end.getMonth() + 1;
              const endYear = end.getFullYear();

              // Iterate from the begin date's month to the end date's month
              let cursor = new Date(begin);
              while (cursor <= end) {
                const curMonth = cursor.getMonth() + 1;
                const curYear = cursor.getFullYear();

                // Only count days that fall within the target year
                if (curYear === year) {
                  // First day of this month portion
                  const monthStart = (curYear === startYear && curMonth === startMonth)
                    ? begin
                    : new Date(curYear, curMonth - 1, 1);
                  // Last day of this month portion
                  const monthEnd = (curYear === endYear && curMonth === endMonth)
                    ? end
                    : new Date(curYear, curMonth, 0); // last day of month

                  const daysInMonth = daysBetween(monthStart, monthEnd);
                  const fraction = daysInMonth / totalDays;

                  if (curMonth >= 1 && curMonth <= 12 && daysInMonth > 0) {
                    buckets[curMonth].actualGross += (ps.grossPay || 0) * fraction;
                    buckets[curMonth].actualHours += (ps.hours || 0) * fraction;
                    buckets[curMonth].actualRegHours += (ps.regularHours || 0) * fraction;
                    buckets[curMonth].actualOtHours += (ps.overtimeHours || 0) * fraction;
                    buckets[curMonth].actualBenefits += checkBenefits * fraction;
                    buckets[curMonth].daysCovered += daysInMonth;
                    buckets[curMonth].checks++;
                  }
                }

                // Advance to the first day of the next month
                cursor = new Date(curYear, curMonth, 1);
              }
            }

            // ── Build monthly rows: actual pro-rated data + accrual for gaps ──

            // Average monthly benefit from actual data for accrual fill
            const totalActualBenefits = Object.values(buckets).reduce((s, b) => s + b.actualBenefits, 0);
            const monthsWithActual = Object.values(buckets).filter((b) => b.checks > 0).length;
            const avgMonthlyBenefit = monthsWithActual > 0 ? totalActualBenefits / monthsWithActual : 0;

            for (let m = 1; m <= lastMonth; m++) {
              const b = buckets[m];
              const daysInCalendarMonth = new Date(year, m, 0).getDate();
              const daysCovered = Math.min(b.daysCovered, daysInCalendarMonth);
              const daysUncovered = daysInCalendarMonth - daysCovered;

              // Actual portion (from pro-rated pay periods)
              let grossPay = b.actualGross;
              let hours = b.actualHours;
              let regHours = b.actualRegHours;
              let otHours = b.actualOtHours;
              let benefits = b.actualBenefits;
              let isAccrual = false;

              // If the month isn't fully covered by pay periods, accrue the gap
              if (daysUncovered > 0 && annualComp > 0) {
                const accrualGross = dailyRate * daysUncovered;
                grossPay += accrualGross;
                isAccrual = daysCovered === 0; // fully accrued if no actual data at all
                // Estimate benefits for uncovered days
                if (avgMonthlyBenefit > 0) {
                  benefits += avgMonthlyBenefit * (daysUncovered / daysInCalendarMonth);
                }
              }

              grossPay = round(grossPay);
              benefits = round(benefits);
              const erTaxes = round(estimateAnnualERTaxes(grossPay * 12).total / 12);

              upsertRows.push({
                employee_id: emp.id,
                paylocity_company_id: companyId,
                employee_name: displayName,
                job_title: jobTitle,
                pay_type: payType,
                cost_center_code: costCenterCode ?? "",
                annual_comp: round(annualComp),
                year,
                month: m,
                gross_pay: grossPay,
                er_taxes: erTaxes,
                er_benefits: benefits,
                total_cost: round(grossPay + erTaxes + benefits),
                hours_worked: round(hours),
                regular_hours: round(regHours),
                overtime_hours: round(otHours),
                check_count: b.checks,
                is_accrual: isAccrual,
                synced_at: syncedAt,
                updated_at: syncedAt,
              });
            }
          })
        );
      }
    }

    // Upsert in batches of 500
    const upsertBatchSize = 500;
    let upsertedCount = 0;

    for (let i = 0; i < upsertRows.length; i += upsertBatchSize) {
      const batch = upsertRows.slice(i, i + upsertBatchSize);
      const { error } = await supabase
        .from("employee_monthly_costs")
        .upsert(batch, {
          onConflict: "employee_id,paylocity_company_id,year,month",
        });

      if (error) {
        return NextResponse.json(
          { error: `Upsert failed: ${error.message}` },
          { status: 500 }
        );
      }
      upsertedCount += batch.length;
    }

    return NextResponse.json({
      success: true,
      year,
      employeesProcessed: totalEmployees,
      rowsUpserted: upsertedCount,
      syncedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse "YYYY-MM-DD" to a Date at midnight local time */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Count calendar days between two dates, inclusive of both endpoints */
function daysBetween(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}
