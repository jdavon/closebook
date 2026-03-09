import { NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import { getAnnualComp } from "@/lib/utils/payroll-calculations";

/**
 * GET /api/paylocity/employees
 *
 * Returns all active employees across all configured Paylocity companies,
 * with entity mapping, department, and pay info.
 * Used by both org-level and entity-level dashboards.
 *
 * Response cached for 5 minutes via in-memory cache.
 */

let cachedData: { employees: MappedEmployee[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MappedEmployee {
  id: string;
  companyId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  status: string;
  statusType: string;
  jobTitle: string;
  payType: string;
  annualComp: number;
  baseRate: number;
  hireDate: string | null;
  costCenterCode: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
}

export async function GET() {
  try {
    // Check in-memory cache
    if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json(
        { employees: cachedData.employees, cached: true },
        {
          headers: {
            "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
          },
        }
      );
    }

    // Fetch employees from all configured companies in parallel
    const clients = getAllCompanyClients();
    const results = await Promise.all(
      clients.map(async (client) => {
        const raw = await client.getEmployees({
          activeOnly: true,
          include: ["info", "position", "payrate", "status"],
        });
        return { companyId: client.companyId, employees: raw };
      })
    );

    // Merge and map employees from all companies
    // Note: activeOnly=true in the API call already filters to active employees,
    // so no need for a statusType check (batch endpoint doesn't return it at top level)
    const employees: MappedEmployee[] = [];

    for (const { companyId, employees: rawEmployees } of results) {
      for (const emp of rawEmployees) {
        const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, companyId);
        employees.push({
          id: emp.id,
          companyId,
          displayName: emp.displayName ?? (`${emp.info?.firstName ?? ""} ${emp.info?.lastName ?? emp.lastName ?? ""}`.trim() || `Employee ${emp.id}`),
          firstName: emp.info?.firstName ?? "",
          lastName: emp.info?.lastName ?? emp.lastName ?? "",
          status: emp.currentStatus?.statusType ?? emp.status ?? "Active",
          statusType: emp.currentStatus?.statusType ?? "A",
          jobTitle: emp.info?.jobTitle ?? "",
          payType: emp.currentPayRate?.payType ?? "Unknown",
          annualComp: getAnnualComp(emp),
          baseRate: emp.currentPayRate?.baseRate ?? 0,
          hireDate: emp.info?.hireDate ?? null,
          costCenterCode: emp.position?.costCenter1 ?? "UNKNOWN",
          department: cc.department,
          operatingEntityId: cc.operatingEntityId,
          operatingEntityCode: cc.operatingEntityCode,
          operatingEntityName: cc.operatingEntityName,
        });
      }
    }

    employees.sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));

    // Update cache
    cachedData = { employees, fetchedAt: Date.now() };

    return NextResponse.json(
      { employees, cached: false },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch employees" },
      { status: 500 }
    );
  }
}
