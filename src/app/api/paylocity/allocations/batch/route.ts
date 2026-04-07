import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/paylocity/allocations/batch
 *
 * Batch upsert employee allocation overrides.
 * Body: { allocations: Array<{ employeeId, paylocityCompanyId, department?, class?, allocatedEntityId?, allocatedEntityName? }> }
 *
 * Gracefully returns success if the table doesn't exist yet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { allocations } = body;

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json(
        { error: "allocations array is required and must not be empty" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    let saved = 0;
    let failed = 0;
    const errors: string[] = [];

    // Upsert in batches of 50
    const batchSize = 50;
    for (let i = 0; i < allocations.length; i += batchSize) {
      const batch = allocations.slice(i, i + batchSize);

      const rows = batch.map(
        (a: {
          employeeId: string;
          paylocityCompanyId: string;
          effectiveDate?: string;
          department?: string;
          class?: string;
          allocatedEntityId?: string;
          allocatedEntityName?: string;
        }) => ({
          employee_id: a.employeeId,
          paylocity_company_id: a.paylocityCompanyId,
          effective_date: a.effectiveDate ?? "2000-01-01",
          department: a.department ?? null,
          class: a.class ?? null,
          allocated_entity_id: a.allocatedEntityId ?? null,
          allocated_entity_name: a.allocatedEntityName ?? null,
          updated_at: new Date().toISOString(),
        })
      );

      const { error } = await supabase
        .from("employee_allocations")
        .upsert(rows, { onConflict: "employee_id,paylocity_company_id,effective_date" });

      if (error) {
        // If table doesn't exist, return graceful response
        if (error.message?.includes("employee_allocations")) {
          return NextResponse.json({
            saved: 0,
            failed: 0,
            errors: ["employee_allocations table does not exist yet — run migration 028"],
            tableExists: false,
          });
        }
        failed += batch.length;
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        saved += batch.length;
      }
    }

    return NextResponse.json({ saved, failed, errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to batch save allocations" },
      { status: 500 }
    );
  }
}
