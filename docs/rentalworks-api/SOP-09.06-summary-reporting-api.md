# SOP-09.06: Summary Reporting API Usage

| Field | Value |
|-------|-------|
| **SOP #** | 09.06 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Manager / Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

This SOP documents the Summary Reporting API, a Vercel serverless function that aggregates data from three sources -- RentalWorks Orders, RentalWorks Quotes, and Thermeon Reservations -- across a date range. It provides a unified view of daily activity with revenue totals, status breakdowns, and top customer rankings. This is the primary endpoint used for multi-day business intelligence and reporting.

---

## Scope

- Applies to developers and managers who consume or maintain the summary reporting endpoint
- Covers the API contract, data sources, aggregation logic, caching strategy, and error handling
- Implementation file: `api/summary.ts` (Vercel serverless function)

---

## Prerequisites

- [ ] Valid RentalWorks JWT token (passed as a query parameter)
- [ ] Vercel deployment with all required environment variables
- [ ] Understanding of the browse endpoint (see [SOP-09.02](SOP-09.02-api-browse-endpoint-usage.md))

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API + Custom Reporting
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** Summary endpoint (`api/summary.ts`) aggregating Orders, Quotes, and Thermeon Reservations

---

## Procedure

### Step 1: Understand the API Contract

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/summary` |
| **Deployment** | Vercel serverless function |
| **Auth** | RW token passed as query parameter |

**Query Parameters:**

| Parameter | Required | Format | Description |
|-----------|----------|--------|-------------|
| `start` | Yes | `YYYY-MM-DD` | Start date of the range |
| `end` | Yes | `YYYY-MM-DD` | End date of the range |
| `token` | Yes | JWT string | RentalWorks Bearer token |

**Constraints:**
- Date range must not exceed 31 days
- Both dates must be in `YYYY-MM-DD` format
- Token must be a valid, non-expired RW JWT

**Example Request:**

```
GET /api/summary?start=2026-02-01&end=2026-02-17&token=eyJhbGciOi...
```

### Step 2: Understand the Data Sources

The summary endpoint combines three independent data sources:

| Source | API Call | Filter |
|--------|----------|--------|
| **RW Orders** | `POST /api/v1/order/browse` | Warehouse + OrderDate per day |
| **RW Quotes** | `POST /api/v1/quote/browse` | Warehouse + QuoteDate per day |
| **Thermeon Reservations** | Gmail API (XLSX parsing) | Email date per day |

All data is filtered to the `VERSATILE - CAHUENGA` warehouse by default.

### Step 3: Understand the Batch Processing Strategy

Dates in the range are processed in batches of 5 concurrent requests to avoid overloading the API:

```typescript
const dayResults = await batchProcess(dates, async (date) => {
  const [orderResult, quoteResult, cpResult] = await Promise.allSettled([
    fetchRwOrders(rwToken, date),
    fetchRwQuotes(rwToken, date),
    gmailToken ? fetchCpReservations(gmailToken, date) : Promise.resolve([])
  ]);
  return { date, orderRows, orderCi, quoteRows, quoteCi, reservations };
}, 5);
```

The `batchProcess()` utility:
- Processes items in groups of `concurrency` (default 5)
- Uses `Promise.allSettled()` within each batch so individual failures do not block others
- Returns `null` for failed items

### Step 4: Understand the Response Structure

**SummaryResponse Interface:**

```json
{
  "dateRange": {
    "start": "2026-02-01",
    "end": "2026-02-17"
  },
  "days": {
    "2026-02-01": {
      "orders": { "count": 5, "revenue": 12500.00, "byStatus": { "CONFIRMED": 2, "ACTIVE": 3 } },
      "quotes": { "count": 3, "revenue": 8000.00, "byStatus": { "ACTIVE": 2, "PROSPECT": 1 } },
      "reservations": { "count": 4, "revenue": 1800.00, "byStatus": { "CONFIRMED": 4 } }
    }
  },
  "totals": {
    "orders": { "count": 85, "revenue": 212500.00 },
    "quotes": { "count": 51, "revenue": 136000.00 },
    "reservations": { "count": 68, "revenue": 30600.00 }
  },
  "topCustomers": [
    { "name": "ACME Productions", "orderRevenue": 45000.00, "reservationRevenue": 5400.00, "total": 50400.00 }
  ],
  "errors": []
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `dateRange` | object | The requested start and end dates |
| `days` | Record<string, DaySummary> | Per-day breakdown of orders, quotes, and reservations |
| `totals` | object | Aggregate counts and revenue across the full date range |
| `topCustomers` | array | Top 10 customers sorted by total revenue (orders + reservations) |
| `errors` | string[] | Partial failure messages (individual day/source failures) |

### Step 5: Understand the Aggregation Logic

**Per-Day Aggregation:**

For each date, the endpoint:
1. Fetches order rows and maps Total/Status/Customer using `ColumnIndex`
2. Fetches quote rows and maps Total/Status using `ColumnIndex`
3. Fetches reservations and extracts total/status from the parsed data
4. Groups counts by status for each data source
5. Sums revenue for each data source

**Top Customers:**

Customer revenue is tracked across both RW orders and Thermeon reservations:

```typescript
const topCustomers = Object.entries(customerRevenue)
  .map(([name, rev]) => ({
    name,
    orderRevenue: rev.orderRevenue,
    reservationRevenue: rev.reservationRevenue,
    total: rev.orderRevenue + rev.reservationRevenue
  }))
  .sort((a, b) => b.total - a.total)
  .slice(0, 10);
```

### Step 6: Understand the Caching Strategy

| Scenario | Cache-Control Header | TTL |
|----------|---------------------|-----|
| Date range includes today | `public, max-age=300` | 5 minutes |
| Date range is historical only | `public, max-age=3600` | 1 hour |

Current-period data uses a shorter TTL because new orders/quotes/reservations may arrive throughout the day. Historical data is stable and can be cached longer.

### Step 7: Understand Error Handling

The endpoint uses graceful degradation:

- **Auth Expiry:** If any RW API call returns `AUTH_EXPIRED`, the endpoint returns HTTP 401 with `{ authError: true }`. The client should re-authenticate and retry.
- **Partial Failures:** Individual day or source failures are captured in the `errors` array but do not cause the entire request to fail. Missing data for a failed day shows as zeros.
- **Gmail Auth Failure:** If Gmail token refresh fails, reservation data is skipped for all dates, but orders and quotes still return.
- **Validation Errors:** Missing parameters or invalid date formats return HTTP 400 with a descriptive error message.

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| 400: "Missing required params" | `start`, `end`, or `token` not provided | Include all three query parameters |
| 400: "Invalid date format" | Date not in `YYYY-MM-DD` format | Use ISO date format |
| 400: "Date range exceeds 31 days" | Range is too large | Break into smaller ranges |
| 401: "RentalWorks session expired" | RW JWT token expired | Re-authenticate with RW and pass new token |
| `errors` array contains "Gmail auth failed" | Gmail refresh token expired | Re-authorize Google OAuth and update credentials |
| `errors` array contains day-specific errors | Individual day fetch failed | Check RW API availability; the endpoint will still return partial data |
| Revenue totals seem low | Some days returned null due to batch failures | Check the `errors` array for partial failure messages |
| Empty `topCustomers` array | No customer data matched for the date range | Verify the date range contains actual orders or reservations |

---

## Related SOPs

- [SOP-09.01: RentalWorks API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) -- RW authentication for the token parameter
- [SOP-09.02: API Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) -- Browse endpoint structure used internally
- [SOP-09.07: API Error Handling & Session Management](SOP-09.07-api-error-handling-session-management.md) -- Error handling patterns
- [SOP-09.09: Building Custom Reports](SOP-09.09-building-custom-reports.md) -- Using summary data for custom reports
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) -- Batching and concurrency patterns

---

## API Reference

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/summary` |
| **Auth** | RW JWT via `token` query parameter |
| **CORS** | `Access-Control-Allow-Origin: *` |

**Request:**
```
GET /api/summary?start=2026-02-01&end=2026-02-17&token=eyJhbGciOi...
```

**Response:**
```json
{
  "dateRange": { "start": "2026-02-01", "end": "2026-02-17" },
  "days": { "2026-02-01": { "orders": {}, "quotes": {}, "reservations": {} } },
  "totals": { "orders": {}, "quotes": {}, "reservations": {} },
  "topCustomers": [],
  "errors": []
}
```
