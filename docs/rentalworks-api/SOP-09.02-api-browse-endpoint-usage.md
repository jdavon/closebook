# SOP-09.02: API Browse Endpoint Usage (Search & Filter)

| Field | Value |
|-------|-------|
| **SOP #** | 09.02 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

This SOP documents how to use the RentalWorks browse endpoints to search, filter, sort, and paginate records. Browse endpoints are the primary mechanism for listing and searching data in RentalWorks. Understanding the browse request/response structure is critical because browse responses return **positional arrays** (not named objects), which requires using a ColumnIndex mapping to interpret results.

---

## Scope

- Applies to all developers building integrations or reports that query RentalWorks data
- Covers the BrowseRequest payload structure, filtering, sorting, pagination, and response interpretation
- Documents known working and known broken browse entities

---

## Prerequisites

- [ ] Authenticated RentalWorks API session (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Understanding of the RentalWorksClient class (`src/RentalWorksClient.ts`)
- [ ] Familiarity with positional array data structures

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API (No UI Screen)
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** All browse-capable entities (Customer, Order, Quote, Deal, Warehouse, Contract, Purchase Order)

---

## Procedure

### Step 1: Identify the Entity to Browse

Browse endpoints follow the pattern: `POST /api/v1/{entity}/browse`

**Known Working Entities:**

| Entity | Endpoint | Notes |
|--------|----------|-------|
| `customer` | `/api/v1/customer/browse` | Customer records |
| `order` | `/api/v1/order/browse` | Rental orders |
| `quote` | `/api/v1/quote/browse` | Quotes |
| `deal` | `/api/v1/Deal/browse` | Deals (note capital "D") |
| `warehouse` | `/api/v1/warehouse/browse` | Warehouse locations |
| `purchaseorder` | `/api/v1/purchaseorder/browse` | Purchase orders |
| `contract` | `/api/v1/contract/browse` | Contracts (check-out/check-in) |
| `transferorder` | `/api/v1/transferorder/browse` | Transfer orders |
| `orderitem` | `/api/v1/orderitem/browse` | Order line items (requires `uniqueids`) |
| `activitytype` | `/api/v1/activitytype/browse` | Activity types |
| `activitystatus` | `/api/v1/activitystatus/browse` | Activity statuses |
| `company` | `/api/v1/company/browse` | Companies |

**Known BROKEN Entities (Return HTTP 500):**

| Entity | Endpoint | Status |
|--------|----------|--------|
| `rentalinventory` | `/api/v1/rentalinventory/browse` | Server Error 500 |
| `item` | `/api/v1/item/browse` | Server Error 500 |
| `physicalinventory` | `/api/v1/physicalinventory/browse` | Server Error 500 |
| `container` | `/api/v1/container/browse` | Server Error 500 |

> **Important:** Entity names can be case-sensitive. `Deal` uses a capital "D" while most others are lowercase.

### Step 2: Construct the BrowseRequest Payload

| Detail | Value |
|--------|-------|
| **Endpoint** | `POST /api/v1/{entity}/browse` |
| **Auth** | Bearer JWT |

**Full BrowseRequest Structure:**

```json
{
  "miscfields": {},
  "module": "",
  "options": {},
  "orderby": "OrderDate",
  "orderbydirection": "desc",
  "top": 0,
  "pageno": 1,
  "pagesize": 25,
  "searchfields": [],
  "searchfieldoperators": [],
  "searchfieldvalues": [],
  "searchfieldtypes": [],
  "searchseparators": [],
  "searchcondition": [],
  "uniqueids": {},
  "activeviewfields": []
}
```

**Payload Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `miscfields` | object | Miscellaneous fields (usually empty `{}`) |
| `module` | string | Module filter (usually empty `""`) |
| `options` | object | Additional options (usually empty `{}`) |
| `orderby` | string | Field name to sort by (e.g., `"OrderDate"`) |
| `orderbydirection` | string | Sort direction: `"asc"` or `"desc"` |
| `top` | number | Top N records (0 = use pagination) |
| `pageno` | number | Page number (1-based) |
| `pagesize` | number | Records per page (default 25, max observed 1000) |
| `searchfields` | string[] | Field names to filter on |
| `searchfieldoperators` | string[] | Operators for each filter |
| `searchfieldvalues` | string[] | Values for each filter |
| `searchfieldtypes` | string[] | Type hints (e.g., `"date"`) |
| `searchseparators` | string[] | Separators (usually empty strings) |
| `searchcondition` | string[] | Conditions (usually empty strings) |
| `uniqueids` | object | Parent ID for nested lookups (e.g., `{ "OrderId": "..." }`) |
| `activeviewfields` | string[] | Fields to include in the response |

### Step 3: Apply Search Filters

The search filter arrays must be **parallel** -- all arrays must have the same length, with each index corresponding to one filter condition.

**Available Operators:**

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Exact match | Warehouse = "VERSATILE - CAHUENGA" |
| `like` | Partial match (contains) | Customer like "ACME" |
| `>` | Greater than | OrderDate > "2026-01-01" |
| `<` | Less than | Total < "1000" |
| `>=` | Greater than or equal | OrderDate >= "2026-01-01" |
| `<=` | Less than or equal | Total <= "5000" |

**Example -- Filter by Warehouse and Date:**

```json
{
  "searchfields": ["Warehouse", "OrderDate"],
  "searchfieldoperators": ["=", "="],
  "searchfieldvalues": ["VERSATILE - CAHUENGA", "2026-02-17"],
  "searchfieldtypes": ["", "date"],
  "searchseparators": ["", ""],
  "searchcondition": ["", ""]
}
```

> **Critical:** All six search arrays must have the same number of elements. Mismatched array lengths will cause errors.

### Step 4: Handle Pagination

```json
{
  "pageno": 1,
  "pagesize": 25
}
```

- `pageno` is 1-based (first page is 1, not 0)
- Default `pagesize` is 25; maximum observed working value is 1000
- Use `TotalPages` from the response to determine if more pages exist

### Step 5: Use uniqueids for Nested Lookups

Some entities require a parent ID to scope the results. For example, fetching order items for a specific order:

```typescript
await client.browse("orderitem", {
  uniqueids: { OrderId: "ABC123-DEF456" }
});
```

### Step 6: Interpret the BrowseResponse

**Response Structure:**

```json
{
  "Rows": [
    ["id-value", "order-001", "2026-02-17", ...],
    ["id-value", "order-002", "2026-02-16", ...]
  ],
  "ColumnIndex": {
    "OrderId": 0,
    "OrderNumber": 1,
    "OrderDate": 2
  },
  "TotalRows": 150,
  "PageNo": 1,
  "PageSize": 25,
  "TotalPages": 6
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `Rows` | any[][] | Array of arrays -- each row is a positional array |
| `ColumnIndex` | object | Maps field names to array indices |
| `TotalRows` | number | Total matching records across all pages |
| `PageNo` | number | Current page number |
| `PageSize` | number | Records per page |
| `TotalPages` | number | Total number of pages |

> **CRITICAL:** Rows are **positional arrays**, NOT named objects. You must use `ColumnIndex` to map field names to array positions. For example, if `ColumnIndex.OrderNumber = 1`, then `row[1]` contains the order number.

### Step 7: Map Column Indices to Named Fields

The recommended approach is to read `ColumnIndex` from the response and fall back to hardcoded values:

```typescript
const ci = response.ColumnIndex ?? {};
const orderNumber = row[ci.OrderNumber ?? 1];
const customer = row[ci.Customer ?? 23];
const total = parseFloat(row[ci.Total ?? 44]) || 0;
```

**Known Order Column Mappings (from dashboard-server.ts):**

| Field | Index | Description |
|-------|-------|-------------|
| OrderId | 0 | Unique order identifier |
| OrderNumber | 1 | Human-readable order number |
| OrderDate | 2 | Date of the order |
| Description | 12 | Order description |
| Warehouse | 16 | Warehouse name |
| Customer | 23 | Customer name |
| Deal | 28 | Deal name |
| Status | 34 | Order status |
| Agent | 37 | Assigned agent |
| SubTotal | 43 | Subtotal amount |
| Total | 44 | Total amount |

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| HTTP 500 on browse | Entity browse is broken server-side | Check the "Known BROKEN Entities" list; use `GET /entity/{id}` instead if you know the ID |
| Empty Rows array | No matching records or incorrect filter values | Verify filter field names and values; check spelling of warehouse names |
| Mismatched filter arrays | `searchfields` and `searchfieldvalues` have different lengths | Ensure all six search arrays have the same number of elements |
| Incorrect data in columns | ColumnIndex shifted or hardcoded values are wrong | Always prefer `ColumnIndex` from the response over hardcoded values |
| 401/403 response | Token expired | Re-authenticate (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md)) |
| Case-sensitive entity name error | Wrong casing for entity name | Use exact casing: `Deal` (capital D), `customer` (lowercase) |

---

## Related SOPs

- [SOP-09.01: RentalWorks API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) -- Authentication required before browsing
- [SOP-09.03: API CRUD Operations](SOP-09.03-api-crud-operations.md) -- GET by ID returns named fields (unlike browse)
- [SOP-09.06: Summary Reporting API](SOP-09.06-summary-reporting-api.md) -- Multi-entity browse aggregation
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) -- Pagination and batching guidelines

---

## API Reference

| Detail | Value |
|--------|-------|
| **Endpoint** | `POST /api/v1/{entity}/browse` |
| **Auth** | Bearer JWT |
| **Content-Type** | `application/json` |
| **Required Header** | `x-requested-with: XMLHttpRequest` |

**Request:**
```json
{
  "miscfields": {},
  "module": "",
  "options": {},
  "orderby": "OrderDate",
  "orderbydirection": "desc",
  "top": 0,
  "pageno": 1,
  "pagesize": 25,
  "searchfields": ["Warehouse"],
  "searchfieldoperators": ["="],
  "searchfieldvalues": ["VERSATILE - CAHUENGA"],
  "searchfieldtypes": [""],
  "searchseparators": [""],
  "searchcondition": [""]
}
```

**Response:**
```json
{
  "Rows": [["id", "ORD-001", "2026-02-17", "..."]],
  "ColumnIndex": { "OrderId": 0, "OrderNumber": 1, "OrderDate": 2 },
  "TotalRows": 150,
  "PageNo": 1,
  "PageSize": 25,
  "TotalPages": 6
}
```
