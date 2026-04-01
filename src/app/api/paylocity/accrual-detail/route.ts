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

              // Use pay period END DATE (not check date) to determine accrual
              // boundary. On a delayed payment schedule, the check is issued
              // after the pay period closes — using checkDate would incorrectly
              // assume wages are covered through the check date.
              const relevantStatements = payStatements
                .filter((ps) => new Date(ps.endDate) <= periodEndDate)
                .sort(
                  (a, b) =>
                    new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
                );

              // Last pay period end = wages are paid through this date
              const lastPaidThrough = relevantStatements[0]?.endDate ?? null;

              // YTD gross for tax cap calc — use check dates for accurate cap tracking
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
