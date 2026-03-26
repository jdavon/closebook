# SOP-09.01: RentalWorks API Overview & Authentication (JWT)

| Field | Value |
|-------|-------|
| **SOP #** | 09.01 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

This SOP documents the RentalWorks REST API architecture, base URL, and JWT-based authentication flow. The RentalWorks API has no official public documentation; all endpoint details have been reverse-engineered from network traffic captured in the RentalWorks Web browser application. This document serves as the foundational reference for all API-related SOPs in this category.

---

## Scope

- Applies to all developers and managers who need to interact with the RentalWorks API programmatically
- Covers the authentication lifecycle: login, token usage, session validation, and token refresh
- Provides the foundational context referenced by all other SOP-09 documents

---

## Prerequisites

- [ ] Access to the RentalWorks Web application at `https://hdr.rentalworks.cloud`
- [ ] Valid RentalWorks user credentials (username and password)
- [ ] Environment variables configured: `RW_BASE_URL`, `RW_USERNAME`, `RW_PASSWORD`
- [ ] Node.js / TypeScript development environment (for using `RentalWorksClient.ts`)
- [ ] Understanding of REST APIs, HTTP headers, and JSON payloads

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)


> **Navigation:** API integration SOPs reference the RentalWorks REST API
> **API Base URL:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT token via `POST /api/v1/jwt` with email and password
> **Common Patterns:** `POST /entity/browse` for search, `GET /entity/{id}` for individual records, `POST /entity` for creation

---

## API Overview

### Base URL

| Detail | Value |
|--------|-------|
| **Production URL** | `https://hdr.rentalworks.cloud` |
| **API Base Path** | `/api/v1` |
| **Full API Base** | `https://hdr.rentalworks.cloud/api/v1` |
| **System** | Database Works RentalWorks Web |

### Required Headers (All Requests)

| Header | Value | Notes |
|--------|-------|-------|
| `Content-Type` | `application/json` | Required for all POST/PUT requests |
| `x-requested-with` | `XMLHttpRequest` | **Required for all requests** — API rejects without this |
| `Authorization` | `Bearer {access_token}` | Required after authentication |

### Implementation Reference

The TypeScript client is located at `src/RentalWorksClient.ts`. The constructor configures an axios instance with the base URL and required headers, and uses a request interceptor to attach the Bearer token automatically.

---

## Procedure

### Step 1: Configure Environment Variables

Create a `.env` file (for local development) or configure environment variables in your deployment platform (Vercel project settings for production).

Required variables:

```
RW_BASE_URL=https://hdr.rentalworks.cloud
RW_USERNAME=your_username
RW_PASSWORD=your_password
```

> **Note:** The password may contain special characters. When loading from `.env`, use `require('dotenv').config()` or `import 'dotenv/config'` to handle these correctly.

### Step 2: Authenticate (Obtain JWT Token)

Send a POST request to the JWT endpoint with your credentials.

| Detail | Value |
|--------|-------|
| **Endpoint** | `POST /api/v1/jwt` |
| **Auth** | None (this is the login endpoint) |

**Request:**
```json
{
  "UserName": "your_username",
  "Password": "your_password"
}
```

**Response (Success):**
```json
{
  "statuscode": 0,
  "statusmessage": "Success",
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `statuscode` | number | 0 indicates success |
| `statusmessage` | string | Human-readable status |
| `access_token` | string | JWT token for subsequent requests |
| `token_type` | string | Always "Bearer" |
| `expires_in` | number | Token lifetime in seconds |

### Step 3: Use the Token for API Requests

Attach the token to all subsequent requests via the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

All requests must also include:

```
x-requested-with: XMLHttpRequest
Content-Type: application/json
```

### Step 4: Validate an Existing Session

Before making API calls, validate that your token is still active.

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/v1/account/session` |
| **Auth** | Bearer JWT |

A successful response confirms the session is valid. A 401 or 403 response means the token has expired and you must re-authenticate.

### Step 5: Handle Token Expiry (Re-Authentication)

Tokens expire after the duration specified in `expires_in`. When a request returns HTTP 401 or 403:

1. Discard the current token
2. Re-authenticate using Step 2
3. Retry the failed request with the new token

The recommended pattern (from `src/dashboard-server.ts`) is:

```typescript
async function ensureAuth() {
  try {
    await client.checkSession();
  } catch {
    await client.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);
  }
}
```

> **Decision Point:**
> - **IF** `checkSession()` succeeds **THEN** proceed with existing token
> - **IF** `checkSession()` throws (401/403) **THEN** call `login()` to obtain a new token

### Step 6: Using the RentalWorksClient Class

For TypeScript projects, use the client class directly:

```typescript
import { RentalWorksClient } from "./RentalWorksClient";

const client = new RentalWorksClient(process.env.RW_BASE_URL!);
await client.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

// Token is now stored internally and auto-attached to all requests
const orders = await client.getOrders({ pagesize: 10 });
```

Alternatively, pass an existing token to the constructor:

```typescript
const client = new RentalWorksClient(baseUrl, existingToken);
```

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| 401 Unauthorized | Token expired or invalid | Re-authenticate via `POST /api/v1/jwt` |
| 403 Forbidden | Insufficient permissions or missing `x-requested-with` header | Verify the `x-requested-with: XMLHttpRequest` header is present |
| Login returns non-zero `statuscode` | Invalid credentials | Verify `RW_USERNAME` and `RW_PASSWORD` environment variables |
| `ECONNREFUSED` or network timeout | API server unreachable | Check `RW_BASE_URL` value; verify network/VPN connectivity |
| Special characters in password cause issues | Password not properly escaped | Use `dotenv` library to load `.env` file rather than manual string interpolation |
| Token works initially then stops | Token expired after `expires_in` seconds | Implement the `ensureAuth()` pattern to auto-refresh |

---

## Related SOPs

- [SOP-09.02: API Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) -- Search and filter records via browse endpoints
- [SOP-09.03: API CRUD Operations](SOP-09.03-api-crud-operations.md) -- Create, read, update, and delete records
- [SOP-09.07: API Error Handling & Session Management](SOP-09.07-api-error-handling-session-management.md) -- Comprehensive error handling and session lifecycle
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) -- Security and performance guidelines
