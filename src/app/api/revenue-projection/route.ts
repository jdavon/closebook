import { NextResponse } from "next/server";
import { processRevenueData } from "@/lib/utils/revenue-projection";
import { fetchRentalWorksRevenueData } from "@/lib/rentalworks/fetch-revenue-data";

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

    const { invoices, orders, quotes } = await fetchRentalWorksRevenueData();

    // Process with default invoice_date mode; client will re-process for other modes
    const result = processRevenueData(
      invoices,
      orders,
      quotes,
      "invoice_date",
    );

    return NextResponse.json({
      ...result,
      // Include raw rows so the client can re-process without another API call
      _rawInvoices: invoices,
      _rawOrders: orders,
      _rawQuotes: quotes,
    });
  } catch (err) {
    console.error("POST /api/revenue-projection error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
