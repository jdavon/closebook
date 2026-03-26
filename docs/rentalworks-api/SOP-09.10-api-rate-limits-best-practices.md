# SOP-09.10: API Rate Limits & Best Practices

| Field | Value |
|-------|-------|
| **SOP #** | 09.10 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team |

---

## Purpose

Documents the known API behavior, rate limiting considerations, and best practices for working with the RentalWorks API. Since the API has no official public documentation (it was reverse-engineered), this SOP captures institutional knowledge about reliable patterns and known pitfalls.

---

## Scope

Applies to all developers and automated systems that interact with the RentalWorks API. This includes the API client library, serverless functions, cron jobs, and any future integrations.

---

## Prerequisites

- [ ] Familiarity with the RentalWorks API (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Access to the project codebase

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API (No UI Screen)
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** Cross-cutting API usage guidelines, rate limiting observations, and reliability best practices

---

## Procedure

### Step 1: Understand Rate Limiting Status

**No official rate limits are documented.** The API was reverse-engineered from RentalWorks Web browser traffic, and Database Works does not publish rate limit information.

Observed behavior:
- No `X-RateLimit-*` headers in responses
- No `429 Too Many Requests` responses observed
- Large batch requests (1000 records) succeed consistently
- Concurrent requests from multiple sources have not caused issues

**However**, best practices should still be followed to avoid overloading the server or hitting undocumented limits.

### Step 2: Follow Authentication Best Practices

| Practice | Details |
|----------|---------|
| Login once, reuse token | Don't login before every request; cache the token |
| Refresh on 401 | When a request returns 401, login again and retry |
| Use `ensureAuth` pattern | Try `checkSession()` first, login only if it fails |
| Never expose tokens | Don't put JWT tokens in URLs, logs, or client-side code |
| Use environment variables | Store credentials in `.env` (local) or Vercel settings (production) |

```typescript
// Good: ensureAuth pattern
async function ensureAuth() {
  try {
    await client.checkSession();
  } catch {
    await client.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);
  }
}
```

### Step 3: Follow Request Best Practices

**Entity Names are Case-Sensitive:**
| Correct | Incorrect |
|---------|-----------|
| `customer` | `Customer` |
| `order` | `Order` |
| `Deal` | `deal` |
| `warehouse` | `Warehouse` |

> **Note:** Most entities are lowercase, but `Deal` is capitalized. Always verify by testing.

**Required Headers for All Requests:**
```typescript
{
  "Content-Type": "application/json",
  "Authorization": "Bearer {token}",
  "x-requested-with": "XMLHttpRequest"  // Required! API rejects requests without this
}
```

**Browse Field Arrays Must Be Parallel:**
```typescript
// CORRECT: All arrays are the same length (2)
searchfields: ["Warehouse", "OrderDate"],
searchfieldoperators: ["=", "="],
searchfieldvalues: ["VERSATILE - CAHUENGA", "2026-02-17"],
searchfieldtypes: ["", "date"],
searchseparators: ["", ""],
searchcondition: ["", ""]

// INCORRECT: Mismatched lengths will cause errors
searchfields: ["Warehouse", "OrderDate"],
searchfieldoperators: ["="],  // Only 1 item!
```

### Step 4: Optimize Data Fetching

**Pagination:**
- Default `pagesize` is 25
- Maximum tested: `pagesize: 1000` works reliably
- Use `pageno` for sequential pagination
- `TotalRows` and `TotalPages` in response help determine if more pages exist

**Batch Concurrent Requests:**
```typescript
// Good: Batch with concurrency limit
const results = await batchProcess(dates, fetchData, 5); // 5 concurrent

// Bad: Unbounded concurrency
const results = await Promise.all(dates.map(fetchData)); // Could overwhelm server
```

**Prefer Browse Over Individual GETs:**
- One browse request with `pagesize: 1000` is faster than 1000 individual GET requests
- Use browse for bulk data access, GET by ID only for detailed records

### Step 5: Handle Known API Issues

**Broken Browse Endpoints (Return 500):**

| Entity | Browse Status | Workaround |
|--------|--------------|------------|
| `rentalinventory` | ❌ 500 Error | Use `GET /rentalinventory/{id}` if ID is known |
| `item` | ❌ 500 Error | Use `GET /item/{id}` if ID is known |
| `physicalinventory` | ❌ 500 Error | Use RentalWorks Web UI for physical inventory data |
| `container` | ❌ 500 Error | Use RentalWorks Web UI |

**Browse Returns Positional Arrays, Not Objects:**
- Use `ColumnIndex` from the response to map field positions
- Always provide hardcoded fallback indices in case `ColumnIndex` is absent:
  ```typescript
  const totalIdx = result.ColumnIndex?.Total ?? 44;
  ```

**No Standardized Error Schema:**
- Error responses vary by endpoint
- Always check HTTP status code first
- Parse response body as JSON, but be prepared for non-JSON error responses

### Step 6: Implement Resilient Error Handling

```typescript
// Pattern 1: Retry on auth failure
async function fetchWithRetry(fn: () => Promise<any>, maxRetries = 1) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.response?.status === 401 && attempt < maxRetries) {
        await client.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);
        continue;
      }
      throw err;
    }
  }
}

// Pattern 2: Graceful degradation with Promise.allSettled
const [orders, quotes, reservations] = await Promise.allSettled([
  fetchOrders(token, date),
  fetchQuotes(token, date),
  fetchReservations(gmailToken, date)
]);
// Process fulfilled results, log rejected ones
```

### Step 7: Monitoring and Logging

| What to Log | Why |
|-------------|-----|
| API response status codes | Detect new errors or endpoint changes |
| Response times | Identify performance degradation |
| Token refresh events | Track session lifecycle |
| Data counts (rows returned) | Detect unexpected data changes |
| Error messages and stack traces | Debugging |

```typescript
console.log(`Data: ${orders.rows.length} orders, ${quotes.rows.length} quotes`);
console.error("API error:", err.response?.status, err.response?.data ?? err.message);
```

### Step 8: Avoid Anti-Patterns

| Anti-Pattern | Why It's Bad | Better Approach |
|-------------|-------------|-----------------|
| Polling every minute | Unnecessary server load | Use cron jobs at appropriate intervals |
| Login before every request | Wasteful; creates extra sessions | Cache token, refresh on 401 |
| Ignoring 500 errors on browse | May indicate a legitimate bug | Log and use fallback data sources |
| Hardcoding column indices only | Positions may change with API updates | Use ColumnIndex with hardcoded fallbacks |
| Storing tokens in localStorage | Security risk for client-side apps | Use server-side token management |
| Unbounded `Promise.all()` | Can overwhelm API server | Use `batchProcess()` with concurrency limit |

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| 401 Unauthorized | JWT token expired | Re-authenticate via `POST /jwt` |
| 403 Forbidden | Insufficient permissions | Verify user account has required module access |
| 500 Internal Server Error | Broken endpoint or bad request | Check if entity is in known-broken list; verify request payload |
| Network timeout | Slow response from RW server | Implement timeout (10-30s); retry once |
| `x-requested-with` missing error | Header not included | Always add `x-requested-with: XMLHttpRequest` |
| Empty ColumnIndex | Occasional API inconsistency | Use hardcoded fallback indices |
| CORS error | Browser direct API call | Route through server-side proxy (Vercel function) |

---

## Related SOPs

- [SOP-09.01: API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) — Authentication details
- [SOP-09.02: Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) — Browse patterns
- [SOP-09.03: CRUD Operations](SOP-09.03-api-crud-operations.md) — Entity operations
- [SOP-09.07: Error Handling & Session Management](SOP-09.07-api-error-handling-session-management.md) — Error handling details
- [SOP-09.08: Building Automated Workflows](SOP-09.08-building-automated-workflows.md) — Workflow development
