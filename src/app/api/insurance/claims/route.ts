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
    case "get_claims": {
      const { policyId, entityId } = body;

      let query = admin
        .from("insurance_claims")
        .select("*, insurance_policies(policy_number, policy_type)")
        .order("date_of_loss", { ascending: false });

      if (policyId) {
        query = query.eq("policy_id", policyId);
      } else if (entityId) {
        query = query.eq("entity_id", entityId);
      } else {
        return NextResponse.json(
          { error: "Either policyId or entityId is required" },
          { status: 400 },
        );
      }

      const { data: claims, error } = await query;

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ claims: claims || [] });
    }

    case "upsert_claim": {
      const { claim } = body;

      const claimPayload = {
        policy_id: claim.policy_id,
        entity_id: claim.entity_id,
        claim_number: claim.claim_number || null,
        status: claim.status || "open",
        date_of_loss: claim.date_of_loss || null,
        date_reported: claim.date_reported || null,
        claimant_name: claim.claimant_name || null,
        description: claim.description || null,
        amount_reserved: claim.amount_reserved ?? 0,
        amount_paid: claim.amount_paid ?? 0,
        amount_recovered: claim.amount_recovered ?? 0,
        adjuster_name: claim.adjuster_name || null,
        adjuster_contact: claim.adjuster_contact || null,
        location_id: claim.location_id || null,
        notes: claim.notes || null,
      };

      let claimId = claim.id;

      if (claimId) {
        const { error } = await admin
          .from("insurance_claims")
          .update(claimPayload)
          .eq("id", claimId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_claims")
          .insert(claimPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        claimId = data.id;
      }

      return NextResponse.json({ success: true, claimId });
    }

    case "get_claim_summary": {
      const { entityId } = body;

      const { data: claims, error } = await admin
        .from("insurance_claims")
        .select("status, amount_reserved, amount_paid, amount_recovered")
        .eq("entity_id", entityId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const allClaims = claims || [];
      const openClaims = allClaims.filter((c) => c.status === "open");
      const closedClaims = allClaims.filter((c) => c.status === "closed");

      const totalReserved = allClaims.reduce(
        (sum, c) => sum + (Number(c.amount_reserved) || 0),
        0,
      );
      const totalPaid = allClaims.reduce(
        (sum, c) => sum + (Number(c.amount_paid) || 0),
        0,
      );
      const totalRecovered = allClaims.reduce(
        (sum, c) => sum + (Number(c.amount_recovered) || 0),
        0,
      );

      return NextResponse.json({
        summary: {
          total_claims: allClaims.length,
          open_claims: openClaims.length,
          closed_claims: closedClaims.length,
          total_reserved: totalReserved,
          total_paid: totalPaid,
          total_recovered: totalRecovered,
          net_incurred: totalPaid - totalRecovered,
        },
      });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
