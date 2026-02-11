import type {
  VehicleClass,
  VehicleReportingGroup,
  VehicleMasterType,
} from "@/lib/types/database";

export interface VehicleClassification {
  class: VehicleClass;
  className: string;
  reportingGroup: VehicleReportingGroup;
  masterType: VehicleMasterType;
}

export const VEHICLE_CLASSIFICATIONS: Record<VehicleClass, VehicleClassification> = {
  "1R":  { class: "1R",  className: "Single Cast",                    reportingGroup: "Cast Trailer",      masterType: "Trailer" },
  "2":   { class: "2",   className: "Camera Small",                   reportingGroup: "Studio Box Truck",  masterType: "Vehicle" },
  "2R":  { class: "2R",  className: "2 Room Cast",                    reportingGroup: "Cast Trailer",      masterType: "Trailer" },
  "3":   { class: "3",   className: "Midsize",                        reportingGroup: "Car",               masterType: "Vehicle" },
  "3R":  { class: "3R",  className: "3 Room Cast",                    reportingGroup: "Cast Trailer",      masterType: "Trailer" },
  "4":   { class: "4",   className: "Premium",                        reportingGroup: "Car",               masterType: "Vehicle" },
  "5":   { class: "5",   className: "Luxury",                         reportingGroup: "Car",               masterType: "Vehicle" },
  "6":   { class: "6",   className: "Full Size",                      reportingGroup: "Car",               masterType: "Vehicle" },
  "7":   { class: "7",   className: "Suburban",                       reportingGroup: "Car",               masterType: "Vehicle" },
  "8":   { class: "8",   className: "Low Roof 15 Passenger",          reportingGroup: "Passenger Van",     masterType: "Vehicle" },
  "8MU": { class: "8MU", className: "8 Station Makeup",               reportingGroup: "Makeup Trailer",    masterType: "Trailer" },
  "9":   { class: "9",   className: "Camera Large",                   reportingGroup: "Studio Box Truck",  masterType: "Vehicle" },
  "11":  { class: "11",  className: "Low Roof Cargo",                 reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "12":  { class: "12",  className: "SUV - 5 Seater",                 reportingGroup: "Car",               masterType: "Vehicle" },
  "13":  { class: "13",  className: "Regular Cab Cube",               reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "13T": { class: "13T", className: "Regular Cab Cube Tuckaway",      reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "14":  { class: "14",  className: "Crew Cab Cube",                  reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "15":  { class: "15",  className: "Stakebed",                       reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "15I": { class: "15I", className: "Stakebed",                       reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "15L": { class: "15L", className: "Large Stakebed",                 reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "16":  { class: "16",  className: "16ft Stakebed",                  reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "17":  { class: "17",  className: "Pickup",                         reportingGroup: "Car",               masterType: "Vehicle" },
  "18":  { class: "18",  className: "Big Pickup",                     reportingGroup: "Car",               masterType: "Vehicle" },
  "20":  { class: "20",  className: "4-Ton (Cabover 20 Ft Box)",      reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "20T": { class: "20T", className: "4-Ton Tuckaway",                 reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "21":  { class: "21",  className: "Minivan",                        reportingGroup: "Car",               masterType: "Vehicle" },
  "22":  { class: "22",  className: "MiniMover",                      reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "23":  { class: "23",  className: "Large Stake",                    reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "24":  { class: "24",  className: "F-650 5-Ton",                    reportingGroup: "Box Truck",         masterType: "Vehicle" },
  "26":  { class: "26",  className: "Refer Van",                      reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "27":  { class: "27",  className: "10 Ton",                         reportingGroup: "Studio Box Truck",  masterType: "Vehicle" },
  "28":  { class: "28",  className: "15 Passenger Van - Mid / High",  reportingGroup: "Passenger Van",     masterType: "Vehicle" },
  "28P": { class: "28P", className: "15 Passenger Van Premium",       reportingGroup: "Passenger Van",     masterType: "Vehicle" },
  "28S": { class: "28S", className: "15 Passenger Sprinter",          reportingGroup: "Passenger Van",     masterType: "Vehicle" },
  "29":  { class: "29",  className: "High Roof Cargo Van",            reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "30":  { class: "30",  className: "High Roof Cargo Van - Liftgate", reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "31":  { class: "31",  className: "Sprinter 144\"",                 reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "32":  { class: "32",  className: "Sprinter 170\"",                 reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "33":  { class: "33",  className: "Sprinter 170 EXT\"",             reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "34":  { class: "34",  className: "High Roof Cargo Van - Shelving", reportingGroup: "Cargo Van",         masterType: "Vehicle" },
  "40":  { class: "40",  className: "Shorty 40",                      reportingGroup: "Studio Box Truck",  masterType: "Vehicle" },
  "51":  { class: "51",  className: "Stakebed 4x4",                   reportingGroup: "Stakebed",          masterType: "Vehicle" },
  "52":  { class: "52",  className: "5th Wheel Stakebed",             reportingGroup: "Stakebed",          masterType: "Vehicle" },
};

export function getVehicleClassification(
  classCode: VehicleClass | string | null
): VehicleClassification | null {
  if (!classCode) return null;
  return VEHICLE_CLASSIFICATIONS[classCode as VehicleClass] ?? null;
}

export function getReportingGroup(
  classCode: VehicleClass | string | null
): VehicleReportingGroup | null {
  return getVehicleClassification(classCode)?.reportingGroup ?? null;
}

export function getMasterType(
  classCode: VehicleClass | string | null
): VehicleMasterType | null {
  return getVehicleClassification(classCode)?.masterType ?? null;
}

export function getClassLabel(classCode: VehicleClass | string): string {
  const c = VEHICLE_CLASSIFICATIONS[classCode as VehicleClass];
  if (!c) return classCode;
  return `Class ${c.class}: ${c.className}`;
}

export function getAllClasses(): VehicleClassification[] {
  return Object.values(VEHICLE_CLASSIFICATIONS).sort((a, b) => {
    const aNum = parseInt(a.class);
    const bNum = parseInt(b.class);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    if (!isNaN(aNum)) return -1;
    if (!isNaN(bNum)) return 1;
    return a.class.localeCompare(b.class);
  });
}

export function getClassesGroupedByMasterType(): Array<{
  masterType: VehicleMasterType;
  classes: VehicleClassification[];
}> {
  const all = getAllClasses();
  return [
    {
      masterType: "Vehicle",
      classes: all.filter((c) => c.masterType === "Vehicle"),
    },
    {
      masterType: "Trailer",
      classes: all.filter((c) => c.masterType === "Trailer"),
    },
  ];
}

/** All distinct reporting groups in display order */
export const REPORTING_GROUPS: VehicleReportingGroup[] = [
  "Car",
  "Cargo Van",
  "Passenger Van",
  "Box Truck",
  "Studio Box Truck",
  "Stakebed",
  "Cast Trailer",
  "Makeup Trailer",
];
