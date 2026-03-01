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
    case "get_config": {
      const { entityId } = body;

      const { data: customers } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("entity_id", entityId)
        .order("customer_name");

      const customerIds = (customers || []).map((c) => c.id);

      let tiers: Record<string, unknown>[] = [];
      if (customerIds.length > 0) {
        const { data } = await admin
          .from("rebate_tiers")
          .select("*")
          .in("rebate_customer_id", customerIds)
          .order("sort_order");
        tiers = data || [];
      }

      const { data: globalExcludedICodes } = await admin
        .from("rebate_excluded_icodes")
        .select("*")
        .eq("entity_id", entityId)
        .is("rebate_customer_id", null);

      const { data: customerExcludedICodes } = await admin
        .from("rebate_excluded_icodes")
        .select("*")
        .eq("entity_id", entityId)
        .not("rebate_customer_id", "is", null);

      return NextResponse.json({
        customers: customers || [],
        tiers,
        globalExcludedICodes: globalExcludedICodes || [],
        customerExcludedICodes: customerExcludedICodes || [],
      });
    }

    case "upsert_customer": {
      const { entityId, customer, tiers: tierData, excludedICodes } = body;

      // Upsert customer
      const customerPayload = {
        entity_id: entityId,
        customer_name: customer.customer_name,
        rw_customer_id: customer.rw_customer_id,
        agreement_type: customer.agreement_type,
        status: customer.status || "active",
        tax_rate: customer.tax_rate ?? 9.75,
        max_discount_percent: customer.max_discount_percent,
        effective_date: customer.effective_date,
        use_global_exclusions: customer.use_global_exclusions ?? true,
        contract_storage_path: customer.contract_storage_path,
        notes: customer.notes,
        created_by: user.id,
      };

      let customerId = customer.id;

      if (customerId) {
        // Update existing
        const { error } = await admin
          .from("rebate_customers")
          .update(customerPayload)
          .eq("id", customerId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        // Insert new
        const { data, error } = await admin
          .from("rebate_customers")
          .insert(customerPayload)
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        customerId = data.id;
      }

      // Replace tiers
      await admin.from("rebate_tiers").delete().eq("rebate_customer_id", customerId);
      if (tierData && tierData.length > 0) {
        const tierRows = tierData.map(
          (t: Record<string, unknown>, idx: number) => ({
            rebate_customer_id: customerId,
            label: t.label,
            threshold_min: t.threshold_min ?? 0,
            threshold_max: t.threshold_max,
            sort_order: idx,
            rate_pro_supplies: t.rate_pro_supplies ?? 0,
            rate_vehicle: t.rate_vehicle ?? 0,
            rate_grip_lighting: t.rate_grip_lighting ?? 0,
            rate_studio: t.rate_studio ?? 0,
            max_disc_pro_supplies: t.max_disc_pro_supplies ?? 0,
            max_disc_vehicle: t.max_disc_vehicle ?? 0,
            max_disc_grip_lighting: t.max_disc_grip_lighting ?? 0,
            max_disc_studio: t.max_disc_studio ?? 0,
          }),
        );
        const { error } = await admin.from("rebate_tiers").insert(tierRows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Replace customer-specific excluded I-codes
      await admin
        .from("rebate_excluded_icodes")
        .delete()
        .eq("entity_id", entityId)
        .eq("rebate_customer_id", customerId);

      if (excludedICodes && excludedICodes.length > 0) {
        const icodeRows = excludedICodes.map(
          (ic: { i_code: string; description?: string }) => ({
            entity_id: entityId,
            rebate_customer_id: customerId,
            i_code: ic.i_code,
            description: ic.description || null,
          }),
        );
        await admin.from("rebate_excluded_icodes").insert(icodeRows);
      }

      return NextResponse.json({ success: true, customerId });
    }

    case "delete_customer": {
      const { customerId } = body;
      const { error } = await admin
        .from("rebate_customers")
        .delete()
        .eq("id", customerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "upsert_excluded_icodes": {
      const { entityId, icodes } = body;

      // Replace global excluded I-codes
      await admin
        .from("rebate_excluded_icodes")
        .delete()
        .eq("entity_id", entityId)
        .is("rebate_customer_id", null);

      if (icodes && icodes.length > 0) {
        const rows = icodes.map(
          (ic: { i_code: string; description?: string }) => ({
            entity_id: entityId,
            rebate_customer_id: null,
            i_code: ic.i_code,
            description: ic.description || null,
          }),
        );
        const { error } = await admin.from("rebate_excluded_icodes").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    case "mark_quarter_paid": {
      const { summaryId, isPaid } = body;
      const { error } = await admin
        .from("rebate_quarterly_summaries")
        .update({
          is_paid: isPaid,
          paid_at: isPaid ? new Date().toISOString() : null,
          paid_by: isPaid ? user.id : null,
        })
        .eq("id", summaryId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "toggle_manual_exclusion": {
      const { invoiceId, isExcluded, reason } = body;
      const { error } = await admin
        .from("rebate_invoices")
        .update({
          is_manually_excluded: isExcluded,
          manual_exclusion_reason: isExcluded ? reason || null : null,
        })
        .eq("id", invoiceId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case "search_rw_customers": {
      // Search RentalWorks for customers by name
      const { RentalWorksClient } = await import(
        "@/lib/rentalworks/client"
      );
      const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
      await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

      const { query } = body;
      const result = await rw.browse("customer", {
        pagesize: 20,
        searchfields: ["Customer"],
        searchfieldoperators: ["like"],
        searchfieldvalues: [`%${query}%`],
        orderby: "Customer",
        orderbydirection: "asc",
      });

      return NextResponse.json({ customers: result.rows });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
