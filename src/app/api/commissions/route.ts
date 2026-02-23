import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Fetch profiles for this entity
  const { data: profiles, error: profilesError } = await adminClient
    .from("commission_profiles")
    .select("*")
    .eq("entity_id", entityId)
    .order("name");

  if (profilesError) {
    return NextResponse.json(
      { error: profilesError.message },
      { status: 500 }
    );
  }

  // Fetch assignments for all profiles with account details
  const profileIds = (profiles ?? []).map((p: { id: string }) => p.id);

  let assignments: Record<string, unknown[]> = {};
  if (profileIds.length > 0) {
    const { data: allAssignments } = await adminClient
      .from("commission_account_assignments")
      .select(
        "id, commission_profile_id, account_id, role, qbo_class_id, accounts(name, account_number, classification, account_type), qbo_classes(name)"
      )
      .in("commission_profile_id", profileIds);

    // Group by profile
    for (const a of allAssignments ?? []) {
      const pid = (a as { commission_profile_id: string })
        .commission_profile_id;
      if (!assignments[pid]) assignments[pid] = [];
      assignments[pid].push(a);
    }
  }

  return NextResponse.json({
    profiles: profiles ?? [],
    assignments,
  });
}

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
  const adminClient = createAdminClient();

  // ── Upsert Profile ──────────────────────────────────────────────────
  if (action === "upsert_profile") {
    const { entityId, profile } = body;

    if (!entityId || !profile?.name || profile.commission_rate == null) {
      return NextResponse.json(
        { error: "entityId, profile.name, and profile.commission_rate are required" },
        { status: 400 }
      );
    }

    const profileData = {
      entity_id: entityId,
      name: profile.name.trim(),
      commission_rate: profile.commission_rate,
      is_active: profile.is_active ?? true,
      notes: profile.notes || null,
      created_by: user.id,
    };

    let profileId: string;

    if (profile.id) {
      // Update existing
      const { error: updateError } = await adminClient
        .from("commission_profiles")
        .update({
          name: profileData.name,
          commission_rate: profileData.commission_rate,
          is_active: profileData.is_active,
          notes: profileData.notes,
        })
        .eq("id", profile.id);

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }
      profileId = profile.id;
    } else {
      // Insert new
      const { data: newProfile, error: insertError } = await adminClient
        .from("commission_profiles")
        .insert(profileData)
        .select("id")
        .single();

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
      profileId = newProfile.id;
    }

    // Replace account assignments: delete old, insert new
    await adminClient
      .from("commission_account_assignments")
      .delete()
      .eq("commission_profile_id", profileId);

    if (profile.assignments?.length > 0) {
      const assignmentRows = profile.assignments.map(
        (a: { account_id: string; role: string; qbo_class_id?: string | null }) => ({
          commission_profile_id: profileId,
          account_id: a.account_id,
          role: a.role,
          qbo_class_id: a.qbo_class_id || null,
        })
      );

      const { error: assignError } = await adminClient
        .from("commission_account_assignments")
        .insert(assignmentRows);

      if (assignError) {
        return NextResponse.json(
          { error: assignError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, profileId });
  }

  // ── Calculate Commissions ───────────────────────────────────────────
  if (action === "calculate") {
    const { entityId, periodYear, periodMonth, profileIds } = body;

    if (!entityId || !periodYear || !periodMonth) {
      return NextResponse.json(
        { error: "entityId, periodYear, and periodMonth are required" },
        { status: 400 }
      );
    }

    // Get profiles to calculate
    let query = adminClient
      .from("commission_profiles")
      .select("*")
      .eq("entity_id", entityId)
      .eq("is_active", true);

    if (profileIds?.length > 0) {
      query = query.in("id", profileIds);
    }

    const { data: profiles } = await query;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({
        success: true,
        results: [],
        message: "No active profiles found",
      });
    }

    const results = [];

    for (const profile of profiles) {
      // Get assignments (with optional class filter)
      const { data: assignments } = await adminClient
        .from("commission_account_assignments")
        .select("account_id, role, qbo_class_id")
        .eq("commission_profile_id", profile.id);

      let totalRevenue = 0;
      let totalExpenses = 0;

      for (const assignment of assignments ?? []) {
        const a = assignment as { account_id: string; role: string; qbo_class_id: string | null };
        let netChange = 0;

        if (a.qbo_class_id) {
          // Class-specific: query gl_class_balances
          const { data: classBalance } = await adminClient
            .from("gl_class_balances")
            .select("net_change")
            .eq("entity_id", entityId)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .eq("account_id", a.account_id)
            .eq("qbo_class_id", a.qbo_class_id)
            .maybeSingle();

          netChange = Number(classBalance?.net_change ?? 0);
        } else {
          // No class filter: use full gl_balances (existing behavior)
          const { data: balance } = await adminClient
            .from("gl_balances")
            .select("net_change")
            .eq("entity_id", entityId)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .eq("account_id", a.account_id)
            .maybeSingle();

          netChange = Number(balance?.net_change ?? 0);
        }

        if (a.role === "revenue") {
          totalRevenue += netChange * -1; // Negate credits
        } else {
          totalExpenses += netChange;
        }
      }

      const commissionBase = totalRevenue - totalExpenses;
      const commissionEarned = commissionBase * Number(profile.commission_rate);

      // Upsert result
      await adminClient.from("commission_results").upsert(
        {
          commission_profile_id: profile.id,
          entity_id: entityId,
          period_year: periodYear,
          period_month: periodMonth,
          total_revenue: totalRevenue,
          total_expenses: totalExpenses,
          commission_base: commissionBase,
          commission_rate: profile.commission_rate,
          commission_earned: commissionEarned,
          calculated_at: new Date().toISOString(),
        },
        {
          onConflict: "commission_profile_id,period_year,period_month",
        }
      );

      results.push({
        profileId: profile.id,
        profileName: profile.name,
        totalRevenue,
        totalExpenses,
        commissionBase,
        commissionRate: Number(profile.commission_rate),
        commissionEarned,
      });
    }

    return NextResponse.json({ success: true, results });
  }

  // ── Mark as Payable ─────────────────────────────────────────────────
  if (action === "mark_payable") {
    const { resultId, isPayable } = body;

    if (!resultId || isPayable == null) {
      return NextResponse.json(
        { error: "resultId and isPayable are required" },
        { status: 400 }
      );
    }

    const { error: updateError } = await adminClient
      .from("commission_results")
      .update({
        is_payable: isPayable,
        marked_payable_at: isPayable ? new Date().toISOString() : null,
        marked_payable_by: isPayable ? user.id : null,
      })
      .eq("id", resultId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  }

  // ── Delete Profile ──────────────────────────────────────────────────
  if (action === "delete_profile") {
    const { profileId } = body;

    if (!profileId) {
      return NextResponse.json(
        { error: "profileId is required" },
        { status: 400 }
      );
    }

    const { error: deleteError } = await adminClient
      .from("commission_profiles")
      .delete()
      .eq("id", profileId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
