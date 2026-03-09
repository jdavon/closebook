import { classifyEquipmentType } from "./rebate-calculations";

// ─── Raw RW Browse Row Types ────────────────────────────────────────────────

export interface RWInvoiceRow {
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
  InvoiceListTotal: string;
  InvoiceGrossTotal: string;
  InvoiceSubTotal: string;
  InvoiceTax: string;
  InvoiceDiscountTotal: string;
  IsNoCharge: string;
  IsNonBillable: string;
  Warehouse: string;
}

export interface RWOrderRow {
  OrderId: string;
  OrderNumber: string;
  OrderDate: string;
  Description: string;
  Customer: string;
  CustomerId: string;
  Deal: string;
  Warehouse: string;
  Status: string;
  Total: string;
}

export interface RWQuoteRow {
  QuoteId: string;
  QuoteNumber: string;
  QuoteDate: string;
  Customer: string;
  Status: string;
  Total: string;
  Warehouse: string;
  Description: string;
}

// ─── Processed Output Types ─────────────────────────────────────────────────

export interface MonthlyRevenue {
  month: string; // "2026-01"
  label: string; // "Jan 26"
  closed: number;
  pending: number;
  pipeline: number;
  forecast: number | null; // null = no forecast for this month
}

export interface PipelineOrder {
  orderId: string;
  orderNumber: string;
  customer: string;
  deal: string;
  description: string;
  total: number;
  status: string;
  orderDate: string;
  equipmentType: string;
  warehouse: string;
}

export interface PipelineQuote {
  quoteId: string;
  quoteNumber: string;
  customer: string;
  total: number;
  status: string;
  quoteDate: string;
  description: string;
  warehouse: string;
}

export interface ClosedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  billingStartDate: string;
  billingEndDate: string;
  customer: string;
  deal: string;
  orderNumber: string;
  orderDescription: string;
  listTotal: number;
  grossTotal: number;
  subTotal: number;
  tax: number;
  equipmentType: string;
  month: string; // month key the revenue is assigned to (based on billing date)
}

export interface EquipmentBreakdown {
  type: string;
  label: string;
  amount: number;
  percentage: number;
}

export type DateMode = "invoice_date" | "billing_date";

export interface RevenueProjectionResponse {
  ytdRevenue: number;
  currentMonthActual: number;
  currentMonthProjected: number;
  pipelineValue: number;
  quoteOpportunities: number;
  monthlyData: MonthlyRevenue[];
  pipelineOrders: PipelineOrder[];
  pipelineQuotes: PipelineQuote[];
  closedInvoices: ClosedInvoice[];
  equipmentBreakdown: EquipmentBreakdown[];
  dataAsOf: string;
  dateMode: DateMode;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VS_WAREHOUSE_KEYWORDS = ["VERSATILE", "CAHUENGA"];

const TERMINAL_ORDER_STATUSES = new Set([
  "CANCELLED",
  "CLOSED",
  "COMPLETE",
  "VOID",
]);

export const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  vehicle: "Vehicle",
  grip_lighting: "Grip & Lighting",
  studio: "Studio",
  pro_supplies: "Pro Supplies",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function isVersatileWarehouse(warehouse: string | undefined | null): boolean {
  if (!warehouse) return false;
  const upper = warehouse.toUpperCase();
  return VS_WAREHOUSE_KEYWORDS.some((kw) => upper.includes(kw));
}

function toNum(val: string | number | undefined | null): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function getMonthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[Number(m) - 1]} ${y.slice(2)}`;
}

function generateMonthKeys(startMonthsAgo: number, endMonthsAhead: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = -startMonthsAgo; offset <= endMonthsAhead; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    keys.push(`${y}-${m}`);
  }
  return keys;
}

// ─── Main Processing ────────────────────────────────────────────────────────

export function processRevenueData(
  rawInvoices: RWInvoiceRow[],
  rawOrders: RWOrderRow[],
  rawQuotes: RWQuoteRow[],
  dateMode: DateMode = "invoice_date",
): RevenueProjectionResponse {
  const now = new Date();
  const currentMonthKey = getMonthKey(now.toISOString());
  const currentYear = now.getFullYear();

  // Date selector: which date to use for grouping invoices into months
  const getInvoiceGroupDate = (inv: RWInvoiceRow) =>
    dateMode === "billing_date"
      ? inv.BillingEndDate || inv.BillingStartDate || inv.InvoiceDate
      : inv.InvoiceDate;

  // --- Filter to Versatile warehouse ---

  // Orders: filter by Warehouse field directly
  const vsOrders = rawOrders.filter((o) => isVersatileWarehouse(o.Warehouse));

  // Build a set of VS order numbers for invoice cross-reference
  const vsOrderNumbers = new Set(
    vsOrders.map((o) => o.OrderNumber).filter(Boolean),
  );

  // Invoices: try Warehouse field first, fall back to OrderNumber match
  const vsInvoices = rawInvoices.filter((inv) => {
    if (isVersatileWarehouse(inv.Warehouse)) return true;
    if (inv.OrderNumber && vsOrderNumbers.has(inv.OrderNumber)) return true;
    return false;
  });

  // Quotes: filter by Warehouse field
  const vsQuotes = rawQuotes.filter((q) => isVersatileWarehouse(q.Warehouse));

  // --- Filter out void/no-charge invoices ---
  const validInvoices = vsInvoices.filter((inv) => {
    const status = (inv.Status || "").toUpperCase();
    if (status === "VOID") return false;
    if (inv.IsNoCharge === "true" || inv.IsNonBillable === "true") return false;
    return true;
  });

  // --- Categorize invoices ---
  const closedInvoices = validInvoices.filter(
    (inv) => (inv.Status || "").toUpperCase() === "CLOSED",
  );
  const pendingInvoices = validInvoices.filter((inv) => {
    const s = (inv.Status || "").toUpperCase();
    return s === "NEW" || s === "APPROVED";
  });

  // --- Build monthly buckets (12 months back + current + 3 forward) ---
  const monthKeys = generateMonthKeys(12, 3);
  const monthMap = new Map<
    string,
    { closed: number; pending: number; pipeline: number }
  >();
  for (const mk of monthKeys) {
    monthMap.set(mk, { closed: 0, pending: 0, pipeline: 0 });
  }

  // Aggregate closed invoices by the selected date mode
  for (const inv of closedInvoices) {
    const mk = getMonthKey(getInvoiceGroupDate(inv));
    if (mk && monthMap.has(mk)) {
      monthMap.get(mk)!.closed += toNum(inv.InvoiceSubTotal);
    }
  }

  // Aggregate pending invoices by the selected date mode
  for (const inv of pendingInvoices) {
    const mk = getMonthKey(getInvoiceGroupDate(inv));
    if (mk && monthMap.has(mk)) {
      monthMap.get(mk)!.pending += toNum(inv.InvoiceSubTotal);
    }
  }

  // --- Pipeline: open orders not yet fully invoiced ---
  const activeOrders = vsOrders.filter(
    (o) => !TERMINAL_ORDER_STATUSES.has((o.Status || "").toUpperCase()),
  );

  for (const ord of activeOrders) {
    const mk = getMonthKey(ord.OrderDate);
    if (mk && monthMap.has(mk)) {
      monthMap.get(mk)!.pipeline += toNum(ord.Total);
    }
  }

  // --- Forecast: 6-month SMA of closed revenue projected 3 months forward ---
  // Get last 6 completed months (excluding current month)
  const completedMonths = monthKeys.filter((mk) => mk < currentMonthKey);
  const last6 = completedMonths.slice(-6);
  const last6Totals = last6.map((mk) => monthMap.get(mk)?.closed ?? 0);
  const smaSum = last6Totals.reduce((a, b) => a + b, 0);
  const smaAvg = last6.length > 0 ? smaSum / last6.length : 0;

  // Future months get the forecast value
  const futureMonths = monthKeys.filter((mk) => mk > currentMonthKey);

  // --- Build MonthlyRevenue array ---
  const monthlyData: MonthlyRevenue[] = monthKeys.map((mk) => {
    const bucket = monthMap.get(mk)!;
    const isFuture = futureMonths.includes(mk);
    return {
      month: mk,
      label: getMonthLabel(mk),
      closed: bucket.closed,
      pending: bucket.pending,
      pipeline: bucket.pipeline,
      forecast: isFuture ? smaAvg : null,
    };
  });

  // --- KPIs ---
  const ytdRevenue = closedInvoices
    .filter((inv) => {
      const d = new Date(getInvoiceGroupDate(inv));
      return !isNaN(d.getTime()) && d.getFullYear() === currentYear;
    })
    .reduce((sum, inv) => sum + toNum(inv.InvoiceSubTotal), 0);

  const currentMonthBucket = monthMap.get(currentMonthKey);
  const currentMonthActual = currentMonthBucket?.closed ?? 0;
  const currentMonthProjected =
    currentMonthActual +
    (currentMonthBucket?.pending ?? 0) +
    (currentMonthBucket?.pipeline ?? 0);

  const pipelineValue = activeOrders.reduce(
    (sum, o) => sum + toNum(o.Total),
    0,
  );

  // Active quotes
  const activeQuotes = vsQuotes.filter((q) => {
    const s = (q.Status || "").toUpperCase();
    return s === "ACTIVE" || s === "PROSPECT" || s === "OPEN";
  });
  const quoteOpportunities = activeQuotes.reduce(
    (sum, q) => sum + toNum(q.Total),
    0,
  );

  // --- Equipment breakdown (YTD closed invoices) ---
  const equipTotals: Record<string, number> = {};
  for (const inv of closedInvoices) {
    const d = new Date(getInvoiceGroupDate(inv));
    if (isNaN(d.getTime()) || d.getFullYear() !== currentYear) continue;
    const type = classifyEquipmentType(
      inv.OrderDescription || inv.InvoiceDescription || "",
    );
    equipTotals[type] = (equipTotals[type] || 0) + toNum(inv.InvoiceSubTotal);
  }

  const equipTotal = Object.values(equipTotals).reduce((a, b) => a + b, 0);
  const equipmentBreakdown: EquipmentBreakdown[] = Object.entries(equipTotals)
    .map(([type, amount]) => ({
      type,
      label: EQUIPMENT_TYPE_LABELS[type] || type,
      amount,
      percentage: equipTotal > 0 ? (amount / equipTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // --- Pipeline tables ---
  const pipelineOrders: PipelineOrder[] = activeOrders
    .map((o) => ({
      orderId: o.OrderId,
      orderNumber: o.OrderNumber,
      customer: o.Customer,
      deal: o.Deal || "",
      description: o.Description || "",
      total: toNum(o.Total),
      status: o.Status,
      orderDate: o.OrderDate,
      equipmentType: classifyEquipmentType(o.Description || ""),
      warehouse: o.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  // --- Closed invoices table ---
  const closedInvoiceRows: ClosedInvoice[] = closedInvoices
    .map((inv) => {
      const groupDate = getInvoiceGroupDate(inv);
      return {
        invoiceId: inv.InvoiceId,
        invoiceNumber: inv.InvoiceNumber,
        invoiceDate: inv.InvoiceDate,
        billingStartDate: inv.BillingStartDate || "",
        billingEndDate: inv.BillingEndDate || "",
        customer: inv.Customer,
        deal: inv.Deal || "",
        orderNumber: inv.OrderNumber || "",
        orderDescription: inv.OrderDescription || inv.InvoiceDescription || "",
        listTotal: toNum(inv.InvoiceSubTotal),
        grossTotal: toNum(inv.InvoiceGrossTotal),
        subTotal: toNum(inv.InvoiceSubTotal),
        tax: toNum(inv.InvoiceTax),
        equipmentType: classifyEquipmentType(
          inv.OrderDescription || inv.InvoiceDescription || "",
        ),
        month: getMonthKey(groupDate),
      };
    })
    .sort((a, b) => {
      // Sort by invoice date descending (most recent first)
      return b.invoiceDate.localeCompare(a.invoiceDate);
    });

  const pipelineQuotes: PipelineQuote[] = activeQuotes
    .map((q) => ({
      quoteId: q.QuoteId || "",
      quoteNumber: q.QuoteNumber,
      customer: q.Customer,
      total: toNum(q.Total),
      status: q.Status,
      quoteDate: q.QuoteDate,
      description: q.Description || "",
      warehouse: q.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    ytdRevenue,
    currentMonthActual,
    currentMonthProjected,
    pipelineValue,
    quoteOpportunities,
    monthlyData,
    pipelineOrders,
    pipelineQuotes,
    closedInvoices: closedInvoiceRows,
    equipmentBreakdown,
    dataAsOf: new Date().toISOString(),
    dateMode,
  };
}
