import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

// ---------------------------------------------------------------------------
// GET /api/close/task-source-status?taskId=
// Returns live reconciliation status from the source module for a task
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // Load the task with its period
  const { data: task } = await supabase
    .from("close_tasks")
    .select("*, close_periods(*)")
    .eq("id", taskId)
    .single();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.source_module) {
    return NextResponse.json({ status: null, message: "No source module" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const period = task.close_periods as any;
  const entityId = period.entity_id;
  const periodYear = period.period_year;
  const periodMonth = period.period_month;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  try {
    switch (task.source_module) {
      // ----- Debt -----
      case "debt": {
        const { data: recons } = await admin
          .from("debt_reconciliations")
          .select("*")
          .eq("entity_id", entityId)
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth);

        return NextResponse.json({
          sourceModule: "debt",
          data: {
            reconciliations: (recons ?? []).map((r: any) => ({
              glAccountGroup: r.gl_account_group,
              glBalance: r.gl_balance,
              subledgerBalance: r.subledger_balance,
              variance: r.variance,
              isReconciled: r.is_reconciled,
            })),
            allReconciled: (recons ?? []).every((r: any) => r.is_reconciled),
          },
        });
      }

      // ----- Assets -----
      case "assets": {
        const { data: recons } = await admin
          .from("asset_reconciliations")
          .select("*")
          .eq("entity_id", entityId)
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth);

        return NextResponse.json({
          sourceModule: "assets",
          data: {
            reconciliations: (recons ?? []).map((r: any) => ({
              glAccountGroup: r.gl_account_group,
              glBalance: r.gl_balance,
              subledgerBalance: r.subledger_balance,
              variance: r.variance,
              isReconciled: r.is_reconciled,
            })),
            allReconciled: (recons ?? []).every((r: any) => r.is_reconciled),
          },
        });
      }

      // ----- Leases -----
      case "leases": {
        if (task.source_record_id) {
          const { data: lease } = await admin
            .from("leases")
            .select("id, lease_name, status, lease_type")
            .eq("id", task.source_record_id)
            .single();

          return NextResponse.json({
            sourceModule: "leases",
            data: {
              lease: lease
                ? {
                    id: lease.id,
                    leaseName: lease.lease_name,
                    status: lease.status,
                    leaseType: lease.lease_type,
                  }
                : null,
            },
          });
        }
        return NextResponse.json({
          sourceModule: "leases",
          data: { lease: null },
        });
      }

      // ----- Payroll -----
      case "payroll": {
        return NextResponse.json({
          sourceModule: "payroll",
          data: {
            message: "Manual verification required — review payroll accrual entries",
          },
        });
      }

      // ----- Intercompany -----
      case "intercompany": {
        // Get org entities
        const { data: membership } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", user.id)
          .single();

        const { data: entities } = await admin
          .from("entities")
          .select("id, name")
          .eq("organization_id", membership?.organization_id ?? "")
          .eq("is_active", true);

        if (!entities || entities.length <= 1) {
          return NextResponse.json({
            sourceModule: "intercompany",
            data: { entityCount: entities?.length ?? 0, status: "skipped" },
          });
        }

        const entityIds = entities.map((e: { id: string }) => e.id);
        const { data: icAccounts } = await admin
          .from("accounts")
          .select("id, entity_id, name")
          .in("entity_id", entityIds)
          .eq("is_active", true)
          .or("name.ilike.%due from%,name.ilike.%due to%,name.ilike.%intercompany%");

        if (!icAccounts || icAccounts.length === 0) {
          return NextResponse.json({
            sourceModule: "intercompany",
            data: { icAccountCount: 0, status: "no_ic_accounts" },
          });
        }

        const icAccountIds = icAccounts.map((a: { id: string }) => a.id);
        const icBalances = await fetchAllPaginated<{
          ending_balance: number;
        }>((offset, limit) =>
          admin
            .from("gl_balances")
            .select("ending_balance")
            .in("account_id", icAccountIds)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .range(offset, offset + limit - 1)
        );

        let netBalance = 0;
        for (const row of icBalances) {
          netBalance += Number(row.ending_balance ?? 0);
        }
        netBalance = Math.round(netBalance * 100) / 100;

        return NextResponse.json({
          sourceModule: "intercompany",
          data: {
            netBalance,
            isNetZero: Math.abs(netBalance) < 0.01,
            icAccountCount: icAccounts.length,
          },
        });
      }

      // ----- Trial Balance -----
      case "tb": {
        const glBalances = await fetchAllPaginated<{
          debit_total: number;
          credit_total: number;
        }>((offset, limit) =>
          admin
            .from("gl_balances")
            .select("debit_total, credit_total, account_id, accounts!inner(id)")
            .eq("entity_id", entityId)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .range(offset, offset + limit - 1)
        );

        let totalDebits = 0;
        let totalCredits = 0;
        for (const row of glBalances) {
          totalDebits += Number(row.debit_total ?? 0);
          totalCredits += Number(row.credit_total ?? 0);
        }

        const variance =
          Math.round((totalDebits - totalCredits) * 100) / 100;

        // Check for unmatched rows
        const { count: unmatchedCount } = await admin
          .from("tb_unmatched_rows")
          .select("id", { count: "exact", head: true })
          .eq("entity_id", entityId)
          .eq("period_year", periodYear)
          .eq("period_month", periodMonth)
          .is("resolved_account_id", null);

        return NextResponse.json({
          sourceModule: "tb",
          data: {
            totalDebits: Math.round(totalDebits * 100) / 100,
            totalCredits: Math.round(totalCredits * 100) / 100,
            variance,
            isBalanced: Math.abs(variance) < 0.01,
            unmatchedCount: unmatchedCount ?? 0,
            accountCount: glBalances.length,
          },
        });
      }

      // ----- Financial Statements -----
      case "financial_statements": {
        const glBalances = await fetchAllPaginated<{
          ending_balance: number;
          accounts: { classification: string };
        }>((offset, limit) =>
          admin
            .from("gl_balances")
            .select("ending_balance, accounts!inner(id, classification)")
            .eq("entity_id", entityId)
            .eq("period_year", periodYear)
            .eq("period_month", periodMonth)
            .range(offset, offset + limit - 1)
        );

        let totalAssets = 0;
        let totalLiabilities = 0;
        let totalEquity = 0;

        for (const row of glBalances) {
          const bal = Number(row.ending_balance ?? 0);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const classification = (row as any).accounts?.classification;
          if (classification === "Asset") totalAssets += bal;
          else if (classification === "Liability") totalLiabilities += bal;
          else if (classification === "Equity") totalEquity += bal;
        }

        const bsDifference = Math.round(
          (totalAssets - totalLiabilities - totalEquity) * 100
        ) / 100;

        return NextResponse.json({
          sourceModule: "financial_statements",
          data: {
            totalAssets: Math.round(totalAssets * 100) / 100,
            totalLiabilities: Math.round(totalLiabilities * 100) / 100,
            totalEquity: Math.round(totalEquity * 100) / 100,
            bsDifference,
            isBalanced: Math.abs(bsDifference) < 0.01,
          },
        });
      }

      default:
        return NextResponse.json({
          sourceModule: task.source_module,
          data: null,
        });
    }
  } catch (err) {
    console.error("Task source status error:", err);
    return NextResponse.json(
      { error: "Failed to fetch source status" },
      { status: 500 }
    );
  }
}
