import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { aggregateByEntity } from "@/lib/utils/payroll-calculations";
import type { Employee } from "@/lib/paylocity/types";
import type { PaylocityClient } from "@/lib/paylocity";

/**
 * GET /api/paylocity/payroll-summary?year=2026
 *
 * Returns aggregated payroll data by entity and department across all
 * configured Paylocity companies, plus monthly pay history trend.
 */
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();

  try {
    // Fetch employees from all companies in parallel
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

    // Merge employees, tagging each with companyId for correct cost center resolution
    const allEmployees: (Employee & { _companyId?: string })[] = [];
    for (const { companyId, employees } of companyResults) {
      for (const emp of employees) {
        (emp as Employee & { _companyId?: string })._companyId = companyId;
        allEmployees.push(emp as Employee & { _companyId?: string });
      }
    }

    // Aggregate by entity
    const entitySummaries = aggregateByEntity(allEmployees);

    // Total org KPIs
    const totalHeadcount = entitySummaries.reduce((s, e) => s + e.headcount, 0);
    const totalAnnualComp = entitySummaries.reduce((s, e) => s + e.totalAnnualComp, 0);
    const avgComp = totalHeadcount > 0 ? Math.round(totalAnnualComp / totalHeadcount) : 0;

    // Fetch pay history for a sample of employees to build monthly trend
    const sampleByCompany = companyResults.map(({ companyId, client, employees }) => ({
      companyId,
      client,
      sample: pickSample(employees, Math.max(5, Math.round(20 * employees.length / allEmployees.length))),
    }));

    const monthlyTotals: Record<string, { gross: number; net: number; hours: number; checkCount: number }> = {};
    let totalSampleSize = 0;

    for (const { client, sample } of sampleByCompany) {
      totalSampleSize += sample.length;
      const batchSize = 5;
      for (let i = 0; i < sample.length; i += batchSize) {
        const batch = sample.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (emp) => {
            try {
              return await client.getPayStatementSummary(emp.id, year);
            } catch {
              return [];
            }
          })
        );

        for (const statements of results) {
          for (const ps of statements) {
            const month = ps.checkDate.slice(0, 7);
            if (!monthlyTotals[month]) {
              monthlyTotals[month] = { gross: 0, net: 0, hours: 0, checkCount: 0 };
            }
            monthlyTotals[month].gross += ps.grossPay || 0;
            monthlyTotals[month].net += ps.netPay || 0;
            monthlyTotals[month].hours += ps.hours || 0;
            monthlyTotals[month].checkCount++;
          }
        }
      }
    }

    // Scale up monthly totals based on sample ratio
    const scaleFactor = allEmployees.length > 0 && totalSampleSize > 0
      ? allEmployees.length / totalSampleSize
      : 1;

    const payHistory = Object.entries(monthlyTotals)
      .map(([month, data]) => ({
        month,
        estimatedGross: Math.round(data.gross * scaleFactor),
        estimatedNet: Math.round(data.net * scaleFactor),
        sampleGross: Math.round(data.gross),
        sampleSize: totalSampleSize,
        totalEmployees: allEmployees.length,
        checkCount: data.checkCount,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      year,
      kpis: {
        totalHeadcount,
        totalAnnualComp: Math.round(totalAnnualComp),
        totalMonthlyComp: Math.round(totalAnnualComp / 12),
        avgCompensation: avgComp,
      },
      entitySummaries,
      payHistory,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build payroll summary" },
      { status: 500 }
    );
  }
}

function pickSample(employees: { id: string; position?: { costCenter1?: string } }[], maxSize: number) {
  if (employees.length <= maxSize) return employees;

  const byCc: Record<string, typeof employees> = {};
  for (const emp of employees) {
    const cc = emp.position?.costCenter1 ?? "UNKNOWN";
    if (!byCc[cc]) byCc[cc] = [];
    byCc[cc].push(emp);
  }

  const result: typeof employees = [];
  const ccKeys = Object.keys(byCc);
  let remaining = maxSize;

  for (const cc of ccKeys) {
    const count = Math.max(1, Math.round((byCc[cc].length / employees.length) * maxSize));
    const take = Math.min(count, remaining, byCc[cc].length);
    result.push(...byCc[cc].slice(0, take));
    remaining -= take;
    if (remaining <= 0) break;
  }

  return result;
}
