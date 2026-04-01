import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import {
  calculateAccruals,
  getAnnualComp,
  extractEmployerBenefitCosts,
  annualizeEmployerBenefits,
  type EmployeeAccrualInput,
} from "@/lib/utils/payroll-calculations";
import type { Employee } from "@/lib/paylocity/types";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";

/**
 * GET /api/paylocity/accrual-detail?year=2026&month=3
 *
 * Returns per-employee accrual calculations for a given period.
 * This runs the same calculation engine as sync but doesn't save anything.
 * Shows exactly how each employee's accrued wages, taxes, and employer benefits are computed.
 */

// In-memory cache keyed by "year-month"
let cachedResult: {
  key: string;
  data: ReturnType<typeof buildResponse>;
  fetchedAt: number;
} | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildResponse(
  accrualResult: ReturnType<typeof calculateAccruals>,
  allEmployees: { emp: Employee; companyId: string; cc: ReturnType<typeof getOperatingEntityForCostCenter> }[]
) {
  // Build per-employee detail with all the info the UI needs
  const employees = accrualResult.employeeDetails.map((detail) => {
    const empInfo = allEmployees.find((e) => e.emp.id === detail.employeeId);
    return {
      id: detail.employeeId,
      displayName: detail.employeeName ?? `Employee ${detail.employeeId}`,
      department: detail.department,
      costCenterCode: detail.costCenterCode,
      operatingEntityId: detail.costCenterEntry.operatingEntityId,
      operatingEntityCode: detail.costCenterEntry.operatingEntityCode,
      operatingEntityName: detail.costCenterEntry.operatingEntityName,
      jobTitle: empInfo?.emp.info?.jobTitle ?? "",
      payType: empInfo?.emp.currentPayRate?.payType ?? "Unknown",
      annualComp: detail.annualComp,
      dailyRate: detail.dailyRate,
      accrualDays: detail.accrualDays,
      wageAccrual: detail.wageAccrual,
      taxAccrual: detail.taxAccrual,
      benefitAccrual: detail.benefitAccrual,
      annualBenefitCost: detail.annualBenefitCost,
      benefitBreakdown: detail.benefitBreakdown,
      totalAccrual: Math.round((detail.wageAccrual + detail.taxAccrual + detail.benefitAccrual) * 100) / 100,
      taxBreakdown: detail.taxBreakdown,
    };
  });

  // Sort by entity then by name
  employees.sort((a, b) => {
    if (a.operatingEntityCode !== b.operatingEntityCode) {
      return a.operatingEntityCode.localeCompare(b.operatingEntityCode);
    }
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });

  return {
    periodYear: accrualResult.periodYear,
    periodMonth: accrualResult.periodMonth,
    periodEndDate: accrualResult.periodEndDate,
    totalWageAccrual: accrualResult.totalWageAccrual,
    totalTaxAccrual: accrualResult.totalTaxAccrual,
    totalBenefitAccrual: accrualResult.totalBenefitAccrual,
    totalAccrual: accrualResult.totalAccrual,
    employeeCount: accrualResult.employeeCount,
    employees,
    warnings: accrualResult.warnings,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periodYear = Number(searchParams.get("year") || new Date().getFullYear());
    const periodMonth = Number(searchParams.get("month") || new Date().getMonth() + 1);

    if (!periodYear || !periodMonth || periodMonth < 1 || periodMonth > 12) {
      return NextResponse.json(
        { error: "Invalid year or month parameter" },
        { status: 400 }
      );
    }

    const cacheKey = `${periodYear}-${periodMonth}`;

    // Check cache
    if (cachedResult && cachedResult.key === cacheKey && Date.now() - cachedResult.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cachedResult.data, cached: true });
    }

    // 1. Fetch employees from all companies
    const clients = getAllCompanyClients();
    const companyResults = await Promise.all(
      clients.map(async (client) => {
        const raw = await client.getEmployees({
          activeOnly: true,
          include: ["info", "position", "payrate", "status"],
        });
        // Filter out system accounts, test records, and removed employees
        const employees = raw.filter((emp) => {
          if (emp.status === "Removed") return false;
          if (!emp.info?.firstName && !emp.info?.lastName) return false;
          if (typeof emp.id === "string" && /^(P\d|coRpt)/i.test(emp.id)) return false;
          return true;
        });
        return { companyId: client.companyId, client, employees };
      })
    );

    // 2. Batch-fetch pay statements + pay details for YTD wages, last check date, and benefit costs
    const inputs: EmployeeAccrualInput[] = [];
    const allEmployees: { emp: Employee; companyId: string; cc: ReturnType<typeof getOperatingEntityForCostCenter> }[] = [];
    const batchSize = 5;
    const companyMaxEndDate: Record<string, string> = {};

    for (const { companyId, client, employees } of companyResults) {
      for (let i = 0; i < employees.length; i += batchSize) {
        const batch = employees.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (emp) => {
            // Tag for cost center resolution
            (emp as Employee & { _companyId?: string })._companyId = companyId;

            const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, companyId);
            allEmployees.push({ emp, companyId, cc });

            try {
              // Fetch pay statement summaries AND details in parallel
              const [payStatements, payDetails] = await Promise.all([
                client.getPayStatementSummary(emp.id, periodYear),
                client.getPayStatementDetails(emp.id, periodYear),
              ]);

              const periodEndDate = new Date(periodYear, periodMonth, 0);

              const relevantStatements = payStatements
                .filter((ps) => new Date(ps.endDate) <= periodEndDate)
                .sort(
                  (a, b) =>
                    new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
                );

              const lastPaidThrough = relevantStatements[0]?.endDate ?? null;

              // Track company-wide latest pay period end
              if (lastPaidThrough) {
                if (!companyMaxEndDate[companyId] || lastPaidThrough > companyMaxEndDate[companyId]) {
                  companyMaxEndDate[companyId] = lastPaidThrough;
                }
              }

              // Compute average weekly gross from recent paychecks (last 2-3)
              let recentWeeklyRate: number | null = null;
              const recentChecks = relevantStatements.slice(0, 3);
              if (recentChecks.length > 0) {
                let totalGross = 0;
                let totalCalendarDays = 0;
                for (const ps of recentChecks) {
                  totalGross += ps.grossPay || 0;
                  const begin = new Date(
                    ps.beginDate.includes("T") ? ps.beginDate.split("T")[0] : ps.beginDate
                  );
                  const end = new Date(
                    ps.endDate.includes("T") ? ps.endDate.split("T")[0] : ps.endDate
                  );
                  const days = Math.floor((end.getTime() - begin.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                  totalCalendarDays += days;
                }
                if (totalCalendarDays > 0 && totalGross > 0) {
                  recentWeeklyRate = Math.round((totalGross / totalCalendarDays) * 7 * 100) / 100;
                }
              }

              // YTD gross for tax cap calc
              const ytdStatements = payStatements.filter(
                (ps) => new Date(ps.checkDate) <= periodEndDate
              );

              // Extract employer benefit costs from pay details
              const benefitCosts = extractEmployerBenefitCosts(payDetails);
              const annualBenefitCost = annualizeEmployerBenefits(benefitCosts.total, periodMonth);
              const annualizedBreakdown: Record<string, number> = {};
              for (const [code, amount] of Object.entries(benefitCosts.breakdown)) {
                annualizedBreakdown[code] = Math.round(annualizeEmployerBenefits(amount, periodMonth) * 100) / 100;
              }

              return {
                employee: emp,
                ytdGrossWages: ytdStatements.reduce((sum, ps) => sum + (ps.grossPay || 0), 0),
                lastCheckDate: lastPaidThrough,
                lastPayStatement: relevantStatements[0],
                annualBenefitCost,
                benefitBreakdown: annualizedBreakdown,
                recentWeeklyRate,
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

    // Set company-wide last pay period end on all inputs
    for (const input of inputs) {
      const cid = (input.employee as Employee & { _companyId?: string })._companyId;
      if (cid && companyMaxEndDate[cid]) {
        input.companyLastPayPeriodEnd = companyMaxEndDate[cid];
      }
    }

    // 3. Run calculation engine
    const accrualResult = calculateAccruals(inputs, periodYear, periodMonth);

    // 4. Build response
    const data = buildResponse(accrualResult, allEmployees);

    // Cache it
    cachedResult = { key: cacheKey, data, fetchedAt: Date.now() };

    return NextResponse.json({ ...data, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to calculate accrual detail" },
      { status: 500 }
    );
  }
}
