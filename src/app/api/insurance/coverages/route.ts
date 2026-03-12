import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;
  const admin = createAdminClient();

  switch (action) {
    case "get_coverages": {
      const { policyId } = body;

      const { data: coverages, error } = await admin
        .from("insurance_coverages")
        .select("*")
        .eq("policy_id", policyId)
        .order("sort_order");

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ coverages: coverages || [] });
    }

    case "upsert_coverage": {
      const { policyId, coverage } = body;

      const coveragePayload = {
        policy_id: policyId,
        coverage_name: coverage.coverage_name,
        coverage_form: coverage.coverage_form || "occurrence",
        limit_per_occurrence: coverage.limit_per_occurrence ?? null,
        limit_aggregate: coverage.limit_aggregate ?? null,
        limit_description: coverage.limit_description || null,
        deductible: coverage.deductible ?? null,
        deductible_description: coverage.deductible_description || null,
        self_insured_retention: coverage.self_insured_retention ?? null,
        coinsurance_pct: coverage.coinsurance_pct ?? null,
        sub_limit: coverage.sub_limit ?? null,
        sub_limit_description: coverage.sub_limit_description || null,
        is_included: coverage.is_included ?? true,
        prior_year_limit: coverage.prior_year_limit ?? null,
        prior_year_deductible: coverage.prior_year_deductible ?? null,
        sort_order: coverage.sort_order ?? 0,
        notes: coverage.notes || null,
      };

      let coverageId = coverage.id;

      if (coverageId) {
        const { error } = await admin
          .from("insurance_coverages")
          .update(coveragePayload)
          .eq("id", coverageId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_coverages")
          .insert(coveragePayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        coverageId = data.id;
      }

      return NextResponse.json({ success: true, coverageId });
    }

    case "delete_coverage": {
      const { coverageId } = body;
      const { error } = await admin
        .from("insurance_coverages")
        .delete()
        .eq("id", coverageId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "bulk_upsert_coverages": {
      const { policyId, coverages } = body;

      // Delete existing coverages for this policy
      await admin
        .from("insurance_coverages")
        .delete()
        .eq("policy_id", policyId);

      // Insert new coverages
      if (coverages && coverages.length > 0) {
        const coverageRows = coverages.map(
          (c: Record<string, unknown>, idx: number) => ({
            policy_id: policyId,
            coverage_name: c.coverage_name as string,
            coverage_form: (c.coverage_form as string) || "occurrence",
            limit_per_occurrence: c.limit_per_occurrence ?? null,
            limit_aggregate: c.limit_aggregate ?? null,
            limit_description: c.limit_description || null,
            deductible: c.deductible ?? null,
            deductible_description: c.deductible_description || null,
            self_insured_retention: c.self_insured_retention ?? null,
            coinsurance_pct: c.coinsurance_pct ?? null,
            sub_limit: c.sub_limit ?? null,
            sub_limit_description: c.sub_limit_description || null,
            is_included: c.is_included ?? true,
            prior_year_limit: c.prior_year_limit ?? null,
            prior_year_deductible: c.prior_year_deductible ?? null,
            sort_order: idx,
            notes: c.notes || null,
          }),
        );

        const { error } = await admin.from("insurance_coverages").insert(coverageRows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
