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
        "id, commission_profile_id, account_id, role, class_filter_mode, qbo_class_ids, accounts(name, account_number, classification, account_type)"
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
        (a: {
          account_id: string;
          role: string;
          class_filter_mode?: string;
          qbo_class_ids?: string[];
        }) => ({
          commission_profile_id: profileId,
          account_id: a.account_id,
          role: a.role,
          class_filter_mode: a.class_filter_mode || "all",
          qbo_class_ids: a.qbo_class_ids ?? [],
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

    // Compute prior month for standalone derivation.
    // QBO trial balance stores cumulative YTD in ending_balance/net_change
    // for P&L accounts. We subtract the prior month to get monthly-only activity.
    const pm = periodMonth === 1 ? 12 : periodMonth - 1;
    const py = periodMonth === 1 ? periodYear - 1 : periodYear;
    const isFiscalYearStart = periodMonth === 1; // Assumes calendar fiscal year

    const results = [];
    const warnings: string[] = [];

    // ── Batch-fetch GL data for current AND prior months ──────────────
    // This avoids N+1 queries per assignment and makes diagnostics easy.

    // Current month gl_balances
    const { data: currentGlRows, error: currentGlErr } = await adminClient
      .from("gl_balances")
      .select("account_id, ending_balance")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    if (currentGlErr) {
      console.error("Failed to fetch current GL balances:", currentGlErr);
    }

    const currentGlMap: Record<string, number> = {};
    for (const row of currentGlRows ?? []) {
      currentGlMap[row.account_id] = Number(row.ending_balance ?? 0);
    }

    // Prior month gl_balances (needed for standalone derivation)
    const priorGlMap: Record<string, number> = {};
    let priorGlCount = 0;
    if (!isFiscalYearStart) {
      const { data: priorGlRows, error: priorGlErr } = await adminClient
        .from("gl_balances")
        .select("account_id, ending_balance")
        .eq("entity_id", entityId)
        .eq("period_year", py)
        .eq("period_month", pm);

      if (priorGlErr) {
        console.error("Failed to fetch prior GL balances:", priorGlErr);
      }

      for (const row of priorGlRows ?? []) {
        priorGlMap[row.account_id] = Number(row.ending_balance ?? 0);
      }
      priorGlCount = Object.keys(priorGlMap).length;

      if (priorGlCount === 0 && (currentGlRows?.length ?? 0) > 0) {
        warnings.push(
          `No GL data found for prior month ${py}-${String(pm).padStart(2, "0")}. ` +
          `Standalone monthly amounts cannot be derived — values may show cumulative YTD. ` +
          `Sync ${py}-${String(pm).padStart(2, "0")} from QBO first.`
        );
      }
    }

    // Current month gl_class_balances
    // NOTE: gl_class_balances.net_change comes from the QBO P&L by Class report,
    // which returns activity for the specified date range (standalone monthly),
    // NOT cumulative YTD like the Trial Balance.
    const { data: currentClassRows } = await adminClient
      .from("gl_class_balances")
      .select("account_id, qbo_class_id, net_change")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth);

    const currentClassMap: Record<string, number> = {};
    for (const row of currentClassRows ?? []) {
      currentClassMap[`${row.account_id}__${row.qbo_class_id}`] = Number(row.net_change ?? 0);
    }

    for (const profile of profiles) {
      // Get assignments (with class filter mode)
      const { data: assignments } = await adminClient
        .from("commission_account_assignments")
        .select("account_id, role, class_filter_mode, qbo_class_ids")
        .eq("commission_profile_id", profile.id);

      let totalRevenue = 0;
      let totalExpenses = 0;

      for (const assignment of assignments ?? []) {
        const raw = assignment as {
          account_id: string;
          role: string;
          class_filter_mode: string;
          qbo_class_ids: string[] | null;
        };
        const a = {
          ...raw,
          class_filter_mode: raw.class_filter_mode ?? "all",
          qbo_class_ids: raw.qbo_class_ids ?? [],
        };
        let netChange = 0;

        if (a.class_filter_mode === "include" && a.qbo_class_ids.length > 0) {
          // Include mode: sum gl_class_balances for selected classes.
          // gl_class_balances.net_change is already standalone monthly
          // (from P&L by Class report), so use directly — no prior subtraction.
          netChange = a.qbo_class_ids.reduce(
            (sum, cid) => sum + (currentClassMap[`${a.account_id}__${cid}`] ?? 0),
            0
          );
        } else if (a.class_filter_mode === "exclude" && a.qbo_class_ids.length > 0) {
          // Exclude mode: standalone total minus excluded class balances.
          // gl_balances is cumulative YTD → derive standalone via prior subtraction.
          // gl_class_balances is already standalone → use directly.
          const currentEnding = currentGlMap[a.account_id] ?? 0;
          const priorEnding = priorGlMap[a.account_id] ?? 0;
          const totalStandalone = isFiscalYearStart
            ? currentEnding
            : currentEnding - priorEnding;

          const excludedStandalone = a.qbo_class_ids.reduce(
            (sum, cid) => sum + (currentClassMap[`${a.account_id}__${cid}`] ?? 0),
            0
          );

          // Warn if class data is missing — exclude filter has no effect
          if (excludedStandalone === 0 && a.qbo_class_ids.length > 0) {
            const classNames = a.qbo_class_ids.join(", ");
            warnings.push(
              `${profile.name}: No class-level GL data found for account ${a.account_id} — exclude filter for class(es) [${classNames}] had no effect. Sync P&L by Class from QBO.`
            );
          }

          netChange = totalStandalone - excludedStandalone;
        } else {
          // All classes: derive standalone from ending_balance delta.
          // gl_balances stores cumulative YTD for P&L accounts.
          const currentEnding = currentGlMap[a.account_id] ?? 0;

          if (isFiscalYearStart) {
            netChange = currentEnding;
          } else {
            const priorEnding = priorGlMap[a.account_id] ?? 0;
            netChange = currentEnding - priorEnding;
          }
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

    return NextResponse.json({
      success: true,
      results,
      diagnostics: {
        currentMonth: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
        priorMonth: isFiscalYearStart ? "(fiscal year start)" : `${py}-${String(pm).padStart(2, "0")}`,
        currentGlAccounts: Object.keys(currentGlMap).length,
        priorGlAccounts: priorGlCount,
        currentClassEntries: Object.keys(currentClassMap).length,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    });
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

  // ── Diagnose Class Data ────────────────────────────────────────────
  if (action === "diagnose_class_data") {
    const { entityId, periodYear, periodMonth } = body;

    if (!entityId || !periodYear || !periodMonth) {
      return NextResponse.json(
        { error: "entityId, periodYear, and periodMonth are required" },
        { status: 400 }
      );
    }

    // 1. Check qbo_classes for this entity
    const { data: classes, error: classErr } = await adminClient
      .from("qbo_classes")
      .select("id, name, fully_qualified_name, is_active")
      .eq("entity_id", entityId);

    // 2. Check gl_class_balances for this entity/period
    const { data: classBalances, error: cbErr } = await adminClient
      .from("gl_class_balances")
      .select("id, account_id, qbo_class_id, net_change")
      .eq("entity_id", entityId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .limit(20);

    // 3. Check gl_class_balances for ANY period (to see if data exists at all)
    const { data: anyClassBalances } = await adminClient
      .from("gl_class_balances")
      .select("period_year, period_month")
      .eq("entity_id", entityId)
      .limit(5);

    // 4. Check commission assignments with class filters
    const { data: profiles } = await adminClient
      .from("commission_profiles")
      .select("id, name")
      .eq("entity_id", entityId);

    const profileIds = (profiles ?? []).map((p: { id: string }) => p.id);
    let classFilterAssignments: unknown[] = [];
    if (profileIds.length > 0) {
      const { data: assignments } = await adminClient
        .from("commission_account_assignments")
        .select("id, account_id, class_filter_mode, qbo_class_ids")
        .in("commission_profile_id", profileIds)
        .neq("class_filter_mode", "all");
      classFilterAssignments = assignments ?? [];
    }

    return NextResponse.json({
      qbo_classes: {
        count: classes?.length ?? 0,
        error: classErr?.message ?? null,
        items: (classes ?? []).map((c: { id: string; name: string; fully_qualified_name: string | null; is_active: boolean }) => ({
          id: c.id,
          name: c.name,
          fqn: c.fully_qualified_name,
          active: c.is_active,
        })),
      },
      gl_class_balances_for_period: {
        count: classBalances?.length ?? 0,
        error: cbErr?.message ?? null,
        sample: (classBalances ?? []).slice(0, 5),
      },
      gl_class_balances_any_period: {
        periods: (anyClassBalances ?? []).map((r: { period_year: number; period_month: number }) => `${r.period_year}-${String(r.period_month).padStart(2, "0")}`),
      },
      class_filter_assignments: classFilterAssignments,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
