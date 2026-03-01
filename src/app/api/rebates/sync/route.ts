import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyEquipmentType, getQuarter } from "@/lib/utils/rebate-calculations";

export const maxDuration = 120; // Allow up to 2 minutes for large syncs

interface RWInvoice {
  InvoiceId: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  BillingStartDate: string;
  BillingEndDate: string;
  Status: string;
  Customer: string;
  CustomerId: string;
  Deal: string;
  OrderNumber: string;
  OrderDescription: string;
  InvoiceDescription: string;
  PurchaseOrderNumber: string;
  InvoiceListTotal: string;
  InvoiceGrossTotal: string;
  InvoiceSubTotal: string;
  InvoiceTax: string;
  InvoiceDiscountTotal: string;
  IsNoCharge: string;
  IsNonBillable: string;
}

interface RWInvoiceItem {
  InvoiceItemId: string;
  ICode: string;
  Description: string;
  Quantity: string;
  Extended: string;
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
  const admin = createAdminClient();

  switch (action) {
    case "sync_customer": {
      const { entityId, customerId } = body;

      // Load customer config
      const { data: customer, error: custErr } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("id", customerId)
        .single();

      if (custErr || !customer) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 },
        );
      }

      try {
        const stats = await syncCustomerInvoices(admin, entityId, customer);
        return NextResponse.json({ success: true, ...stats });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sync failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    case "sync_all": {
      const { entityId } = body;

      const { data: customers } = await admin
        .from("rebate_customers")
        .select("*")
        .eq("entity_id", entityId)
        .eq("status", "active");

      if (!customers || customers.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No active customers to sync",
        });
      }

      const results = [];
      for (const customer of customers) {
        try {
          const stats = await syncCustomerInvoices(
            admin,
            entityId,
            customer,
          );
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            ...stats,
          });
        } catch (err) {
          results.push({
            customerId: customer.id,
            customerName: customer.customer_name,
            error: err instanceof Error ? err.message : "Sync failed",
          });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
  }
}

async function syncCustomerInvoices(
  admin: ReturnType<typeof createAdminClient>,
  entityId: string,
  customer: {
    id: string;
    rw_customer_id: string;
    customer_name: string;
  },
) {
  // Import RentalWorks client
  const { RentalWorksClient } = await import(
    "@/lib/rentalworks/client"
  );
  const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
  await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

  // Fetch invoices for this customer
  const invoiceResult = await rw.browse<RWInvoice>("invoice", {
    pagesize: 2000,
    searchfields: ["CustomerId"],
    searchfieldoperators: ["="],
    searchfieldvalues: [customer.rw_customer_id],
    orderby: "BillingEndDate",
    orderbydirection: "asc",
  });

  const invoices = invoiceResult.rows;

  // Filter to CLOSED, non-zero invoices
  const closedInvoices = invoices.filter((inv) => {
    const status = (inv.Status || "").toUpperCase();
    if (status !== "CLOSED") return false;
    if (inv.IsNoCharge === "true" || inv.IsNonBillable === "true") return false;
    return true;
  });

  let synced = 0;
  let itemsSynced = 0;

  // Process invoices in batches
  for (const inv of closedInvoices) {
    const equipType = classifyEquipmentType(
      inv.OrderDescription || inv.InvoiceDescription || "",
    );
    const quarter = getQuarter(inv.BillingEndDate || inv.InvoiceDate);

    // Upsert invoice
    const invoiceRow = {
      entity_id: entityId,
      rebate_customer_id: customer.id,
      rw_invoice_id: inv.InvoiceId,
      invoice_number: inv.InvoiceNumber,
      invoice_date: inv.InvoiceDate || null,
      billing_start_date: inv.BillingStartDate || null,
      billing_end_date: inv.BillingEndDate || null,
      status: inv.Status,
      customer_name: inv.Customer,
      deal: inv.Deal || null,
      order_number: inv.OrderNumber || null,
      order_description:
        inv.OrderDescription || inv.InvoiceDescription || null,
      purchase_order_number: inv.PurchaseOrderNumber || null,
      list_total: Number(inv.InvoiceListTotal) || 0,
      gross_total: Number(inv.InvoiceGrossTotal) || 0,
      sub_total: Number(inv.InvoiceSubTotal) || 0,
      tax_amount: Number(inv.InvoiceTax) || 0,
      discount_amount: Number(inv.InvoiceDiscountTotal) || 0,
      equipment_type: equipType,
      quarter,
      synced_at: new Date().toISOString(),
    };

    const { data: upserted, error: upsertErr } = await admin
      .from("rebate_invoices")
      .upsert(invoiceRow, { onConflict: "entity_id,rw_invoice_id" })
      .select("id")
      .single();

    if (upsertErr || !upserted) continue;
    synced++;

    // Fetch invoice items (batched 5 at a time)
    try {
      const itemResult = await rw.browse<RWInvoiceItem>("invoiceitem", {
        pagesize: 500,
        uniqueids: { InvoiceId: inv.InvoiceId },
      });

      // Delete old items and insert fresh
      await admin
        .from("rebate_invoice_items")
        .delete()
        .eq("rebate_invoice_id", upserted.id);

      if (itemResult.rows.length > 0) {
        const itemRows = itemResult.rows.map((item) => ({
          rebate_invoice_id: upserted.id,
          rw_item_id: item.InvoiceItemId || null,
          i_code: item.ICode || null,
          description: item.Description || null,
          quantity: Number(item.Quantity) || 0,
          extended: Number(item.Extended) || 0,
          is_excluded: false,
        }));

        await admin.from("rebate_invoice_items").insert(itemRows);
        itemsSynced += itemRows.length;
      }
    } catch {
      // Continue even if item fetch fails for one invoice
    }
  }

  return {
    totalInvoices: invoices.length,
    closedInvoices: closedInvoices.length,
    synced,
    itemsSynced,
  };
}
