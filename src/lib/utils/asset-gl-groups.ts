import { getMasterType } from "./vehicle-classification";

export interface GLAccountGroup {
  key: string;
  displayName: string;
  /** Master account number in master_accounts table (e.g. "M1700") */
  masterAccountNumber: string;
  masterType: "Vehicle" | "Trailer";
}

export const GL_ACCOUNT_GROUPS: GLAccountGroup[] = [
  {
    key: "vehicles_net",
    displayName: "Vehicles (Net)",
    masterAccountNumber: "M1700",
    masterType: "Vehicle",
  },
  {
    key: "trailers_net",
    displayName: "Trailers (Net)",
    masterAccountNumber: "M1800",
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
