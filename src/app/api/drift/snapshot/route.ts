import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  // Protect: only callable from cron or with cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, year, months } = await request.json();

  if (!entityId || !year || !Array.isArray(months)) {
    return NextResponse.json(
      { error: "entityId, year, and months[] required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Get monitored accounts for this entity
  const { data: monitored } = await supabase
    .from("drift_monitored_accounts")
    .select("account_id")
    .eq("entity_id", entityId);

  if (!monitored || monitored.length === 0) {
    return NextResponse.json({ message: "No monitored accounts", snapshots: 0, alerts: 0 });
  }

  const accountIds = monitored.map((m) => m.account_id);
  let snapshotCount = 0;
  let alertCount = 0;

  for (const month of months) {
    // Get current GL balances for monitored accounts in this period
    const { data: balances } = await supabase
      .from("gl_balances")
      .select("account_id, ending_balance")
      .eq("entity_id", entityId)
      .eq("period_year", year)
      .eq("period_month", month)
      .in("account_id", accountIds);

    if (!balances || balances.length === 0) continue;

    // Get the most recent prior snapshot for comparison
    const { data: priorSnapshots } = await supabase
      .from("drift_snapshots")
      .select("account_id, ending_balance, snapshot_date")
      .eq("entity_id", entityId)
      .eq("period_year", year)
      .eq("period_month", month)
      .in("account_id", accountIds)
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false });

    // Build a map of most recent prior balance per account
    const priorMap = new Map<string, { balance: number; date: string }>();
    if (priorSnapshots) {
      for (const s of priorSnapshots) {
        if (!priorMap.has(s.account_id)) {
          priorMap.set(s.account_id, {
            balance: Number(s.ending_balance),
            date: s.snapshot_date,
          });
        }
      }
    }

    // Upsert today's snapshots
    const snapshotRows = balances.map((b) => ({
      entity_id: entityId,
      account_id: b.account_id,
      period_year: year,
      period_month: month,
      ending_balance: b.ending_balance,
      snapshot_date: today,
    }));

    const { error: snapErr } = await supabase
      .from("drift_snapshots")
      .upsert(snapshotRows, {
        onConflict: "entity_id,account_id,period_year,period_month,snapshot_date",
      });

    if (!snapErr) {
      snapshotCount += snapshotRows.length;
    }

    // Compare and generate alerts for drifted balances
    const alertRows: {
      entity_id: string;
      account_id: string;
      period_year: number;
      period_month: number;
      previous_balance: number;
      current_balance: number;
      drift_amount: number;
      snapshot_date: string;
      previous_snapshot_date: string;
    }[] = [];

    for (const b of balances) {
      const prior = priorMap.get(b.account_id);
      if (!prior) continue; // No prior snapshot to compare against

      const currentBal = Number(b.ending_balance);
      const priorBal = prior.balance;

      if (currentBal !== priorBal) {
        alertRows.push({
          entity_id: entityId,
          account_id: b.account_id,
          period_year: year,
          period_month: month,
          previous_balance: priorBal,
          current_balance: currentBal,
          drift_amount: currentBal - priorBal,
          snapshot_date: today,
          previous_snapshot_date: prior.date,
        });
      }
    }

    if (alertRows.length > 0) {
      const { error: alertErr } = await supabase
        .from("drift_alerts")
        .insert(alertRows);

      if (!alertErr) {
        alertCount += alertRows.length;
      }
    }
  }

  return NextResponse.json({
    success: true,
    snapshots: snapshotCount,
    alerts: alertCount,
  });
}
