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
          include: ["info", "position", "payrate", "status"],
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

              const sorted = [...payStatements].sort(
                (a, b) => new Date(b.checkDate).getTime() - new Date(a.checkDate).getTime()
              );

              const periodEndDate = new Date(periodYear, periodMonth, 0);
              const relevantStatements = sorted.filter(
                (ps) => new Date(ps.checkDate) <= periodEndDate
              );

              const lastCheckDate = relevantStatements[0]?.checkDate ?? null;
              const ytdGrossWages = relevantStatements.reduce(
                (sum, ps) => sum + (ps.grossPay || 0),
                0
              );

              return {
                employee: emp,
                ytdGrossWages,
                lastCheckDate,
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

    // 3. Run accrual calculation engine
    const accrualResult = calculateAccruals(inputs, periodYear, periodMonth);

    // 4. Delete existing synced accruals for this period (replace with fresh)
    await supabase
      .from("payroll_accruals")
      .delete()
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .eq("source", "paylocity_sync");

    // 5. Insert new accrual records — one per entity per type
    const accrualRows = accrualResult.lineItems.map((item) => ({
      entity_id: item.operatingEntityId,
      period_year: periodYear,
      period_month: periodMonth,
      accrual_type: item.type,
      description: item.description,
      amount: item.amount,
      source: "paylocity_sync" as const,
      payroll_sync_id: syncLogId,
      status: "draft" as const,
      notes: item.details
        ? Object.entries(item.details)
            .map(([k, v]) => `${k}: $${v.toFixed(2)}`)
            .join(", ")
        : null,
    }));

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

    return NextResponse.json({
      success: true,
      periodYear,
      periodMonth,
      employeeCount: accrualResult.employeeCount,
      totalWageAccrual: accrualResult.totalWageAccrual,
      totalTaxAccrual: accrualResult.totalTaxAccrual,
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
