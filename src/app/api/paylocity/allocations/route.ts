import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/paylocity/allocations
 *
 * Returns all employee allocation overrides (department, class, company).
 * Optionally filter by ?companyId=132427
 *
 * Gracefully returns empty array if the table doesn't exist yet.
 */
export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get("companyId");
    const supabase = createAdminClient();

    let query = supabase.from("employee_allocations").select("*");
    if (companyId) {
      query = query.eq("paylocity_company_id", companyId);
    }

    const { data, error } = await query;

    // If table doesn't exist yet, return empty (graceful degradation)
    if (error && error.message?.includes("employee_allocations")) {
      return NextResponse.json({ allocations: [], tableExists: false });
    }
    if (error) throw error;

    return NextResponse.json({ allocations: data ?? [] });
  } catch (err) {
    // Catch-all: return empty allocations rather than 500
    console.error("Allocations GET error:", err);
    return NextResponse.json({ allocations: [], tableExists: false });
  }
}

/**
 * PUT /api/paylocity/allocations
 *
 * Upsert an employee allocation override.
 * Body: { employeeId, paylocityCompanyId, effectiveDate?, department?, class?, allocatedEntityId?, allocatedEntityName? }
 *
 * effectiveDate defaults to '2000-01-01' (the base/initial allocation).
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      employeeId,
      paylocityCompanyId,
      effectiveDate,
      department,
      class: classValue,
      allocatedEntityId,
      allocatedEntityName,
    } = body;

    if (!employeeId || !paylocityCompanyId) {
      return NextResponse.json(
        { error: "employeeId and paylocityCompanyId are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("employee_allocations")
      .upsert(
        {
          employee_id: employeeId,
          paylocity_company_id: paylocityCompanyId,
          effective_date: effectiveDate ?? "2000-01-01",
          department: department ?? null,
          class: classValue ?? null,
          allocated_entity_id: allocatedEntityId ?? null,
          allocated_entity_name: allocatedEntityName ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,paylocity_company_id,effective_date" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ allocation: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save allocation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/paylocity/allocations
 *
 * Delete a specific allocation period.
 * Body: { employeeId, paylocityCompanyId, effectiveDate }
 *
 * Cannot delete the base allocation ('2000-01-01') if it is the only one.
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { employeeId, paylocityCompanyId, effectiveDate } = body;

    if (!employeeId || !paylocityCompanyId || !effectiveDate) {
      return NextResponse.json(
        { error: "employeeId, paylocityCompanyId, and effectiveDate are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Guard: don't delete the base allocation if it's the only one
    if (effectiveDate === "2000-01-01") {
      const { count } = await supabase
        .from("employee_allocations")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", employeeId)
        .eq("paylocity_company_id", paylocityCompanyId);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the only allocation for this employee" },
          { status: 400 }
        );
      }
    }

    const { error } = await supabase
      .from("employee_allocations")
      .delete()
      .eq("employee_id", employeeId)
      .eq("paylocity_company_id", paylocityCompanyId)
      .eq("effective_date", effectiveDate);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete allocation" },
      { status: 500 }
    );
  }
}
