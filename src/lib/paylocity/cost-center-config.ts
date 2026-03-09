/**
 * Cost Center → Operating Entity Mapping
 *
 * Two Paylocity companies:
 *   - 132427 (Silverco): Employees for Silverco, ARH, Versatile Studios
 *   - 316791 (HDR): Employees for Hollywood Depot Rentals
 *
 * Cost center codes overlap between companies (both have 100, 200, etc.)
 * so lookups are company-scoped.
 */

// ─── Entity IDs (from Supabase) ─────────────────────────────────────

export const ENTITY_IDS = {
  SILVERCO: "b664a9c1-3817-4df4-9261-f51b3403a5de",
  ARH: "b56dec66-edea-4d8d-8cb4-4043af3e41de",
  VS: "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081",
  HDR: "7529580d-3b44-4a9b-91f4-bc2db25f5211",
  HSS: "f641caa2-c87e-4a71-a98b-d51cc559f3ff",
} as const;

/** Paylocity company IDs */
export const COMPANY_IDS = {
  SILVERCO: "132427",
  HDR: "316791",
} as const;

/** The employing entity for company 132427 */
export const EMPLOYING_ENTITY_ID = ENTITY_IDS.SILVERCO;

/** Map company ID → its default employing entity */
export const COMPANY_EMPLOYING_ENTITY: Record<string, string> = {
  [COMPANY_IDS.SILVERCO]: ENTITY_IDS.SILVERCO,
  [COMPANY_IDS.HDR]: ENTITY_IDS.HDR,
};

/** Reverse map: employing entity ID → Paylocity company ID */
export const EMPLOYING_ENTITY_TO_COMPANY: Record<string, string> = {
  [ENTITY_IDS.SILVERCO]: COMPANY_IDS.SILVERCO,
  [ENTITY_IDS.HDR]: COMPANY_IDS.HDR,
};

// ─── Cost Center Map ─────────────────────────────────────────────────

export interface CostCenterEntry {
  code: string;
  department: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
}

/**
 * Company-scoped cost center maps.
 * Key: companyId → costCenterCode → CostCenterEntry
 */
export const COMPANY_COST_CENTER_MAPS: Record<string, Record<string, CostCenterEntry>> = {
  // ─── Company 132427 (Silverco) ────────────────────────────────────
  [COMPANY_IDS.SILVERCO]: {
    // Silverco corporate functions
    "01": {
      code: "01",
      department: "Administrative",
      operatingEntityId: ENTITY_IDS.SILVERCO,
      operatingEntityCode: "AVON",
      operatingEntityName: "Silverco Enterprises",
    },
    "05": {
      code: "05",
      department: "Officer",
      operatingEntityId: ENTITY_IDS.SILVERCO,
      operatingEntityCode: "AVON",
      operatingEntityName: "Silverco Enterprises",
    },
    "100": {
      code: "100",
      department: "Silverco Employees",
      operatingEntityId: ENTITY_IDS.SILVERCO,
      operatingEntityCode: "AVON",
      operatingEntityName: "Silverco Enterprises",
    },
    "200": {
      code: "200",
      department: "Silverco Executive",
      operatingEntityId: ENTITY_IDS.SILVERCO,
      operatingEntityCode: "AVON",
      operatingEntityName: "Silverco Enterprises",
    },

    // Avon Rental Holdings
    "02": {
      code: "02",
      department: "Avon Lot Ops",
      operatingEntityId: ENTITY_IDS.ARH,
      operatingEntityCode: "ARH",
      operatingEntityName: "Avon Rental Holdings",
    },
    "03": {
      code: "03",
      department: "Fleet",
      operatingEntityId: ENTITY_IDS.ARH,
      operatingEntityCode: "ARH",
      operatingEntityName: "Avon Rental Holdings",
    },
    "04": {
      code: "04",
      department: "Sales",
      operatingEntityId: ENTITY_IDS.ARH,
      operatingEntityCode: "ARH",
      operatingEntityName: "Avon Rental Holdings",
    },
    "06": {
      code: "06",
      department: "Bathroom Trailers",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },

    // Versatile Studios
    "07": {
      code: "07",
      department: "Versatile",
      operatingEntityId: ENTITY_IDS.VS,
      operatingEntityCode: "VS",
      operatingEntityName: "Versatile Studios",
    },
    "08": {
      code: "08",
      department: "Versatile Lot Ops",
      operatingEntityId: ENTITY_IDS.VS,
      operatingEntityCode: "VS",
      operatingEntityName: "Versatile Studios",
    },
    "09": {
      code: "09",
      department: "Versatile Administration",
      operatingEntityId: ENTITY_IDS.VS,
      operatingEntityCode: "VS",
      operatingEntityName: "Versatile Studios",
    },
    "010": {
      code: "010",
      department: "Versatile Sales",
      operatingEntityId: ENTITY_IDS.VS,
      operatingEntityCode: "VS",
      operatingEntityName: "Versatile Studios",
    },

    // Silverco-side HDR cost centers (allocated to HDR)
    "300": {
      code: "300",
      department: "HDR A/C",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "400": {
      code: "400",
      department: "HDR Communications",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "500": {
      code: "500",
      department: "HDR G&L",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "600": {
      code: "600",
      department: "HDR Locations",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "700": {
      code: "700",
      department: "HDR Production Supplies",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "800": {
      code: "800",
      department: "HDR Trash",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "900": {
      code: "900",
      department: "HDR Operations",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "1000": {
      code: "1000",
      department: "Restroom Trailers",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
  },

  // ─── Company 316791 (HDR) ─────────────────────────────────────────
  [COMPANY_IDS.HDR]: {
    "100": {
      code: "100",
      department: "A/C",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "200": {
      code: "200",
      department: "Communications",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "300": {
      code: "300",
      department: "G&L",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "400": {
      code: "400",
      department: "Locations",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "500": {
      code: "500",
      department: "Production Supply",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "600": {
      code: "600",
      department: "Trash",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "700": {
      code: "700",
      department: "Operations",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
    "800": {
      code: "800",
      department: "Restroom Trailers",
      operatingEntityId: ENTITY_IDS.HDR,
      operatingEntityCode: "HDR",
      operatingEntityName: "Hollywood Depot Rentals",
    },
  },
};

/**
 * Flat merged map for backward compat — uses Silverco (132427) as default.
 * Prefer getOperatingEntityForCostCenter() with companyId for accurate lookups.
 */
export const COST_CENTER_MAP: Record<string, CostCenterEntry> =
  COMPANY_COST_CENTER_MAPS[COMPANY_IDS.SILVERCO];

// ─── Lookup Helpers ──────────────────────────────────────────────────

/**
 * Get the operating entity for a given cost center code, scoped by company.
 * Falls back to the company's employing entity if code is unknown.
 */
export function getOperatingEntityForCostCenter(
  costCenterCode: string | undefined | null,
  companyId?: string
): CostCenterEntry {
  const cid = companyId ?? COMPANY_IDS.SILVERCO;
  const map = COMPANY_COST_CENTER_MAPS[cid] ?? COMPANY_COST_CENTER_MAPS[COMPANY_IDS.SILVERCO];
  const fallbackEntityId = COMPANY_EMPLOYING_ENTITY[cid] ?? EMPLOYING_ENTITY_ID;

  // Determine fallback entity info
  const fallbackCode = cid === COMPANY_IDS.HDR ? "HDR" : "AVON";
  const fallbackName = cid === COMPANY_IDS.HDR ? "Hollywood Depot Rentals" : "Silverco Enterprises";

  if (!costCenterCode) {
    return {
      code: "UNKNOWN",
      department: "Unknown",
      operatingEntityId: fallbackEntityId,
      operatingEntityCode: fallbackCode,
      operatingEntityName: fallbackName,
    };
  }

  // Paylocity returns cost center codes with descriptions, e.g. "08 - Versatile Lot Ops"
  // Strip the description suffix to get just the numeric code for lookup
  const numericCode = costCenterCode.includes(" - ")
    ? costCenterCode.split(" - ")[0].trim()
    : costCenterCode.trim();

  return map[numericCode] ?? {
    code: numericCode,
    department: `Unknown (${costCenterCode})`,
    operatingEntityId: fallbackEntityId,
    operatingEntityCode: fallbackCode,
    operatingEntityName: fallbackName,
  };
}

/**
 * Get all cost center codes that map to a given entity ID (across all companies).
 */
export function getCostCentersForEntity(entityId: string): CostCenterEntry[] {
  const results: CostCenterEntry[] = [];
  const seen = new Set<string>();

  for (const map of Object.values(COMPANY_COST_CENTER_MAPS)) {
    for (const entry of Object.values(map)) {
      const key = `${entry.operatingEntityId}:${entry.code}`;
      if (entry.operatingEntityId === entityId && !seen.has(key)) {
        seen.add(key);
        results.push(entry);
      }
    }
  }

  return results;
}

/**
 * Get the department label for a cost center code.
 */
export function getDepartmentLabel(
  costCenterCode: string | undefined | null,
  companyId?: string
): string {
  if (!costCenterCode) return "Unknown";
  return getOperatingEntityForCostCenter(costCenterCode, companyId).department;
}

/**
 * Get unique operating entities across all company cost center maps.
 */
export function getOperatingEntities(): {
  entityId: string;
  entityCode: string;
  entityName: string;
}[] {
  const seen = new Set<string>();
  const entities: { entityId: string; entityCode: string; entityName: string }[] = [];

  for (const map of Object.values(COMPANY_COST_CENTER_MAPS)) {
    for (const entry of Object.values(map)) {
      if (!seen.has(entry.operatingEntityId)) {
        seen.add(entry.operatingEntityId);
        entities.push({
          entityId: entry.operatingEntityId,
          entityCode: entry.operatingEntityCode,
          entityName: entry.operatingEntityName,
        });
      }
    }
  }

  return entities;
}
