import { getMasterType } from "./vehicle-classification";

export interface GLAccountGroup {
  key: string;
  displayName: string;
  masterAccountNumber: string;
  qboAccountNumbers: string[];
  masterType: "Vehicle" | "Trailer";
}

export const GL_ACCOUNT_GROUPS: GLAccountGroup[] = [
  {
    key: "vehicles_net",
    displayName: "Vehicles (Net)",
    masterAccountNumber: "M1700",
    qboAccountNumbers: ["1830", "1831", "1874", "1875"],
    masterType: "Vehicle",
  },
  {
    key: "trailers_net",
    displayName: "Trailers (Net)",
    masterAccountNumber: "M1800",
    qboAccountNumbers: ["1835", "1840", "1841"],
    masterType: "Trailer",
  },
];

/**
 * Get the GL account group key for an asset based on its vehicle class.
 * Returns "vehicles_net" for Vehicle master type, "trailers_net" for Trailer.
 */
export function getAssetGLGroup(
  vehicleClass: string | null
): string | null {
  const mt = getMasterType(vehicleClass);
  if (!mt) return null;
  const group = GL_ACCOUNT_GROUPS.find((g) => g.masterType === mt);
  return group?.key ?? null;
}

/**
 * Given a list of entity accounts, return the account IDs that belong to
 * the specified GL account group (matched by account_number prefix).
 */
export function getGLAccountIdsForGroup(
  accounts: { id: string; account_number: string | null }[],
  groupKey: string
): string[] {
  const group = GL_ACCOUNT_GROUPS.find((g) => g.key === groupKey);
  if (!group) return [];
  return accounts
    .filter((a) =>
      a.account_number &&
      group.qboAccountNumbers.some(
        (qbo) =>
          a.account_number === qbo ||
          a.account_number!.startsWith(qbo + ".")
      )
    )
    .map((a) => a.id);
}
