# SOP-09.03: API CRUD Operations (Create, Read, Update, Delete)

| Field | Value |
|-------|-------|
| **SOP #** | 09.03 |
| **Version** | 1.0 |
| **Last Updated** | 2026-02-17 |
| **Owner** | Internal Dev Team |
| **Lifecycle Phase** | Cross-cutting |
| **Primary Role** | Internal Dev Team / Manager |

---

## Purpose

This SOP documents the standard CRUD (Create, Read, Update, Delete) operations available through the RentalWorks API. Unlike browse endpoints (which return positional arrays), the GET-by-ID endpoint returns **named fields**, making it the preferred way to retrieve complete record details when you know the record's ID.

---

## Scope

- Applies to all developers performing direct record operations via the RentalWorks API
- Covers GET (read), POST (create), PUT (update), and DELETE operations
- Documents known entities and their case-sensitivity requirements
- Covers the `raw()` method for accessing undiscovered or custom endpoints

---

## Prerequisites

- [ ] Authenticated RentalWorks API session (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md))
- [ ] Record ID for GET/PUT/DELETE operations (obtain via browse -- see [SOP-09.02](SOP-09.02-api-browse-endpoint-usage.md))
- [ ] Understanding of the entity's field structure (use a GET request to discover available fields)

---

## Screen Reference

![RentalWorks Order Browse Screen](/screenshots/order-browse.png)

> **RentalWorks Module:** API (No UI Screen)
> **API Base:** `https://hdr.rentalworks.cloud/api/v1`
> **Authentication:** JWT via `POST /api/v1/jwt`
> **Related RW Module:** All entities supporting GET/POST/PUT/DELETE operations (Order, Customer, Deal, Quote, etc.)

---

## Procedure

### Step 1: Read a Record by ID (GET)

The GET endpoint returns a single record with **named fields** -- unlike browse which returns positional arrays.

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |

**Example -- Get an Order:**

```
GET /api/v1/order/ABC123-DEF456-GHI789
```

**Response (Named Fields):**

```json
{
  "OrderId": "ABC123-DEF456-GHI789",
  "OrderNumber": "ORD-001",
  "OrderDate": "2026-02-17",
  "Description": "Camera equipment rental",
  "Status": "CONFIRMED",
  "Customer": "ACME Productions",
  "Deal": "Spring Shoot 2026",
  "Warehouse": "VERSATILE - CAHUENGA",
  "Agent": "JD BUSFIELD",
  "SubTotal": 1500.00,
  "Total": 1627.50
}
```

> **Key Difference:** GET by ID returns an object with named properties. Browse returns rows as positional arrays. When you need full record details with readable field names, always use GET by ID.

**Using RentalWorksClient:**

```typescript
const order = await client.get("order", "ABC123-DEF456-GHI789");
console.log(order.OrderNumber); // "ORD-001"
```

### Step 2: Create a New Record (POST)

| Detail | Value |
|--------|-------|
| **Endpoint** | `POST /api/v1/{entity}` |
| **Auth** | Bearer JWT |

**Request:**

```json
{
  "Description": "New equipment order",
  "CustomerId": "CUST-ID-HERE",
  "WarehouseId": "WAREHOUSE-ID-HERE"
}
```

**Response:** Returns the created record with its new ID and all populated fields.

**Using RentalWorksClient:**

```typescript
const newRecord = await client.create("order", {
  Description: "New equipment order",
  CustomerId: "CUST-ID-HERE",
  WarehouseId: "WAREHOUSE-ID-HERE"
});
console.log(newRecord.OrderId); // newly generated ID
```

### Step 3: Update an Existing Record (PUT)

| Detail | Value |
|--------|-------|
| **Endpoint** | `PUT /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |

**Request (partial update -- only include fields to change):**

```json
{
  "Description": "Updated description",
  "Status": "ACTIVE"
}
```

**Response:** Returns the updated record with all fields.

**Using RentalWorksClient:**

```typescript
const updated = await client.update("order", "ABC123-DEF456-GHI789", {
  Description: "Updated description"
});
```

### Step 4: Delete a Record (DELETE)

| Detail | Value |
|--------|-------|
| **Endpoint** | `DELETE /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |

**Response:** No body (HTTP 200/204 on success).

**Using RentalWorksClient:**

```typescript
await client.delete("order", "ABC123-DEF456-GHI789");
```

> **Warning:** Delete operations are permanent. Always verify the record ID before deleting.

### Step 5: Use the raw() Method for Custom Endpoints

For undiscovered or non-standard endpoints, use the `raw()` method which accepts a full axios request configuration:

```typescript
const result = await client.raw<any>({
  method: "POST",
  url: "/order/browse",
  data: {
    // custom payload
  }
});
```

This is useful for:
- Testing newly discovered endpoints
- Sending custom payloads that do not fit the standard browse/CRUD pattern
- Accessing endpoints not yet wrapped by convenience methods

---

## Known Entities

| Entity | GET by ID | Browse | Create/Update | Case-Sensitive |
|--------|-----------|--------|---------------|----------------|
| `warehouse` | Yes | Yes | Yes | lowercase |
| `customer` | Yes | Yes | Yes | lowercase |
| `order` | Yes | Yes | Yes | lowercase |
| `quote` | Yes | Yes | Yes | lowercase |
| `contract` | Yes | Yes | Yes | lowercase |
| `item` | Yes | **No (500)** | Yes | lowercase |
| `Deal` | Yes | Yes | Yes | **Capital D** |
| `transferorder` | Yes | Yes | Yes | lowercase |
| `orderitem` | Yes | Yes (needs `uniqueids`) | Yes | lowercase |
| `activitytype` | Yes | Yes | Yes | lowercase |
| `activitystatus` | Yes | Yes | Yes | lowercase |
| `company` | Yes | Yes | Yes | lowercase |
| `venue` | Yes | Unknown | Unknown | lowercase |
| `purchaseorder` | Yes | Yes | Yes | lowercase |

> **Important:** For entities with broken browse endpoints (item, rentalinventory, physicalinventory, container), GET by ID may still work if you have the record ID from another source.

---

## Convenience Methods in RentalWorksClient

The `src/RentalWorksClient.ts` file provides typed convenience methods:

| Method | Entity | Operation |
|--------|--------|-----------|
| `getWarehouses(params)` | warehouse | Browse |
| `getCustomers(params)` | customer | Browse |
| `getCustomer(id)` | customer | GET by ID |
| `getOrders(params)` | order | Browse |
| `getOrder(id)` | order | GET by ID |
| `getQuotes(params)` | quote | Browse |
| `getContracts(params)` | contract | Browse |
| `getInventory(params)` | item | Browse |
| `getDeals(params)` | Deal | Browse |
| `getTransferOrders(params)` | transferorder | Browse |
| `getOrderItems(orderId, params)` | orderitem | Browse (with uniqueids) |
| `getActivityTypes(params)` | activitytype | Browse |
| `getActivityStatuses(params)` | activitystatus | Browse |
| `getCompanies(params)` | company | Browse |
| `getVenue(id)` | venue | GET by ID |

---

## Common Errors & Troubleshooting

| Error / Issue | Cause | Resolution |
|--------------|-------|------------|
| 404 Not Found | Invalid entity name or record ID | Verify entity name casing and record ID |
| 500 Internal Server Error on GET | Server-side issue with the entity | Try a different entity or contact RW support |
| Empty response on GET | Record does not exist with the given ID | Verify the ID via a browse query first |
| Case-sensitivity error | Wrong casing for entity name | Use `Deal` (capital D); most others are lowercase |
| 401/403 on any operation | Token expired | Re-authenticate (see [SOP-09.01](SOP-09.01-rentalworks-api-overview-authentication.md)) |
| Create returns unexpected fields | RW auto-populates default values | Read the response to see which fields were auto-set |
| Update does not change a field | Field may be read-only or computed | Some fields are calculated server-side and cannot be directly modified |

---

## Related SOPs

- [SOP-09.01: RentalWorks API Overview & Authentication](SOP-09.01-rentalworks-api-overview-authentication.md) -- Authentication required for all CRUD operations
- [SOP-09.02: API Browse Endpoint Usage](SOP-09.02-api-browse-endpoint-usage.md) -- Browse returns positional arrays; use GET by ID for named fields
- [SOP-09.07: API Error Handling & Session Management](SOP-09.07-api-error-handling-session-management.md) -- Error handling patterns for CRUD operations
- [SOP-09.10: API Rate Limits & Best Practices](SOP-09.10-api-rate-limits-best-practices.md) -- Best practices for API usage

---

## API Reference

### Read (GET)

| Detail | Value |
|--------|-------|
| **Endpoint** | `GET /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |

**Response:**
```json
{
  "EntityId": "unique-id",
  "FieldName": "value",
  "...": "..."
}
```

### Create (POST)

| Detail | Value |
|--------|-------|
| **Endpoint** | `POST /api/v1/{entity}` |
| **Auth** | Bearer JWT |

**Request:**
```json
{
  "FieldName": "value"
}
```

### Update (PUT)

| Detail | Value |
|--------|-------|
| **Endpoint** | `PUT /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |

**Request:**
```json
{
  "FieldName": "updated value"
}
```

### Delete (DELETE)

| Detail | Value |
|--------|-------|
| **Endpoint** | `DELETE /api/v1/{entity}/{id}` |
| **Auth** | Bearer JWT |
