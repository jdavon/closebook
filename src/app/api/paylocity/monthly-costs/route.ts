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

    // Fetch monthly costs and allocations in parallel
    const [costsResult, allocResult] = await Promise.all([
      supabase
        .from("employee_monthly_costs")
        .select("*")
        .eq("year", year)
        .order("month", { ascending: true }),
      supabase
        .from("employee_allocations")
        .select("*"),
    ]);

    if (costsResult.error) {
      return NextResponse.json({ error: costsResult.error.message }, { status: 500 });
    }

    const costs = costsResult.data ?? [];
    const allocations = allocResult.data ?? [];

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
 * Syncs pay statement data from Paylocity into Supabase.
 * For months with actual paychecks, stores actual amounts.
 * For the current month forward (if no paycheck data), stores accrued estimates.
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

      // Fetch active employees
      const rawEmployees = await client.getEmployees({
        activeOnly: true,
        include: ["info", "position", "payrate", "status"],
      });

      totalEmployees += rawEmployees.length;

      // Process employees in batches
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

            // Fetch pay statement summaries for the year
            let summaries: Awaited<ReturnType<typeof client.getPayStatementSummary>> = [];
            try {
              summaries = await client.getPayStatementSummary(emp.id, year);
            } catch {
              // Silent fail — we'll use accruals
            }

            // Fetch pay statement details for benefit costs
            let details: Awaited<ReturnType<typeof client.getPayStatementDetails>> = [];
            try {
              details = await client.getPayStatementDetails(emp.id, year);
            } catch {
              // Silent fail
            }

            // Build checkDate → pay period month lookup from summaries.
            // Use endDate (pay period end) to determine the month the cost
            // belongs to, NOT checkDate (when the check was issued). A check
            // dated Jan 5 may cover a Dec 16-31 pay period.
            const checkDateToMonth: Record<string, number> = {};
            for (const ps of summaries) {
              const periodMonth = ps.endDate
                ? parseInt(ps.endDate.split("-")[1], 10)
                : parseInt(ps.checkDate.split("-")[1], 10);
              checkDateToMonth[ps.checkDate] = periodMonth;
            }

            // Extract benefit costs per month from details
            const benefitsByMonth: Record<number, number> = {};
            for (const d of details) {
              const detTypeLower = (d.detType ?? "").toLowerCase();
              if (detTypeLower === "memo" || detTypeLower === "memoermatch") {
                const amount = d.amount ?? 0;
                if (amount > 0 && d.checkDate) {
                  const m = checkDateToMonth[d.checkDate]
                    ?? parseInt(d.checkDate.split("-")[1], 10);
                  benefitsByMonth[m] = (benefitsByMonth[m] ?? 0) + amount;
                }
              }
            }

            // Group pay summaries by pay period month (not check date)
            const byMonth: Record<
              number,
              { gross: number; hours: number; regHours: number; otHours: number; checks: number }
            > = {};

            for (const ps of summaries) {
              const m = checkDateToMonth[ps.checkDate]
                ?? parseInt(ps.checkDate.split("-")[1], 10);
              if (!byMonth[m]) {
                byMonth[m] = { gross: 0, hours: 0, regHours: 0, otHours: 0, checks: 0 };
              }
              byMonth[m].gross += ps.grossPay || 0;
              byMonth[m].hours += ps.hours || 0;
              byMonth[m].regHours += ps.regularHours || 0;
              byMonth[m].otHours += ps.overtimeHours || 0;
              byMonth[m].checks++;
            }

            // Annual benefit estimate for accrual months
            const ytdBenefits = Object.values(benefitsByMonth).reduce((s, v) => s + v, 0);
            const monthsWithBenefitData = Object.keys(benefitsByMonth).length;
            const monthlyBenefitEstimate =
              monthsWithBenefitData > 0 ? ytdBenefits / monthsWithBenefitData : 0;

            // Determine how far to generate rows
            // For the requested year: generate through current month (if current year) or all 12
            const lastMonth = year < currentYear ? 12 : year === currentYear ? currentMonth : 0;

            for (let m = 1; m <= lastMonth; m++) {
              const actual = byMonth[m];
              const hasActual = actual && actual.checks > 0;

              const grossPay = hasActual
                ? round(actual.gross)
                : round(annualComp / 12); // accrual

              const erTaxes = round(
                estimateAnnualERTaxes(grossPay * 12).total / 12
              );

              const erBenefits = hasActual
                ? round(benefitsByMonth[m] ?? monthlyBenefitEstimate)
                : round(monthlyBenefitEstimate);

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
                er_benefits: erBenefits,
                total_cost: round(grossPay + erTaxes + erBenefits),
                hours_worked: hasActual ? round(actual.hours) : 0,
                regular_hours: hasActual ? round(actual.regHours) : 0,
                overtime_hours: hasActual ? round(actual.otHours) : 0,
                check_count: hasActual ? actual.checks : 0,
                is_accrual: !hasActual,
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
