/**
 * Paginated fetch utilities for Supabase PostgREST.
 *
 * Supabase PostgREST caps responses via PGRST_DB_MAX_ROWS (default 1000).
 * Any `.limit()` value larger than this is silently capped, which means
 * queries that expect more than 1000 rows will receive truncated results
 * with no error. These helpers paginate using `.range()` so every row is
 * fetched regardless of the server-side cap.
 */

// Page size must not exceed PGRST_DB_MAX_ROWS so that the "is there more?"
// check (rows.length < PAGE_SIZE) works correctly.
const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ---------------------------------------------------------------------------
// Generic paginated fetcher
// ---------------------------------------------------------------------------

interface PaginatedQueryOptions {
  table: string;
  select: string;
  filters: Array<{
    type: "eq" | "in" | "neq";
    column: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  }>;
  order?: Array<{ column: string; ascending?: boolean }>;
}

export async function fetchAllRows<T>(
  client: SupabaseClient,
  options: PaginatedQueryOptions
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = client
      .from(options.table)
      .select(options.select);

    for (const filter of options.filters) {
      switch (filter.type) {
        case "eq":
          query = query.eq(filter.column, filter.value);
          break;
        case "in":
          query = query.in(filter.column, filter.value);
          break;
        case "neq":
          query = query.neq(filter.column, filter.value);
          break;
      }
    }

    if (options.order) {
      for (const o of options.order) {
        query = query.order(o.column, { ascending: o.ascending ?? true });
      }
    }

    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await query;

    if (error) {
      console.error(`Paginated fetch error (${options.table}):`, error);
      break;
    }

    const rows = (data ?? []) as T[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Convenience: fetch all master account mappings
// ---------------------------------------------------------------------------

interface MappingRow {
  id?: string;
  master_account_id: string;
  entity_id: string;
  account_id: string;
}

/**
 * Fetch ALL master_account_mappings for the given master account IDs,
 * paginating to avoid the PostgREST row-limit cap.
 */
export async function fetchAllMappings(
  client: SupabaseClient,
  masterAccountIds: string[],
  selectFields: string = "master_account_id, entity_id, account_id"
): Promise<MappingRow[]> {
  if (masterAccountIds.length === 0) return [];

  return fetchAllRows<MappingRow>(client, {
    table: "master_account_mappings",
    select: selectFields,
    filters: [
      { type: "in", column: "master_account_id", value: masterAccountIds },
    ],
  });
}

// ---------------------------------------------------------------------------
// Convenience: fetch all accounts for given entity IDs
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  entity_id: string;
  name: string;
  account_number: string | null;
  classification: string;
  account_type?: string;
  current_balance?: number;
}

/**
 * Fetch ALL accounts for the given entity IDs,
 * paginating to avoid the PostgREST row-limit cap.
 */
export async function fetchAllAccounts(
  client: SupabaseClient,
  entityIds: string[],
  selectFields: string = "id, entity_id, name, account_number, classification, current_balance",
  activeOnly: boolean = true
): Promise<AccountRow[]> {
  if (entityIds.length === 0) return [];

  const filters: PaginatedQueryOptions["filters"] = [
    { type: "in", column: "entity_id", value: entityIds },
  ];

  if (activeOnly) {
    filters.push({ type: "eq", column: "is_active", value: true });
  }

  return fetchAllRows<AccountRow>(client, {
    table: "accounts",
    select: selectFields,
    filters,
  });
}
