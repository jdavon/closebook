import { getMasterType, type VehicleClassification } from "./vehicle-classification";

export type ReconLineType = "cost" | "accum_depr";

export interface GLAccountGroup {
  key: string;
  displayName: string;
  masterType: "Vehicle" | "Trailer";
}

export interface ReconGroup extends GLAccountGroup {
  lineType: ReconLineType;
  /** The parent GL group key this recon line belongs to */
  parentKey: string;
}

/**
 * Two master-type groups — used by the roll-forward tab and anywhere
 * assets are grouped by Vehicle vs Trailer at the NBV level.
 */
export const GL_ACCOUNT_GROUPS: GLAccountGroup[] = [
  {
    key: "vehicles_net",
    displayName: "Vehicles (Net)",
    masterType: "Vehicle",
  },
  {
    key: "trailers_net",
    displayName: "Trailers (Net)",
    masterType: "Trailer",
  },
];

/**
 * Four reconciliation groups: cost and accumulated depreciation for each master type.
 * Each group is independently linked to entity GL accounts via asset_recon_gl_links.
 */
export const RECON_GROUPS: ReconGroup[] = [
  {
    key: "vehicles_cost",
    displayName: "Vehicles — Cost",
    masterType: "Vehicle",
    lineType: "cost",
    parentKey: "vehicles_net",
  },
  {
    key: "vehicles_accum_depr",
    displayName: "Vehicles — Accumulated Depreciation",
    masterType: "Vehicle",
    lineType: "accum_depr",
    parentKey: "vehicles_net",
  },
  {
    key: "trailers_cost",
    displayName: "Trailers — Cost",
    masterType: "Trailer",
    lineType: "cost",
    parentKey: "trailers_net",
  },
  {
    key: "trailers_accum_depr",
    displayName: "Trailers — Accumulated Depreciation",
    masterType: "Trailer",
    lineType: "accum_depr",
    parentKey: "trailers_net",
  },
];

/** Key used for assets that have no vehicle_class or an unrecognised class */
export const UNALLOCATED_KEY = "unallocated";

/**
 * Get the GL account group key for an asset based on its vehicle class.
 * Returns "vehicles_net" for Vehicle master type, "trailers_net" for Trailer.
 */
export function getAssetGLGroup(
  vehicleClass: string | null,
  customClasses?: VehicleClassification[]
): string | null {
  const mt = getMasterType(vehicleClass, customClasses);
  if (!mt) return null;
  const group = GL_ACCOUNT_GROUPS.find((g) => g.masterType === mt);
  return group?.key ?? null;
}
