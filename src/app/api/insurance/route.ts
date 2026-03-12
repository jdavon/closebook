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
    case "get_dashboard": {
      const { entityId } = body;

      // Fetch all policies for this entity with carrier/broker names
      const { data: policies, error: polErr } = await admin
        .from("insurance_policies")
        .select("*, insurance_carriers(name), insurance_brokers(name)")
        .eq("entity_id", entityId)
        .order("effective_date", { ascending: false });

      if (polErr) return NextResponse.json({ error: polErr.message }, { status: 500 });

      // Fetch carriers for entity
      const { data: carriers } = await admin
        .from("insurance_carriers")
        .select("*")
        .eq("entity_id", entityId)
        .order("name");

      // Fetch brokers for entity
      const { data: brokers } = await admin
        .from("insurance_brokers")
        .select("*")
        .eq("entity_id", entityId)
        .order("name");

      // Payment summary: total due, total paid, remaining
      const policyIds = (policies || []).map((p: { id: string }) => p.id);
      let paymentSummary = { total_due: 0, total_paid: 0, remaining: 0 };

      if (policyIds.length > 0) {
        const { data: payments } = await admin
          .from("insurance_payment_schedules")
          .select("amount_due, amount_paid")
          .in("policy_id", policyIds);

        if (payments) {
          const totalDue = payments.reduce((sum: number, p: { amount_due: string | number | null }) => sum + (Number(p.amount_due) || 0), 0);
          const totalPaid = payments.reduce((sum: number, p: { amount_paid: string | number | null }) => sum + (Number(p.amount_paid) || 0), 0);
          paymentSummary = {
            total_due: totalDue,
            total_paid: totalPaid,
            remaining: totalDue - totalPaid,
          };
        }
      }

      // Claims count
      const { count: claimsCount } = await admin
        .from("insurance_claims")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", entityId);

      // Subjectivities count (pending)
      const { count: subjectivitiesCount } = await admin
        .from("insurance_subjectivities")
        .select("id", { count: "exact", head: true })
        .in("policy_id", policyIds.length > 0 ? policyIds : ["__none__"])
        .eq("status", "pending");

      return NextResponse.json({
        policies: policies || [],
        carriers: carriers || [],
        brokers: brokers || [],
        summary: {
          ...paymentSummary,
          claims_count: claimsCount || 0,
          subjectivities_count: subjectivitiesCount || 0,
        },
      });
    }

    case "get_policies": {
      const { entityId } = body;

      const { data: policies, error } = await admin
        .from("insurance_policies")
        .select("*, insurance_carriers(name), insurance_brokers(name)")
        .eq("entity_id", entityId)
        .order("effective_date", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ policies: policies || [] });
    }

    case "get_policy": {
      const { policyId } = body;

      const { data: policy, error: polErr } = await admin
        .from("insurance_policies")
        .select("*, insurance_carriers(name), insurance_brokers(name)")
        .eq("id", policyId)
        .single();

      if (polErr || !policy) {
        return NextResponse.json({ error: "Policy not found" }, { status: 404 });
      }

      // Fetch all related data
      const { data: coverages } = await admin
        .from("insurance_coverages")
        .select("*")
        .eq("policy_id", policyId)
        .order("sort_order");

      const { data: payments } = await admin
        .from("insurance_payment_schedules")
        .select("*")
        .eq("policy_id", policyId)
        .order("period_year")
        .order("period_month");

      const { data: locations } = await admin
        .from("insurance_locations")
        .select("*")
        .eq("policy_id", policyId)
        .order("sort_order");

      const { data: exposures } = await admin
        .from("insurance_exposures")
        .select("*")
        .eq("policy_id", policyId)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false });

      const { data: allocations } = await admin
        .from("insurance_allocations")
        .select("*")
        .eq("policy_id", policyId)
        .order("target_entity_id");

      const { data: exclusions } = await admin
        .from("insurance_exclusions")
        .select("*")
        .eq("policy_id", policyId)
        .order("sort_order");

      const { data: subjectivities } = await admin
        .from("insurance_subjectivities")
        .select("*")
        .eq("policy_id", policyId)
        .order("due_date");

      const { data: documents } = await admin
        .from("insurance_documents")
        .select("*")
        .eq("policy_id", policyId)
        .order("created_at", { ascending: false });

      const { data: claims } = await admin
        .from("insurance_claims")
        .select("*")
        .eq("policy_id", policyId)
        .order("date_of_loss", { ascending: false });

      return NextResponse.json({
        policy,
        coverages: coverages || [],
        payments: payments || [],
        locations: locations || [],
        exposures: exposures || [],
        allocations: allocations || [],
        exclusions: exclusions || [],
        subjectivities: subjectivities || [],
        documents: documents || [],
        claims: claims || [],
      });
    }

    case "upsert_policy": {
      const { entityId, policy } = body;

      const policyPayload = {
        entity_id: entityId,
        policy_number: policy.policy_number || null,
        policy_type: policy.policy_type || "other",
        carrier_id: policy.carrier_id || null,
        broker_id: policy.broker_id || null,
        line_of_business: policy.line_of_business || null,
        named_insured: policy.named_insured || null,
        named_insured_entity: policy.named_insured_entity || null,
        status: policy.status || "active",
        effective_date: policy.effective_date || null,
        expiration_date: policy.expiration_date || null,
        annual_premium: policy.annual_premium ?? 0,
        prior_year_premium: policy.prior_year_premium ?? 0,
        premium_change_pct: policy.premium_change_pct ?? 0,
        payment_terms: policy.payment_terms || "annual",
        installment_description: policy.installment_description || null,
        billing_company: policy.billing_company || null,
        deposit_held: policy.deposit_held ?? 0,
        is_auditable: policy.is_auditable ?? false,
        coverage_territory: policy.coverage_territory || null,
        notes: policy.notes || null,
        renewal_notes: policy.renewal_notes || null,
      };

      let policyId = policy.id;

      if (policyId) {
        const { error } = await admin
          .from("insurance_policies")
          .update(policyPayload)
          .eq("id", policyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_policies")
          .insert(policyPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        policyId = data.id;
      }

      return NextResponse.json({ success: true, policyId });
    }

    case "delete_policy": {
      const { policyId } = body;
      const { error } = await admin
        .from("insurance_policies")
        .delete()
        .eq("id", policyId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "get_carriers": {
      const { entityId } = body;
      const { data: carriers, error } = await admin
        .from("insurance_carriers")
        .select("*")
        .eq("entity_id", entityId)
        .order("name");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ carriers: carriers || [] });
    }

    case "upsert_carrier": {
      const { entityId, carrier } = body;

      const carrierPayload = {
        entity_id: entityId,
        name: carrier.name,
        am_best_rating: carrier.am_best_rating || null,
        contact_name: carrier.contact_name || null,
        contact_email: carrier.contact_email || null,
        contact_phone: carrier.contact_phone || null,
        notes: carrier.notes || null,
      };

      let carrierId = carrier.id;

      if (carrierId) {
        const { error } = await admin
          .from("insurance_carriers")
          .update(carrierPayload)
          .eq("id", carrierId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_carriers")
          .insert(carrierPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        carrierId = data.id;
      }

      return NextResponse.json({ success: true, carrierId });
    }

    case "delete_carrier": {
      const { carrierId } = body;
      const { error } = await admin
        .from("insurance_carriers")
        .delete()
        .eq("id", carrierId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "get_brokers": {
      const { entityId } = body;
      const { data: brokers, error } = await admin
        .from("insurance_brokers")
        .select("*")
        .eq("entity_id", entityId)
        .order("name");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ brokers: brokers || [] });
    }

    case "upsert_broker": {
      const { entityId, broker } = body;

      const brokerPayload = {
        entity_id: entityId,
        name: broker.name,
        contact_name: broker.contact_name || null,
        contact_email: broker.contact_email || null,
        contact_phone: broker.contact_phone || null,
        commission_rate: broker.commission_rate ?? null,
        notes: broker.notes || null,
      };

      let brokerId = broker.id;

      if (brokerId) {
        const { error } = await admin
          .from("insurance_brokers")
          .update(brokerPayload)
          .eq("id", brokerId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { data, error } = await admin
          .from("insurance_brokers")
          .insert(brokerPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        brokerId = data.id;
      }

      return NextResponse.json({ success: true, brokerId });
    }

    case "delete_broker": {
      const { brokerId } = body;
      const { error } = await admin
        .from("insurance_brokers")
        .delete()
        .eq("id", brokerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "import_extracted": {
      // Bulk import from AI-extracted PDF data
      const { entityId, extracted } = body;
      const results: { policies: string[]; errors: string[] } = { policies: [], errors: [] };

      // Upsert broker if present
      let brokerId: string | null = null;
      if (extracted.program_summary?.broker_name) {
        const { data: existingBroker } = await admin
          .from("insurance_brokers")
          .select("id")
          .eq("entity_id", entityId)
          .eq("name", extracted.program_summary.broker_name)
          .maybeSingle();

        if (existingBroker) {
          brokerId = existingBroker.id;
        } else {
          const { data: newBroker, error: bErr } = await admin
            .from("insurance_brokers")
            .insert({
              entity_id: entityId,
              name: extracted.program_summary.broker_name,
              license_number: extracted.program_summary.broker_license || null,
            })
            .select("id")
            .single();
          if (!bErr && newBroker) brokerId = newBroker.id;
        }
      }

      // Process each extracted policy
      for (const ep of extracted.policies || []) {
        try {
          // Upsert carrier
          let carrierId: string | null = null;
          if (ep.carrier_name) {
            const { data: existingCarrier } = await admin
              .from("insurance_carriers")
              .select("id")
              .eq("entity_id", entityId)
              .eq("name", ep.carrier_name)
              .maybeSingle();

            if (existingCarrier) {
              carrierId = existingCarrier.id;
            } else {
              const { data: newCarrier, error: cErr } = await admin
                .from("insurance_carriers")
                .insert({ entity_id: entityId, name: ep.carrier_name })
                .select("id")
                .single();
              if (!cErr && newCarrier) carrierId = newCarrier.id;
            }
          }

          // Insert policy
          const { data: pol, error: polErr } = await admin
            .from("insurance_policies")
            .insert({
              entity_id: entityId,
              carrier_id: carrierId,
              broker_id: brokerId,
              policy_type: ep.policy_type || "other",
              line_of_business: ep.line_of_business || null,
              named_insured: ep.named_insured || extracted.program_summary?.named_insured || null,
              named_insured_entity: ep.named_insured_entity || null,
              status: ep.status || "active",
              effective_date: extracted.program_summary?.effective_date || null,
              expiration_date: extracted.program_summary?.expiration_date || null,
              annual_premium: ep.annual_premium ?? 0,
              prior_year_premium: ep.prior_year_premium ?? 0,
              premium_change_pct: ep.premium_change_pct ?? 0,
              payment_terms: ep.payment_terms || "annual",
              installment_description: ep.installment_description || null,
              billing_company: ep.billing_company || null,
              deposit_held: ep.deposit_held ?? 0,
              is_auditable: ep.is_auditable ?? false,
              coverage_territory: ep.coverage_territory || null,
              notes: ep.notes || null,
              renewal_notes: ep.renewal_notes || null,
            })
            .select("id")
            .single();

          if (polErr || !pol) {
            results.errors.push(`Policy ${ep.line_of_business}: ${polErr?.message}`);
            continue;
          }

          results.policies.push(pol.id);

          // Insert coverages
          if (ep.coverages?.length > 0) {
            const coverageRows = ep.coverages.map(
              (c: Record<string, unknown>, idx: number) => ({
                policy_id: pol.id,
                coverage_name: c.coverage_name as string || "Unknown",
                coverage_form: c.coverage_form || "occurrence",
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
              })
            );
            await admin.from("insurance_coverages").insert(coverageRows);
          }

          // Insert locations
          if (ep.locations?.length > 0) {
            const locationRows = ep.locations.map(
              (l: Record<string, unknown>, idx: number) => ({
                policy_id: pol.id,
                location_code: l.location_code || null,
                address: l.address as string || "Unknown",
                city: l.city || null,
                state: l.state || null,
                zip_code: l.zip_code || null,
                occupancy_description: l.occupancy_description || null,
                building_value: l.building_value ?? 0,
                bpp_value: l.bpp_value ?? 0,
                business_income_value: l.business_income_value ?? 0,
                rental_income_value: l.rental_income_value ?? 0,
                is_active: l.is_active ?? true,
                location_type: l.location_type || "operating",
                class_code: l.class_code || null,
                class_description: l.class_description || null,
                sort_order: idx,
              })
            );
            await admin.from("insurance_locations").insert(locationRows);
          }

          // Insert exclusions
          if (ep.exclusions?.length > 0) {
            const exclusionRows = ep.exclusions.map(
              (e: Record<string, unknown>, idx: number) => ({
                policy_id: pol.id,
                exclusion_name: e.exclusion_name as string,
                is_excluded: e.is_excluded ?? true,
                sort_order: idx,
              })
            );
            await admin.from("insurance_exclusions").insert(exclusionRows);
          }

          // Insert subjectivities
          if (ep.subjectivities?.length > 0) {
            const subRows = ep.subjectivities.map(
              (s: Record<string, unknown>) => ({
                policy_id: pol.id,
                description: s.description as string,
                due_date: s.due_date || null,
                status: "pending" as const,
              })
            );
            await admin.from("insurance_subjectivities").insert(subRows);
          }

          // Insert payment schedule
          if (ep.payment_schedule?.length > 0) {
            const months = [
              "January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December",
            ];
            const effYear = extracted.program_summary?.effective_date
              ? new Date(extracted.program_summary.effective_date).getFullYear()
              : new Date().getFullYear();

            const paymentRows = ep.payment_schedule.map(
              (ps: { month_name: string; amount: number }) => {
                const monthIdx = months.findIndex(
                  (m) => m.toLowerCase().startsWith(ps.month_name?.toLowerCase()?.slice(0, 3))
                );
                const periodMonth = monthIdx >= 0 ? monthIdx + 1 : 1;
                // If month is before the effective month, it's the next year
                const effMonth = extracted.program_summary?.effective_date
                  ? new Date(extracted.program_summary.effective_date).getMonth() + 1
                  : 1;
                const periodYear = periodMonth < effMonth ? effYear + 1 : effYear;
                return {
                  policy_id: pol.id,
                  period_month: periodMonth,
                  period_year: periodYear,
                  amount_due: ps.amount ?? 0,
                  payment_status: "scheduled" as const,
                  is_estimate: true,
                };
              }
            );
            await admin.from("insurance_payment_schedules").insert(paymentRows);
          }

          // Insert exposures
          if (ep.exposures && ep.exposures.type) {
            await admin.from("insurance_exposures").insert({
              policy_id: pol.id,
              exposure_type: ep.exposures.type,
              exposure_value: ep.exposures.current_value ?? null,
              rate: ep.exposures.rate ?? null,
              notes: ep.exposures.rate_description || null,
            });
          }
        } catch (e) {
          results.errors.push(
            `Policy ${ep.line_of_business}: ${e instanceof Error ? e.message : "Unknown error"}`
          );
        }
      }

      return NextResponse.json({
        success: true,
        imported_count: results.policies.length,
        policy_ids: results.policies,
        errors: results.errors,
      });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
