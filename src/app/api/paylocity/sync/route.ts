import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import {
  calculateAccruals,
  type EmployeeAccrualInput,
} from "@/lib/utils/payroll-calculations";
import {
  EMPLOYING_ENTITY_ID,
  getOperatingEntityForCostCenter,
} from "@/lib/paylocity/cost-center-config";
import type { Employee } from "@/lib/paylocity/types";

/**
 * POST /api/paylocity/sync
 *
 * Syncs payroll data from ALL configured Paylocity companies and generates
 * accrual entries. Merges employees from 132427 (Silverco) and 316791 (HDR).
 *
 * Body: { periodYear: number, periodMonth: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { periodYear, periodMonth } = await request.json();

  if (!periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "Missing: periodYear, periodMonth" },
      { status: 400 }
    );
  }

  // Create sync log
  const { data: syncLog } = await supabase
    .from("payroll_sync_logs")
    .insert({ entity_id: EMPLOYING_ENTITY_ID, status: "started" })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    // 1. Fetch employees from ALL configured companies in parallel
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

    // 2. Batch-fetch pay statements for the target year to get:
    //    - Last check date (for accrual start)
    //    - YTD gross wages (for tax cap calculations)
    const inputs: EmployeeAccrualInput[] = [];
    const batchSize = 5;

    for (const { companyId, client, employees } of companyResults) {
      for (let i = 0; i < employees.length; i += batchSize) {
        const batch = employees.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (emp) => {
            // Tag employee with companyId for cost center resolution
            (emp as Employee & { _companyId?: string })._companyId = companyId;

            try {
              const payStatements = await client.getPayStatementSummary(
                emp.id,
                periodYear
              );

              const periodEndDate = new Date(periodYear, periodMonth, 0);

              // Filter to pay statements whose PAY PERIOD ends on or before the
              // period end. We use endDate (pay period end), NOT checkDate, because
              // on a delayed payment schedule the check may be issued days/weeks
              // after the pay period closes. Using checkDate would incorrectly
              // assume wages are covered through the check date when they're only
              // covered through the pay period end.
              const relevantStatements = payStatements
                .filter((ps) => new Date(ps.endDate) <= periodEndDate)
                .sort(
                  (a, b) =>
                    new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
                );

              // The last pay period end date is our accrual boundary —
              // wages are earned but unpaid from the day after this through month-end
              const lastPaidThrough = relevantStatements[0]?.endDate ?? null;

              // YTD gross wages for tax cap calculations — use all checks
              // with check dates in the period for accurate cap tracking
              const ytdStatements = payStatements
                .filter((ps) => new Date(ps.checkDate) <= periodEndDate);
              const ytdGrossWages = ytdStatements.reduce(
                (sum, ps) => sum + (ps.grossPay || 0),
                0
              );

              return {
                employee: emp,
                ytdGrossWages,
                lastCheckDate: lastPaidThrough,
                lastPayStatement: relevantStatements[0],
              } satisfies EmployeeAccrualInput;
            } catch {
              return {
                employee: emp,
                ytdGrossWages: 0,
                lastCheckDate: null,
              } satisfies EmployeeAccrualInput;
            }
          })
        );
        inputs.push(...results);
      }
    }

    // Track per-company employee counts for diagnostics
    const companyCounts: Record<string, number> = {};
    for (const { companyId, employees } of companyResults) {
      companyCounts[companyId] = employees.length;
    }

    // 3. Run accrual calculation engine
    const accrualResult = calculateAccruals(inputs, periodYear, periodMonth);

    // 4. Load GL account mappings for all entities so we can populate account IDs
    const entityIds = [...new Set(accrualResult.lineItems.map((i) => i.operatingEntityId))];
    const { data: glMappings } = await supabase
      .from("payroll_gl_mappings")
      .select("entity_id, accrual_type, debit_account_id, credit_account_id")
      .in("entity_id", entityIds);

    const glLookup: Record<string, { debit: string | null; credit: string | null }> = {};
    for (const m of glMappings ?? []) {
      glLookup[`${m.entity_id}:${m.accrual_type}`] = {
        debit: m.debit_account_id,
        credit: m.credit_account_id,
      };
    }

    // 5. Delete existing synced accruals for this period (replace with fresh)
    await supabase
      .from("payroll_accruals")
      .delete()
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .eq("source", "paylocity_sync");

    // 6. Insert new accrual records — one per entity per type, with GL accounts
    const accrualRows = accrualResult.lineItems.map((item) => {
      const gl = glLookup[`${item.operatingEntityId}:${item.type}`];
      return {
        entity_id: item.operatingEntityId,
        period_year: periodYear,
        period_month: periodMonth,
        accrual_type: item.type,
        description: item.description,
        amount: item.amount,
        source: "paylocity_sync" as const,
        payroll_sync_id: syncLogId,
        status: "draft" as const,
        account_id: gl?.debit ?? null,
        offset_account_id: gl?.credit ?? null,
        notes: item.details
          ? Object.entries(item.details)
              .map(([k, v]) => `${k}: $${v.toFixed(2)}`)
              .join(", ")
          : null,
      };
    });

    if (accrualRows.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_accruals")
        .insert(accrualRows);

      if (insertError) {
        throw new Error(`Failed to insert accruals: ${insertError.message}`);
      }
    }

    // 6. Update sync log
    if (syncLogId) {
      await supabase
        .from("payroll_sync_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          employees_synced: accrualResult.employeeCount,
          accruals_generated: accrualRows.length,
          raw_data: {
            totalWageAccrual: accrualResult.totalWageAccrual,
            totalTaxAccrual: accrualResult.totalTaxAccrual,
            totalAccrual: accrualResult.totalAccrual,
            warnings: accrualResult.warnings,
            employeeCount: accrualResult.employeeCount,
          },
        })
        .eq("id", syncLogId);
    }

    // Build per-entity breakdown for diagnostics
    const entityBreakdown: Record<string, { wages: number; tax: number; benefits: number; employees: number }> = {};
    for (const detail of accrualResult.employeeDetails) {
      const eid = detail.costCenterEntry.operatingEntityName;
      if (!entityBreakdown[eid]) {
        entityBreakdown[eid] = { wages: 0, tax: 0, benefits: 0, employees: 0 };
      }
      entityBreakdown[eid].wages += detail.wageAccrual;
      entityBreakdown[eid].tax += detail.taxAccrual;
      entityBreakdown[eid].benefits += detail.benefitAccrual;
      entityBreakdown[eid].employees += 1;
    }

    return NextResponse.json({
      success: true,
      periodYear,
      periodMonth,
      employeesFetched: inputs.length,
      employeesWithAccruals: accrualResult.employeeCount,
      companyCounts,
      entityBreakdown,
      totalWageAccrual: accrualResult.totalWageAccrual,
      totalTaxAccrual: accrualResult.totalTaxAccrual,
      totalBenefitAccrual: accrualResult.totalBenefitAccrual,
      totalAccrual: accrualResult.totalAccrual,
      lineItems: accrualResult.lineItems.length,
      warnings: accrualResult.warnings,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown sync error";

    if (syncLogId) {
      await supabase
        .from("payroll_sync_logs")
        .update({
          status: "error",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", syncLogId);
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
