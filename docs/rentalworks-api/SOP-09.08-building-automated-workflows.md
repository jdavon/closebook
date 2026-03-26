# SOP-09.08: Building New Automated Workflows

| Field | Value |
|-------|-------|
| **SOP #** | 09.08 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team |

---

## Purpose

Provides a guide for building new automated workflows that integrate with RentalWorks and other business systems. This SOP documents the current automation stack, deployment patterns, and best practices for creating new serverless functions on the Vercel platform.

---

## Scope

Applies to the internal development team when creating new automated processes such as scheduled reports, data synchronization tasks, notification systems, or custom integrations. Assumes familiarity with TypeScript, Node.js, and the Vercel platform.

---

## Prerequisites

- [ ] Access to the project Git repository
- [ ] Vercel account with project access
- [ ] Understanding of RentalWorks API (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Environment variables configured (local `.env` and Vercel project settings)
- [ ] Node.js and npm installed locally for development
- [ ] Gmail API OAuth credentials (if email functionality needed)

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API (No UI Screen)
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** Vercel serverless function development patterns for automated workflows integrating with RentalWorks API

---

## Procedure

### Step 1: Understand the Current Automation Stack

The project uses the following technology stack:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Vercel Serverless Functions | Hosts API routes and cron jobs |
| Language | TypeScript | Type-safe development |
| API Client | `src/RentalWorksClient.ts` | RentalWorks REST API wrapper |
| Email | Gmail API (OAuth 2.0) | Sending notifications and reports |
| PDF Generation | PDFKit | Creating formatted report documents |
| XLSX Parsing | SheetJS (xlsx) | Reading Thermeon reservation spreadsheets |
| Scheduling | Vercel Crons | Automated task execution |

### Step 2: Review Existing Workflows

Current automated workflows to reference as patterns:

| Workflow | File | Trigger | Description |
|----------|------|---------|-------------|
| Daily Report | `api/cron-daily-report.ts` | Cron (2 AM UTC daily) | Fetches orders/quotes/reservations, generates PDF, emails to team |
| Reservations API | `api/reservations.ts` | HTTP GET | Parses Thermeon XLSX from Gmail, returns reservation data |
| Summary API | `api/summary.ts` | HTTP GET | Multi-day aggregation of orders, quotes, and reservations |
| Email Sender | `api/send-email.ts` | HTTP POST | Generic email sending with PDF attachment support |
| SOP Content | `api/sop-content.ts` | HTTP GET | Serves SOP markdown files for the wiki viewer |

### Step 3: Create a New Serverless Function

1. Create a new TypeScript file in the `api/` directory:
   ```
   api/your-workflow-name.ts
   ```

2. Use the standard Vercel handler signature:
   ```typescript
   import type { VercelRequest, VercelResponse } from "@vercel/node";

   export default async function handler(req: VercelRequest, res: VercelResponse) {
     // Set CORS headers if needed
     res.setHeader("Access-Control-Allow-Origin", "*");
     res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
     res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

     if (req.method === "OPTIONS") return res.status(200).end();

     try {
       // Your workflow logic here
       return res.status(200).json({ success: true });
     } catch (err: any) {
       console.error("Workflow error:", err);
       return res.status(500).json({ error: err.message || "Internal error" });
     }
   }
   ```

3. The function is automatically available at `/api/your-workflow-name` after deployment.

### Step 4: Integrate with RentalWorks API

Use the RentalWorksClient for data access:

```typescript
import { RentalWorksClient } from "../src/RentalWorksClient";

const client = new RentalWorksClient(process.env.RW_BASE_URL!);
await client.login(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

// Browse orders
const orders = await client.getOrders({
  pagesize: 1000,
  searchfields: ["Warehouse"],
  searchfieldoperators: ["="],
  searchfieldvalues: ["VERSATILE - CAHUENGA"],
});

// Get specific record
const order = await client.getOrder("some-order-id");
```

### Step 5: Add Email Notifications (Optional)

Follow the Gmail OAuth pattern from `api/cron-daily-report.ts`:

1. Get access token using refresh token
2. Build MIME email with optional PDF attachment
3. Send via Gmail API `messages/send` endpoint

Required environment variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GMAIL_FROM_ADDRESS`

### Step 6: Add Cron Scheduling (Optional)

To schedule automatic execution, add an entry to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/your-workflow-name",
      "schedule": "0 14 * * 1-5"
    }
  ]
}
```

Common cron schedules:
| Schedule | Expression | Description |
|----------|-----------|-------------|
| Daily at 2 AM UTC | `0 2 * * *` | Current daily report schedule |
| Weekdays at 7 AM PST | `0 15 * * 1-5` | Business hours start |
| Every Monday at 8 AM PST | `0 16 * * 1` | Weekly summary |
| Every hour | `0 * * * *` | Frequent monitoring |

**Security for cron endpoints:** Protect with `CRON_SECRET`:
```typescript
const authHeader = req.headers["authorization"];
const cronSecret = process.env.CRON_SECRET;
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  return res.status(401).json({ error: "Unauthorized" });
}
```

### Step 7: Configure Environment Variables

**Local development:** Add variables to `.env` file:
```
RW_BASE_URL=https://hdr.rentalworks.cloud
RW_USERNAME=your_username
RW_PASSWORD=your_password
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

**Production (Vercel):** Set in Vercel project settings → Environment Variables. Never commit `.env` to version control.

### Step 8: Test Locally

```bash
# Install dependencies
npm install

# Run local development server
npx vercel dev
```

The function will be available at `http://localhost:3000/api/your-workflow-name`.

### Step 9: Deploy to Vercel

```bash
# Deploy to preview
npx vercel

# Deploy to production
npx vercel --prod
```

Deployment configuration in `vercel.json`:
```json
{
  "buildCommand": "",
  "outputDirectory": "public",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/$1" }]
}
```

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| Function timeout (10s) | Long-running API calls | Batch requests, reduce data volume, use Vercel Pro for 60s limit |
| `MODULE_NOT_FOUND` | Missing dependency | Run `npm install` and ensure package is in `package.json` |
| Environment variable undefined | Not set in Vercel | Add to Vercel project settings → Environment Variables |
| CORS errors in browser | Missing CORS headers | Add `Access-Control-Allow-Origin` headers to handler |
| Gmail token refresh fails | Expired refresh token | Re-authorize OAuth flow, update `GOOGLE_REFRESH_TOKEN` |
| Cron not triggering | Incorrect schedule or path | Verify `vercel.json` crons config; check Vercel dashboard logs |

---

## Related SOPs

- [SOP-09.01: API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) — Authentication setup
- [SOP-09.02: Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) — Querying data
- [SOP-09.06: Summary Reporting API](SOP-09.06-summary-reporting-api.md) — Existing workflow example
- [SOP-09.07: Error Handling & Session Management](SOP-09.07-api-error-handling-session-management.md) — Error patterns
- [SOP-09.09: Building Custom Reports](SOP-09.09-building-custom-reports.md) — Report-specific workflows
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) — Performance guidelines
