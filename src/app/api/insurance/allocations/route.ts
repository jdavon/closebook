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
    case "get_allocations": {
      const { policyId } = body;

      const { data: allocations, error } = await admin
        .from("insurance_allocations")
        .select("*, entities!insurance_allocations_target_entity_id_fkey(name)")
        .eq("policy_id", policyId)
        .order("allocation_pct", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ allocations: allocations || [] });
    }

    case "upsert_allocation": {
      const { policyId, allocation } = body;

      const allocationPayload = {
        policy_id: policyId,
        target_entity_id: allocation.target_entity_id,
        allocation_method: allocation.allocation_method || "percentage",
        allocation_pct: allocation.allocation_pct ?? 0,
        allocated_amount: allocation.allocated_amount ?? 0,
        period_month: allocation.period_month ?? null,
        period_year: allocation.period_year ?? null,
        gl_account_id: allocation.gl_account_id || null,
        notes: allocation.notes || null,
      };

      let allocationId = allocation.id;

      if (allocationId) {
        const { error } = await admin
          .from("insurance_allocations")
          .update(allocationPayload)
          .eq("id", allocationId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_allocations")
          .insert(allocationPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        allocationId = data.id;
      }

      return NextResponse.json({ success: true, allocationId });
    }

    case "delete_allocation": {
      const { allocationId } = body;
      const { error } = await admin
        .from("insurance_allocations")
        .delete()
        .eq("id", allocationId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "calculate_allocations": {
      const { policyId } = body;

      // Fetch policy for total premium
      const { data: policy, error: polErr } = await admin
        .from("insurance_policies")
        .select("*")
        .eq("id", policyId)
        .single();

      if (polErr || !policy) {
        return NextResponse.json({ error: "Policy not found" }, { status: 404 });
      }

      // Fetch current allocations
      const { data: allocations, error: allocErr } = await admin
        .from("insurance_allocations")
        .select("*")
        .eq("policy_id", policyId);

      if (allocErr) return NextResponse.json({ error: allocErr.message }, { status: 500 });

      if (!allocations || allocations.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No allocations to calculate",
        });
      }

      const totalPremium = Number(policy.annual_premium) || 0;

      // Update each allocation with calculated amount
      for (const alloc of allocations) {
        const allocatedAmount =
          Math.round((Number(alloc.allocation_pct) / 100) * totalPremium * 100) / 100;
        await admin
          .from("insurance_allocations")
          .update({ allocated_amount: allocatedAmount })
          .eq("id", alloc.id);
      }

      // Return updated allocations
      const { data: refreshed } = await admin
        .from("insurance_allocations")
        .select("*, entities!insurance_allocations_target_entity_id_fkey(name)")
        .eq("policy_id", policyId)
        .order("allocation_pct", { ascending: false });

      return NextResponse.json({ success: true, allocations: refreshed || [] });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
