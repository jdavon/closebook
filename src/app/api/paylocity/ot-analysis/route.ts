import { NextRequest, NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";

/**
 * GET /api/paylocity/ot-analysis?year=2026
 *
 * Returns overtime analysis for all active employees across all configured
 * Paylocity companies, broken down by month with department/entity mapping.
 *
 * Data source: PayStatementSummary (WebLink API) — overtimeHours, overtimeDollars
 * per pay check, aggregated by month.
 */

interface MonthlyOT {
  otHours: number;
  otDollars: number;
  regHours: number;
  regDollars: number;
  totalHours: number;
}

interface OTEmployee {
  id: string;
  companyId: string;
  displayName: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  payType: string;
  costCenterCode: string;
  monthlyOT: Record<string, MonthlyOT>;
  totalOTHours: number;
  totalOTDollars: number;
  totalRegHours: number;
}

// In-memory cache (5 min TTL)
let cachedData: { data: unknown; year: number; fetchedAt: number } | null = null;
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

    for (const { companyId, client, employees: rawEmployees } of companyResults) {
      // Fetch pay statement summaries in batches of 5
      const batchSize = 5;

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        const summaryResults = await Promise.all(
          batch.map(async (emp) => {
            try {
              const summaries = await client.getPayStatementSummary(
                emp.id,
                year
              );
              return { emp, summaries };
            } catch {
              return { emp, summaries: [] };
            }
          })
        );

        for (const { emp, summaries } of summaryResults) {
          // Skip employees with no name
          const firstName = emp.info?.firstName ?? "";
          const lastName = emp.info?.lastName ?? emp.lastName ?? "";
          const displayName =
            emp.displayName ??
            (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`);
          if (!displayName) continue;

          const cc = getOperatingEntityForCostCenter(
            emp.position?.costCenter1,
            companyId
          );

          // Aggregate OT by month (YYYY-MM)
          const monthlyOT: Record<string, MonthlyOT> = {};
          let totalOTHours = 0;
          let totalOTDollars = 0;
          let totalRegHours = 0;

          for (const ps of summaries) {
            const month = ps.checkDate.slice(0, 7); // "YYYY-MM"
            if (!monthlyOT[month]) {
              monthlyOT[month] = {
                otHours: 0,
                otDollars: 0,
                regHours: 0,
                regDollars: 0,
                totalHours: 0,
              };
            }
            const ot = ps.overtimeHours || 0;
            const otD = ps.overtimeDollars || 0;
            const reg = ps.regularHours || 0;
            const regD = ps.regularDollars || 0;

            monthlyOT[month].otHours += ot;
            monthlyOT[month].otDollars += otD;
            monthlyOT[month].regHours += reg;
            monthlyOT[month].regDollars += regD;
            monthlyOT[month].totalHours += (ps.hours || 0);

            totalOTHours += ot;
            totalOTDollars += otD;
            totalRegHours += reg;
          }

          // Only include employees who have any hours at all
          if (summaries.length > 0) {
            otEmployees.push({
              id: emp.id,
              companyId,
              displayName,
              department: cc.department,
              operatingEntityId: cc.operatingEntityId,
              operatingEntityCode: cc.operatingEntityCode,
              operatingEntityName: cc.operatingEntityName,
              payType: emp.currentPayRate?.payType ?? "Unknown",
              costCenterCode: emp.position?.costCenter1 ?? "UNKNOWN",
              monthlyOT,
              totalOTHours: round2(totalOTHours),
              totalOTDollars: round2(totalOTDollars),
              totalRegHours: round2(totalRegHours),
            });
          }
        }
      }
    }

    // Collect all months that appear across any employee
    const monthSet = new Set<string>();
    for (const emp of otEmployees) {
      for (const m of Object.keys(emp.monthlyOT)) {
        monthSet.add(m);
      }
    }
    const months = [...monthSet].sort();

    // Compute org-level KPIs
    const totalOTHours = round2(
      otEmployees.reduce((s, e) => s + e.totalOTHours, 0)
    );
    const totalOTDollars = round2(
      otEmployees.reduce((s, e) => s + e.totalOTDollars, 0)
    );
    const totalRegHours = round2(
      otEmployees.reduce((s, e) => s + e.totalRegHours, 0)
    );
    const employeesWithOT = otEmployees.filter(
      (e) => e.totalOTHours > 0
    ).length;
    const avgOTPerEmployee =
      employeesWithOT > 0 ? round2(totalOTHours / employeesWithOT) : 0;

    const responseData = {
      year,
      employees: otEmployees,
      months,
      kpis: {
        totalOTHours,
        totalOTDollars,
        totalRegHours,
        employeesWithOT,
        avgOTPerEmployee,
        totalEmployees: otEmployees.length,
      },
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
