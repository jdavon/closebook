# SOP-09.07: API Error Handling & Session Management

| Field | Value |
|-------|-------|
| **SOP #** | 09.07 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

This SOP documents the error handling patterns, session management strategies, and resilience techniques used across the RentalWorks API integration codebase. Because the RW API has no official documentation and no standardized error schema, understanding the observed error patterns and the implemented workarounds is essential for maintaining reliable integrations.

---

## Scope

- Applies to all developers building or maintaining integrations with the RentalWorks API
- Covers HTTP error codes, token lifecycle management, known broken endpoints, CORS configuration, and retry strategies
- Documents patterns observed across: `src/RentalWorksClient.ts`, `src/dashboard-server.ts`, `api/summary.ts`, `api/cron-daily-report.ts`

---

## Prerequisites

- [ ] Understanding of RW API authentication (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Familiarity with HTTP status codes and REST API conventions
- [ ] Access to the codebase for reviewing error handling patterns

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API (No UI Screen)
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** Cross-cutting error handling and session management patterns across all API endpoints

---

## Procedure

### Step 1: Understand Common HTTP Error Codes

| HTTP Status | Meaning | When It Occurs | Recommended Action |
|-------------|---------|----------------|-------------------|
| 200 | Success | Normal response | Process the response data |
| 400 | Bad Request | Malformed payload, missing required fields | Fix the request payload |
| 401 | Unauthorized | JWT token expired or invalid | Re-authenticate via `POST /api/v1/jwt` |
| 403 | Forbidden | Missing `x-requested-with` header or insufficient permissions | Verify headers; check user permissions |
| 404 | Not Found | Invalid entity name or record ID | Verify entity name casing and record ID |
| 500 | Internal Server Error | Server-side issue (common for broken endpoints) | Check the known broken entities list; use alternative endpoints |

> **Important:** The RW API does not have a standardized error response schema. Error response bodies vary by endpoint and may be plain text, JSON, or empty.

### Step 2: Implement the Token Lifecycle

The JWT token lifecycle follows this pattern:

```
Login (POST /jwt)
    |
    v
Use Token (Authorization: Bearer {token})
    |
    v
Token Valid? ──Yes──> Continue requests
    |
    No (401/403)
    |
    v
Re-Login (POST /jwt)
    |
    v
Retry failed request with new token
```

### Step 3: Implement the ensureAuth() Pattern

The recommended authentication pattern (from `src/dashboard-server.ts`):

```typescript
async function ensureAuth() {
  try {
    await client.checkSession();   // GET /api/v1/account/session
  } catch {
    await client.login(            // POST /api/v1/jwt
      process.env.RW_USERNAME!,
      process.env.RW_PASSWORD!
    );
  }
}
```

Call `ensureAuth()` before any batch of API operations. This avoids unnecessary re-logins when the token is still valid while automatically refreshing when it has expired.

### Step 4: Handle Auth Expiry in Serverless Functions

For Vercel serverless functions where the RW token is passed as a parameter (e.g., `api/summary.ts`), implement auth expiry detection:

```typescript
async function fetchRwOrders(rwToken: string, date: string) {
  const res = await fetch(RW_API + "/order/browse", {
    method: "POST",
    headers: rwHeaders(rwToken),
    body: JSON.stringify({ /* ... */ })
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!res.ok) {
    throw new Error("RW order API error " + res.status);
  }
  return res.json();
}
```

At the handler level, catch `AUTH_EXPIRED` and return a 401 with an `authError` flag:

```typescript
catch (err) {
  if (err.message === "AUTH_EXPIRED") {
    return res.status(401).json({ error: "RentalWorks session expired", authError: true });
  }
}
```

The client application can then detect `authError: true` and prompt the user to re-authenticate.

### Step 5: Handle Known Broken Browse Endpoints

The following browse endpoints consistently return HTTP 500:

| Entity | Endpoint | Workaround |
|--------|----------|------------|
| `rentalinventory` | `/api/v1/rentalinventory/browse` | Use `GET /api/v1/rentalinventory/{id}` if ID is known |
| `item` | `/api/v1/item/browse` | Use `GET /api/v1/item/{id}` if ID is known |
| `physicalinventory` | `/api/v1/physicalinventory/browse` | Use `GET /api/v1/physicalinventory/{id}` if ID is known |
| `container` | `/api/v1/container/browse` | Use `GET /api/v1/container/{id}` if ID is known |

> **Decision Point:**
> - **IF** you need to list/search records for a broken entity **THEN** find IDs through a related entity (e.g., order items link to inventory IDs) and use GET by ID
> - **IF** you need full browse functionality **THEN** this is a known RW server limitation; no client-side fix is available

### Step 6: Implement Graceful Degradation with Promise.allSettled

When fetching from multiple sources, use `Promise.allSettled()` to prevent a single failure from blocking all results:

```typescript
const [orderResult, quoteResult, resResult] = await Promise.allSettled([
  fetchOrders(rwToken, today),
  fetchQuotes(rwToken, today),
  fetchReservations(gmailToken, today)
]);

const orders = orderResult.status === "fulfilled" ? orderResult.value : emptyResult;
const quotes = quoteResult.status === "fulfilled" ? quoteResult.value : emptyResult;
const reservations = resResult.status === "fulfilled" ? resResult.value : [];

const warnings: string[] = [];
if (orderResult.status === "rejected") warnings.push("Orders: " + orderResult.reason?.message);
if (quoteResult.status === "rejected") warnings.push("Quotes: " + quoteResult.reason?.message);
if (resResult.status === "rejected") warnings.push("Reservations: " + resResult.reason?.message);
```

This pattern is used in both `api/summary.ts` and `api/cron-daily-report.ts`.

### Step 7: Configure CORS Headers for Vercel Functions

All Vercel serverless functions must include CORS headers for browser-based clients:

```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
```

### Step 8: Implement Error Logging

Always log API errors with context for debugging:

```typescript
catch (err: any) {
  console.error("API error:", err.response?.status, err.response?.data ?? err.message);
  res.status(500).json({ error: err.message });
}
```

For the cron daily report, include the response body in error messages:

```typescript
if (!res.ok) {
  const errBody = await res.text();
  throw new Error("RW order API error " + res.status + ": " + errBody);
}
```

### Step 9: Handle Network-Level Errors

| Error Type | Cause | Handling |
|------------|-------|----------|
| `ECONNREFUSED` | API server unreachable | Check network connectivity and `RW_BASE_URL` |
| `ETIMEDOUT` | Request timed out | Implement timeout in axios config; retry once |
| `ENOTFOUND` | DNS resolution failed | Check `RW_BASE_URL` for typos |
| `ERR_SOCKET_TIMEOUT` | Connection hung | Check API server health; reduce request payload size |

---

## Session Validation Reference

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/v1/account/session` |
| **Auth** | Bearer JWT |
| **Success** | Returns session info (token is valid) |
| **Failure** | 401/403 (token expired, must re-login) |

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| 401 on all requests | Token expired | Re-authenticate via `POST /api/v1/jwt` |
| 403 despite valid token | Missing `x-requested-with: XMLHttpRequest` header | Add the required header to all requests |
| 500 on browse for certain entities | Known broken browse endpoints | Use GET by ID as a workaround |
| Intermittent 500 errors | RW server under load or experiencing issues | Implement retry with exponential backoff |
| `authError: true` in summary response | RW token passed to summary endpoint expired | Client should re-authenticate and retry the summary request |
| Gmail auth failures alongside RW errors | Multiple auth systems failing independently | Check each auth system independently; partial data may still be available |
| CORS errors in browser | Missing `Access-Control-Allow-*` headers | Verify all Vercel functions include CORS headers |

---

## Related SOPs

- [SOP-09.01: RentalWorks API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) -- Authentication flow and token management
- [SOP-09.02: API Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) -- Browse-specific errors and broken endpoints
- [SOP-09.03: API CRUD Operations](SOP-09.03-api-crud-operations.md) -- CRUD-specific error handling
- [SOP-09.06: Summary Reporting API](SOP-09.06-summary-reporting-api.md) -- Graceful degradation example
- [SOP-09.08: Building Automated Workflows](SOP-09.08-building-automated-workflows.md) -- Error handling in cron jobs
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) -- Rate limiting and batching to reduce errors
