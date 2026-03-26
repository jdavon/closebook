# SOP-09.09: Building Custom Reports from API Data

| Field | Value |
|-------|-------|
| **SOP #** | 09.09 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

Provides guidance on building custom reports using RentalWorks API data. This SOP covers data extraction patterns, aggregation strategies, output formats (JSON, PDF, HTML), and examples from the existing codebase that can be used as templates for new reports.

---

## Scope

Applies to the internal development team when creating new reporting capabilities beyond what RentalWorks Web provides natively. Also relevant for managers requesting custom report development.

---

## Prerequisites

- [ ] RentalWorks API access configured (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Understanding of browse endpoints (see [SOP-09.02](SOP-09.02-api-browse-endpoint-usage.md))
- [ ] Node.js development environment set up
- [ ] Familiarity with the existing report examples in the codebase

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API + Reports
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** Custom report generation using browse endpoints for Orders, Quotes, Customers, Contracts, and Purchase Orders

---

## Procedure

### Step 1: Identify Available Data Sources

The following data is accessible via the RentalWorks API:

| Data Source | API Endpoint | Browse Status | Key Fields |
|-------------|-------------|---------------|------------|
| Orders | `POST /order/browse` | ✅ Working | OrderNumber, Date, Customer, Deal, Status, Total, Warehouse, Agent |
| Quotes | `POST /quote/browse` | ✅ Working | QuoteNumber, Date, Customer, Status, Total, Warehouse |
| Customers | `POST /customer/browse` | ✅ Working | Customer name, Account number, Contact info |
| Deals | `POST /Deal/browse` | ✅ Working | Deal name, Customer, Status |
| Contracts | `POST /contract/browse` | ✅ Working | ContractId, Type (OUT/IN), Date, DeliveryId |
| Purchase Orders | `POST /purchaseorder/browse` | ✅ Working | Vendor, Status, Total, OrderId |
| Warehouses | `POST /warehouse/browse` | ✅ Working | Warehouse name, Location |
| Reservations | Gmail/Thermeon XLSX | ✅ Working | ResNum, Customer, Vehicle Class, Dates, Total |
| Inventory | `POST /item/browse` | ❌ Broken (500) | Use GET by ID as workaround |

### Step 2: Choose a Report Pattern

**Pattern A: JSON API Response**
Best for: dashboard widgets, real-time data, frontend consumption.
Example: `api/summary.ts`

```typescript
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const data = await fetchAndAggregate();
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json(data);
}
```

**Pattern B: PDF Report with Email Delivery**
Best for: daily/weekly summaries, printable reports, executive briefings.
Example: `api/cron-daily-report.ts`

```typescript
const pdfBuffer = await generatePdf(data);
await sendEmail(gmailToken, recipients, subject, pdfBuffer, filename);
```

**Pattern C: HTML Dashboard**
Best for: interactive views, drill-down capability, auto-refresh.
Example: `src/dashboard-server.ts`

### Step 3: Extract Data from Browse Endpoints

**Important:** Browse responses return positional arrays, not named objects.

```typescript
const result = await client.getOrders({
  pagesize: 1000,
  orderby: "OrderDate",
  orderbydirection: "desc",
  searchfields: ["Warehouse", "OrderDate"],
  searchfieldoperators: ["=", ">="],
  searchfieldvalues: ["VERSATILE - CAHUENGA", "2026-01-01"],
  searchfieldtypes: ["", "date"],
});
```

Map positional data using ColumnIndex:
```typescript
// ColumnIndex maps field names to array positions
const ci = result.ColumnIndex || {};
const totalIdx = ci.Total ?? 44;
const statusIdx = ci.Status ?? 34;
const customerIdx = ci.Customer ?? 23;

for (const row of result.Rows) {
  const total = Number(row[totalIdx]) || 0;
  const status = row[statusIdx] as string;
  const customer = row[customerIdx] as string;
}
```

### Step 4: Aggregate and Transform Data

Common aggregation patterns:

**Group by Status:**
```typescript
const byStatus: Record<string, number> = {};
for (const row of rows) {
  const status = row[statusIdx] || "UNKNOWN";
  byStatus[status] = (byStatus[status] || 0) + 1;
}
```

**Revenue by Customer (Top N):**
```typescript
const customerRevenue: Record<string, number> = {};
for (const row of rows) {
  const cust = String(row[customerIdx]).trim();
  const amt = Number(row[totalIdx]) || 0;
  customerRevenue[cust] = (customerRevenue[cust] || 0) + amt;
}
const topCustomers = Object.entries(customerRevenue)
  .map(([name, revenue]) => ({ name, revenue }))
  .sort((a, b) => b.revenue - a.revenue)
  .slice(0, 10);
```

**Multi-Day Batch Processing:**
```typescript
async function batchProcess<T>(
  items: string[],
  fn: (item: string) => Promise<T>,
  concurrency: number
): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : null);
    }
  }
  return results;
}
```

### Step 5: Generate PDF Output (Optional)

Using PDFKit for formatted reports:

```typescript
import * as PDFDocumentModule from "pdfkit";
const PDFDocument = (PDFDocumentModule as any).default || PDFDocumentModule;

function generateReport(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Header
    doc.fontSize(20).font("Helvetica-Bold")
      .text("Report Title", { align: "center" });

    // Table rows
    for (const item of data.items) {
      doc.fontSize(10).font("Helvetica")
        .text(item.label, 40, doc.y, { width: 200 })
        .text(item.value, 240, doc.y - 12, { width: 200, align: "right" });
    }

    doc.end();
  });
}
```

### Step 6: Add Caching

Set appropriate cache headers based on data freshness needs:

```typescript
const today = new Date().toISOString().slice(0, 10);
if (requestedDate === today) {
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min for current data
} else {
  res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour for historical
}
```

### Step 7: Handle Errors Gracefully

Use `Promise.allSettled` for multi-source reports to avoid total failure:

```typescript
const [orderResult, quoteResult, resResult] = await Promise.allSettled([
  fetchOrders(token, date),
  fetchQuotes(token, date),
  fetchReservations(gmailToken, date)
]);

const errors: string[] = [];
const orders = orderResult.status === "fulfilled" ? orderResult.value : { rows: [], ci: {} };
if (orderResult.status === "rejected") {
  errors.push("Orders: " + orderResult.reason?.message);
}
// Include errors array in response for transparency
```

---

## Output Format Reference

| Format | Library | Use Case | File |
|--------|---------|----------|------|
| JSON | Native | API responses, dashboards | `api/summary.ts` |
| PDF | PDFKit | Email reports, printable documents | `api/cron-daily-report.ts` |
| HTML | Express static | Interactive dashboards | `src/dashboard-server.ts` |
| Email | Gmail API | Automated delivery | `api/send-email.ts` |

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| ColumnIndex is undefined | Older API response format | Use hardcoded fallback indices (e.g., `ci.Total ?? 44`) |
| Empty Rows array | No data matches filters | Verify date format, warehouse spelling, entity name |
| `NaN` in revenue totals | Non-numeric values in Total column | Wrap in `Number(value) \|\| 0` |
| PDF generation fails | Missing font or malformed data | Use standard fonts (Helvetica); sanitize text inputs |
| Report email not received | Gmail API token expired | Refresh OAuth token; check `GOOGLE_REFRESH_TOKEN` |
| Browse returns 500 | Entity has known browse bug | Use GET by ID if entity is in broken list (item, rentalinventory, etc.) |

---

## Related SOPs

- [SOP-09.01: API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) — API setup
- [SOP-09.02: Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) — Data extraction
- [SOP-09.06: Summary Reporting API](SOP-09.06-summary-reporting-api.md) — Multi-day report example
- [SOP-09.08: Building Automated Workflows](SOP-09.08-building-automated-workflows.md) — Deployment and scheduling
- [SOP-10.04: Order/Quote Summary Reporting](../10-reporting-analytics/SOP-10.04-order-quote-summary-reporting.md) — Business use of reports
