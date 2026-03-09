import { NextResponse } from "next/server";
import { getAllCompanyClients } from "@/lib/paylocity";
import type { PaylocityClient } from "@/lib/paylocity";
import { getOperatingEntityForCostCenter } from "@/lib/paylocity/cost-center-config";
import {
  getAnnualComp,
  estimateAnnualERTaxes,
  extractEmployerBenefitCosts,
  annualizeEmployerBenefits,
} from "@/lib/utils/payroll-calculations";

/**
 * GET /api/paylocity/employees
 *
 * Returns all active employees across all configured Paylocity companies,
 * with entity mapping, department, pay info, and employer-paid benefit costs.
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
  erTaxes: number;
  erBenefits: number;
  erBenefitBreakdown: Record<string, number>;
  totalComp: number;
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
        return { companyId: client.companyId, client, employees: raw };
      })
    );

    // Determine current year and how many months of data we have
    const now = new Date();
    const year = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // Merge and map employees from all companies
    const employees: MappedEmployee[] = [];

    for (const { companyId, client, employees: rawEmployees } of results) {
      // Batch-fetch pay statement details for employer benefit costs
      // Process in batches of 5 to respect API concurrency
      const batchSize = 5;
      const employeeBenefits: Record<string, { total: number; breakdown: Record<string, number> }> = {};

      for (let i = 0; i < rawEmployees.length; i += batchSize) {
        const batch = rawEmployees.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (emp) => {
            try {
              const details = await client.getPayStatementDetails(emp.id, year);
              if (details.length > 0) {
                const costs = extractEmployerBenefitCosts(details);
                if (costs.total > 0) {
                  // Annualize based on how many months of data we have
                  const annualized = annualizeEmployerBenefits(costs.total, currentMonth);
                  const annualizedBreakdown: Record<string, number> = {};
                  for (const [code, amount] of Object.entries(costs.breakdown)) {
                    annualizedBreakdown[code] = Math.round(annualizeEmployerBenefits(amount, currentMonth) * 100) / 100;
                  }
                  employeeBenefits[emp.id] = { total: annualized, breakdown: annualizedBreakdown };
                }
              }
            } catch {
              // Silent fail — employee just won't have benefit data
            }
          })
        );
      }

      for (const emp of rawEmployees) {
        // Skip ghost/placeholder records with no name data
        const firstName = emp.info?.firstName ?? "";
        const lastName = emp.info?.lastName ?? emp.lastName ?? "";
        const hasName = !!(emp.displayName || firstName || lastName);
        if (!hasName) continue;

        const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, companyId);
        const annualComp = getAnnualComp(emp);
        const { total: erTaxes } = estimateAnnualERTaxes(annualComp);
        const benefits = employeeBenefits[emp.id] ?? { total: 0, breakdown: {} };

        employees.push({
          id: emp.id,
          companyId,
          displayName: emp.displayName ?? (`${firstName} ${lastName}`.trim() || `Employee ${emp.id}`),
          firstName,
          lastName,
          status: emp.currentStatus?.statusType ?? emp.status ?? "Active",
          statusType: emp.currentStatus?.statusType ?? "A",
          jobTitle: emp.info?.jobTitle ?? "",
          payType: emp.currentPayRate?.payType ?? "Unknown",
          annualComp,
          erTaxes,
          erBenefits: benefits.total,
          erBenefitBreakdown: benefits.breakdown,
          totalComp: annualComp + erTaxes + benefits.total,
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
