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
    case "get_schedule": {
      const { policyId } = body;

      const { data: payments, error } = await admin
        .from("insurance_payment_schedules")
        .select("*")
        .eq("policy_id", policyId)
        .order("period_year")
        .order("period_month");

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ payments: payments || [] });
    }

    case "generate_schedule": {
      const { policyId } = body;

      // Fetch the policy to get premium and schedule details
      const { data: policy, error: polErr } = await admin
        .from("insurance_policies")
        .select("*")
        .eq("id", policyId)
        .single();

      if (polErr || !policy) {
        return NextResponse.json({ error: "Policy not found" }, { status: 404 });
      }

      const { generatePaymentSchedule } = await import(
        "@/lib/utils/insurance-calculations"
      );
      if (!policy.effective_date || !policy.expiration_date) {
        return NextResponse.json({ error: "Policy must have effective and expiration dates" }, { status: 400 });
      }

      const schedule = generatePaymentSchedule({
        id: policyId,
        policy_type: policy.policy_type,
        annual_premium: Number(policy.annual_premium) || 0,
        prior_year_premium: Number(policy.prior_year_premium) || 0,
        effective_date: policy.effective_date as string,
        expiration_date: policy.expiration_date as string,
        payment_terms: policy.payment_terms || "annual",
        installment_description: policy.installment_description ?? undefined,
        is_auditable: policy.is_auditable ?? false,
        status: policy.status,
      }).map((entry) => ({
        policy_id: policyId,
        period_month: entry.period_month,
        period_year: entry.period_year,
        due_date: entry.due_date,
        amount_due: entry.amount_due,
        payment_status: "scheduled" as const,
        is_estimate: entry.is_estimate,
      }));

      if (schedule.length === 0) {
        return NextResponse.json({ error: "Could not generate schedule" }, { status: 400 });
      }

      // Delete existing schedule for this policy
      await admin
        .from("insurance_payment_schedules")
        .delete()
        .eq("policy_id", policyId);

      // Insert new schedule
      const { error: insertErr } = await admin
        .from("insurance_payment_schedules")
        .insert(schedule);

      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

      // Return the generated schedule
      const { data: payments } = await admin
        .from("insurance_payment_schedules")
        .select("*")
        .eq("policy_id", policyId)
        .order("period_year")
        .order("period_month");

      return NextResponse.json({ success: true, payments: payments || [] });
    }

    case "record_payment": {
      const { paymentId, amount_paid, payment_date, payment_method, reference_number } = body;

      const updatePayload: Record<string, unknown> = {
        amount_paid: amount_paid ?? 0,
        payment_date: payment_date || null,
        payment_method: payment_method || null,
        reference_number: reference_number || null,
        payment_status: amount_paid > 0 ? "paid" : "scheduled",
      };

      const { error } = await admin
        .from("insurance_payment_schedules")
        .update(updatePayload)
        .eq("id", paymentId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "get_payment_summary": {
      const { entityId, year } = body;

      // Get all policy IDs for this entity
      const { data: policies } = await admin
        .from("insurance_policies")
        .select("id")
        .eq("entity_id", entityId);

      const policyIds = (policies || []).map((p: { id: string }) => p.id);

      if (policyIds.length === 0) {
        return NextResponse.json({
          summary: { total_due: 0, total_paid: 0, remaining: 0 },
        });
      }

      let query = admin
        .from("insurance_payment_schedules")
        .select("amount_due, amount_paid")
        .in("policy_id", policyIds);

      if (year) {
        query = query.eq("period_year", year);
      }

      const { data: payments, error } = await query;

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const totalDue = (payments || []).reduce(
        (sum: number, p: { amount_due: string | number | null }) => sum + (Number(p.amount_due) || 0),
        0,
      );
      const totalPaid = (payments || []).reduce(
        (sum: number, p: { amount_paid: string | number | null }) => sum + (Number(p.amount_paid) || 0),
        0,
      );

      return NextResponse.json({
        summary: {
          total_due: totalDue,
          total_paid: totalPaid,
          remaining: totalDue - totalPaid,
        },
      });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
