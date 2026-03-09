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
    const threeMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 3,
      1,
    );

    const invoiceStartDate = formatRWDate(thirteenMonthsAgo);
    const orderStartDate = formatRWDate(threeMonthsAgo);

    // Fetch invoices, orders, and quotes in parallel
    const [invoiceResult, orderResult, quoteResult] = await Promise.all([
      rw.browse<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["InvoiceDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [invoiceStartDate],
        searchfieldtypes: ["date"],
        orderby: "InvoiceDate",
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

    const result = processRevenueData(
      invoiceResult.rows,
      orderResult.rows,
      quoteResult.rows,
    );

    return NextResponse.json(result);
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
