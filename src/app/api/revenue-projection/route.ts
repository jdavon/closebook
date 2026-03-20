import { NextResponse } from "next/server";
import {
  processRevenueData,
  type RWInvoiceRow,
  type RWOrderRow,
  type RWQuoteRow,
} from "@/lib/utils/revenue-projection";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { entityId } = body as { entityId: string };

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 },
      );
    }

    // Dynamic import to avoid bundling issues
    const { RentalWorksClient } = await import("@/lib/rentalworks/client");
    const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
    await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

    // Date boundaries
    const now = new Date();
    const thirteenMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 13,
      1,
    );
    const thirtySixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 36,
      1,
    );
    const threeMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 3,
      1,
    );

    const invoiceStartDate = formatRWDate(thirteenMonthsAgo);
    const billingStartDate = formatRWDate(thirtySixMonthsAgo);
    const orderStartDate = formatRWDate(threeMonthsAgo);

    // Fetch two sets of invoices:
    // 1. By InvoiceDate (13 months) — exact match for invoice_date mode
    // 2. By BillingEndDate (36 months) — captures long-term rentals for billing/rental modes
    // Plus orders and quotes in parallel
    const [invoiceByDate, invoiceByBilling, orderResult, quoteResult] = await Promise.all([
      rw.browse<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["InvoiceDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [invoiceStartDate],
        searchfieldtypes: ["date"],
        orderby: "InvoiceDate",
        orderbydirection: "desc",
      }),
      rw.browse<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["BillingEndDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [billingStartDate],
        searchfieldtypes: ["date"],
        orderby: "BillingEndDate",
        orderbydirection: "desc",
      }),
      rw.browse<RWOrderRow>("order", {
        pagesize: 2000,
        searchfields: ["OrderDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [orderStartDate],
        searchfieldtypes: ["date"],
        orderby: "OrderDate",
        orderbydirection: "desc",
      }),
      rw.browse<RWQuoteRow>("quote", {
        pagesize: 2000,
        searchfields: ["QuoteDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [orderStartDate],
        searchfieldtypes: ["date"],
        orderby: "QuoteDate",
        orderbydirection: "desc",
      }),
    ]);

    // Merge and deduplicate invoices by InvoiceId
    const invoiceMap = new Map<string, RWInvoiceRow>();
    for (const inv of invoiceByDate.rows) {
      invoiceMap.set(inv.InvoiceId, inv);
    }
    for (const inv of invoiceByBilling.rows) {
      if (!invoiceMap.has(inv.InvoiceId)) {
        invoiceMap.set(inv.InvoiceId, inv);
      }
    }
    const mergedInvoices = Array.from(invoiceMap.values());

    // Process with default invoice_date mode; client will re-process for other modes
    const result = processRevenueData(
      mergedInvoices,
      orderResult.rows,
      quoteResult.rows,
      "invoice_date",
    );

    return NextResponse.json({
      ...result,
      // Include raw rows so the client can re-process without another API call
      _rawInvoices: mergedInvoices,
      _rawOrders: orderResult.rows,
      _rawQuotes: quoteResult.rows,
    });
  } catch (err) {
    console.error("POST /api/revenue-projection error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

function formatRWDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
