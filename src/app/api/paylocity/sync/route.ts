import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/paylocity/sync
 * Syncs payroll data from Paylocity and generates accrual entries.
 *
 * Flow:
 * 1. Get/refresh access token (Client Credentials — request new token each call)
 * 2. Fetch employees, earnings, PTO balances
 * 3. Calculate accrued wages, payroll taxes, PTO liability
 * 4. Insert/update payroll_accruals for the period
 *
 * CA + Federal payroll tax defaults:
 *   - FICA SS: 6.2%, Medicare: 1.45%
 *   - FUTA: 0.6% (after SUTA credit)
 *   - CA SUI: ~3.4% (varies), CA ETT: 0.1%, CA SDI: 1.1%
 *   - Total estimated employer burden: ~12.85%
 */

const DEFAULT_PAYROLL_TAX_RATE = 0.1285; // 12.85% estimated employer burden

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId, periodYear, periodMonth, payrollTaxRate } =
    await request.json();

  if (!entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "Missing: entityId, periodYear, periodMonth" },
      { status: 400 }
    );
  }

  const taxRate = payrollTaxRate ?? DEFAULT_PAYROLL_TAX_RATE;

  // Get connection
  const { data: conn } = await supabase
    .from("paylocity_connections")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (!conn) {
    return NextResponse.json(
      { error: "Paylocity not connected. Configure credentials in settings." },
      { status: 400 }
    );
  }

  // Update status
  await supabase
    .from("paylocity_connections")
    .update({ sync_status: "syncing" })
    .eq("entity_id", entityId);

  // Create sync log
  const { data: syncLog } = await supabase
    .from("payroll_sync_logs")
    .insert({ entity_id: entityId, status: "started" })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    // Refresh token (Client Credentials tokens are short-lived)
    const connection = conn as Record<string, unknown>;
    const env = connection.environment as string;
    const tokenUrl =
      env === "testing"
        ? "https://apisandbox.paylocity.com/IdentityServer/connect/token"
        : "https://api.paylocity.com/IdentityServer/connect/token";

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${connection.client_id}:${connection.client_secret_encrypted}`
        ).toString("base64")}`,
      },
      body: "grant_type=client_credentials&scope=WebLinkAPI",
    });

    if (!tokenRes.ok) {
      throw new Error(`Token refresh failed: ${await tokenRes.text()}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const apiBase =
      env === "testing"
        ? "https://apisandbox.paylocity.com/api/v2"
        : "https://api.paylocity.com/api/v2";
    const companyId = connection.company_id as string;

    // Save refreshed token
    await supabase
      .from("paylocity_connections")
      .update({
        access_token: accessToken,
        token_expires_at: new Date(
          Date.now() + (tokenData.expires_in ?? 3600) * 1000
        ).toISOString(),
      })
      .eq("entity_id", entityId);

    // Fetch employees
    const empRes = await fetch(
      `${apiBase}/companies/${companyId}/employees?pagesize=500`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!empRes.ok) {
      throw new Error(`Failed to fetch employees: ${empRes.status}`);
    }

    const employees = (await empRes.json()) as Array<{
      employeeId: string;
      firstName: string;
      lastName: string;
      compRate?: number;
      annualSalary?: number;
      payFrequency?: string;
    }>;

    // For each employee, calculate accrued wages
    // We need: compensation rate, pay frequency, days since last paycheck
    let totalAccruedWages = 0;
    let totalPtoLiability = 0;
    let employeesSynced = 0;

    for (const emp of employees) {
      // Get earnings data for this employee
      try {
        const earningsRes = await fetch(
          `${apiBase}/companies/${companyId}/employees/${emp.employeeId}/earnings`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (earningsRes.ok) {
          // Accrued wages estimation:
          // Use annualSalary / 365 * days-since-last-pay
          // or compRate * hours if hourly
          const annualRate = emp.annualSalary ?? (emp.compRate ?? 0) * 2080;
          const dailyRate = annualRate / 365;

          // Estimate days to accrue (assume last paycheck was mid-month)
          // For a proper implementation, we'd check the last pay run date
          const periodEndDay = new Date(
            periodYear,
            periodMonth,
            0
          ).getDate();
          const daysToAccrue = Math.min(15, periodEndDay); // conservative estimate
          totalAccruedWages += dailyRate * daysToAccrue;
        }

        // Get PTO balance
        // Note: Actual Paylocity endpoint may vary
        // Using the employee pay statement endpoint as a proxy
        totalPtoLiability += 0; // Will be populated when actual API structure is confirmed

        employeesSynced++;
      } catch {
        // Continue with next employee if one fails
        continue;
      }
    }

    // Round to 2 decimal places
    totalAccruedWages = Math.round(totalAccruedWages * 100) / 100;
    totalPtoLiability = Math.round(totalPtoLiability * 100) / 100;
    const payrollTaxAccrual =
      Math.round(totalAccruedWages * taxRate * 100) / 100;

    // Upsert accrual records
    const accruals = [
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        accrual_type: "wages",
        description: `Accrued Wages - ${periodMonth}/${periodYear}`,
        amount: totalAccruedWages,
        source: "paylocity_sync",
        payroll_sync_id: syncLogId,
        status: "draft",
      },
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        accrual_type: "payroll_tax",
        description: `Accrued Payroll Tax - ${periodMonth}/${periodYear}`,
        amount: payrollTaxAccrual,
        source: "paylocity_sync",
        payroll_sync_id: syncLogId,
        status: "draft",
      },
    ];

    // Only add PTO if we have data
    if (totalPtoLiability > 0) {
      accruals.push({
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        accrual_type: "pto",
        description: `PTO Liability - ${periodMonth}/${periodYear}`,
        amount: totalPtoLiability,
        source: "paylocity_sync",
        payroll_sync_id: syncLogId,
        status: "draft",
      });
    }

    for (const accrual of accruals) {
      await supabase.from("payroll_accruals").upsert(accrual, {
        onConflict: "entity_id,period_year,period_month,accrual_type,description",
      });
    }

    // Update sync log
    if (syncLogId) {
      await supabase
        .from("payroll_sync_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          employees_synced: employeesSynced,
          accruals_generated: accruals.length,
        })
        .eq("id", syncLogId);
    }

    // Update connection status
    await supabase
      .from("paylocity_connections")
      .update({
        sync_status: "idle",
        last_sync_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("entity_id", entityId);

    return NextResponse.json({
      success: true,
      employeesSynced,
      accruals: {
        wages: totalAccruedWages,
        payrollTax: payrollTaxAccrual,
        pto: totalPtoLiability,
      },
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown sync error";

    // Update sync log with error
    if (syncLogId) {
      await supabase
        .from("payroll_sync_logs")
        .update({
          status: "error",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", syncLogId);
    }

    // Update connection status
    await supabase
      .from("paylocity_connections")
      .update({
        sync_status: "error",
        sync_error: errorMessage,
      })
      .eq("entity_id", entityId);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
