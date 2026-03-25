import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
type AnyClient = any;

// PUT — upsert a single budget amount (or delete if amount is 0)
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { entityId, versionId, masterAccountId, periodYear, periodMonth, amount } =
      body;

    if (
      !entityId ||
      !versionId ||
      !masterAccountId ||
      !periodYear ||
      periodMonth === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "entityId, versionId, masterAccountId, periodYear, and periodMonth are required",
        },
        { status: 400 }
      );
    }

    const admin: AnyClient = createAdminClient();

    if (amount === 0 || amount === null || amount === undefined) {
      // Delete the row if it exists
      await admin
        .from("budget_amounts")
        .delete()
        .eq("budget_version_id", versionId)
        .eq("master_account_id", masterAccountId)
        .eq("period_year", periodYear)
        .eq("period_month", periodMonth);
    } else {
      // Upsert
      const { error } = await admin.from("budget_amounts").upsert(
        {
          entity_id: entityId,
          master_account_id: masterAccountId,
          budget_version_id: versionId,
          period_year: periodYear,
          period_month: periodMonth,
          amount,
        },
        {
          onConflict:
            "budget_version_id,master_account_id,period_year,period_month",
        }
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/budgets/amounts error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
