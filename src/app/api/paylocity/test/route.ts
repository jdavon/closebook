import { NextResponse } from "next/server";
import { PaylocityClient } from "@/lib/paylocity";

/**
 * GET /api/paylocity/test
 * Tests Paylocity API connectivity and pulls sample data from both APIs.
 * For development use only.
 */
export async function GET() {
  try {
    const client = new PaylocityClient();

    // 1. Test authentication for both APIs
    const connections = await client.testConnections();

    const result: Record<string, unknown> = {
      companyId: client.companyId,
      connections,
    };

    // 2. If NextGen connected, pull employee demographics + cost centers
    if (connections.nextGen.ok) {
      try {
        const employees = await client.getEmployees({ activeOnly: true });
        result.nextGen = {
          employeeCount: employees.length,
          sampleEmployees: employees.slice(0, 3).map((e) => ({
            id: e.id,
            displayName: e.displayName,
            status: e.status,
            statusType: e.statusType,
            jobTitle: e.info?.jobTitle,
            payType: e.currentPayRate?.payType,
            annualSalary: e.currentPayRate?.annualSalary,
            baseRate: e.currentPayRate?.baseRate,
            payFrequency: e.currentPayRate?.payFrequency,
            costCenter1: e.position?.costCenter1,
            costCenter2: e.position?.costCenter2,
            hireDate: e.info?.hireDate,
          })),
        };
      } catch (e) {
        result.nextGen = {
          error: e instanceof Error ? e.message : "Failed to fetch employees",
        };
      }

      try {
        const costCenters = await client.getCostCenters();
        result.costCenters = costCenters;
      } catch (e) {
        result.costCentersError =
          e instanceof Error ? e.message : "Failed to fetch cost centers";
      }

      try {
        const jobCodes = await client.getJobCodes();
        result.jobCodes = {
          count: jobCodes.length,
          sample: jobCodes.slice(0, 5),
        };
      } catch (e) {
        result.jobCodesError =
          e instanceof Error ? e.message : "Failed to fetch job codes";
      }
    }

    // 3. If WebLink connected and we have employees, pull a pay statement sample
    if (connections.webLink.ok && result.nextGen) {
      const ng = result.nextGen as { sampleEmployees?: { id: string }[] };
      const firstEmpId = ng.sampleEmployees?.[0]?.id;
      if (firstEmpId) {
        try {
          const payStatements = await client.getPayStatementSummary(
            firstEmpId,
            new Date().getFullYear()
          );
          result.webLink = {
            payStatements: {
              count: payStatements.length,
              sample: payStatements.slice(0, 3),
            },
          };
        } catch (e) {
          result.webLink = {
            error:
              e instanceof Error ? e.message : "Failed to fetch pay statements",
          };
        }
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
