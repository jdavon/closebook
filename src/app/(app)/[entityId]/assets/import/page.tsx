"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  VEHICLE_CLASSIFICATIONS,
  getAllClasses,
} from "@/lib/utils/vehicle-classification";
import type { VehicleClass } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldKey =
  | "asset_tag"
  | "asset_name"
  | "vehicle_class"
  | "vehicle_year"
  | "vehicle_make"
  | "vehicle_model"
  | "vehicle_trim"
  | "vin"
  | "license_plate"
  | "license_state"
  | "mileage_at_acquisition"
  | "title_number"
  | "registration_expiry"
  | "vehicle_notes"
  | "acquisition_date"
  | "acquisition_cost"
  | "in_service_date"
  | "book_depreciation_method"
  | "book_useful_life_months"
  | "book_salvage_value"
  | "tax_cost_basis"
  | "tax_depreciation_method"
  | "tax_useful_life_months"
  | "section_179_amount"
  | "bonus_depreciation_amount"
  | "book_accumulated_depreciation"
  | "tax_accumulated_depreciation"
  | "status";

interface AssetRow {
  _id: string;
  _errors: Partial<Record<FieldKey, string>>;
  _prevAutoName?: string;
  asset_tag: string;
  asset_name: string;
  vehicle_class: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_trim: string;
  vin: string;
  license_plate: string;
  license_state: string;
  mileage_at_acquisition: string;
  title_number: string;
  registration_expiry: string;
  vehicle_notes: string;
  acquisition_date: string;
  acquisition_cost: string;
  in_service_date: string;
  book_depreciation_method: string;
  book_useful_life_months: string;
  book_salvage_value: string;
  tax_cost_basis: string;
  tax_depreciation_method: string;
  tax_useful_life_months: string;
  section_179_amount: string;
  bonus_depreciation_amount: string;
  book_accumulated_depreciation: string;
  tax_accumulated_depreciation: string;
  status: string;
  [key: string]: unknown;
}

interface ColumnDef {
  key: FieldKey;
  label: string;
  shortLabel?: string;
  group: "id" | "vehicle" | "book" | "tax" | "status";
  type: "text" | "number" | "date" | "select";
  required?: boolean;
  width: number;
  options?: { value: string; label: string }[];
  placeholder?: string;
  uppercase?: boolean;
}

interface ImportResults {
  imported: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const BOOK_METHOD_OPTIONS = [
  { value: "straight_line", label: "Straight-Line" },
  { value: "declining_balance", label: "Double Declining" },
  { value: "none", label: "None" },
];

const TAX_METHOD_OPTIONS = [
  { value: "macrs_5", label: "MACRS 5-Year" },
  { value: "macrs_7", label: "MACRS 7-Year" },
  { value: "macrs_10", label: "MACRS 10-Year" },
  { value: "section_179", label: "Section 179" },
  { value: "bonus_100", label: "100% Bonus" },
  { value: "bonus_80", label: "80% Bonus" },
  { value: "bonus_60", label: "60% Bonus" },
  { value: "straight_line_tax", label: "Straight-Line (Tax)" },
  { value: "none", label: "None" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "disposed", label: "Disposed" },
  { value: "fully_depreciated", label: "Fully Depreciated" },
  { value: "inactive", label: "Inactive" },
];

const VEHICLE_CLASS_OPTIONS = getAllClasses().map((c) => ({
  value: c.class,
  label: `${c.class}: ${c.className}`,
}));

const STATE_OPTIONS = US_STATES.map((s) => ({ value: s, label: s }));

const COLUMNS: ColumnDef[] = [
  // Identification
  { key: "asset_tag", label: "Asset Tag", group: "id", type: "text", width: 100, placeholder: "VEH-001" },
  { key: "asset_name", label: "Asset Name", group: "id", type: "text", width: 160, placeholder: "Auto from Year/Make/Model" },
  // Vehicle
  { key: "vehicle_class", label: "Vehicle Class", shortLabel: "Class", group: "vehicle", type: "select", width: 170, options: VEHICLE_CLASS_OPTIONS },
  { key: "vehicle_year", label: "Year", group: "vehicle", type: "number", width: 70, placeholder: "2024" },
  { key: "vehicle_make", label: "Make", group: "vehicle", type: "text", width: 100, placeholder: "Ford" },
  { key: "vehicle_model", label: "Model", group: "vehicle", type: "text", width: 100, placeholder: "F-150" },
  { key: "vehicle_trim", label: "Trim", group: "vehicle", type: "text", width: 80, placeholder: "XLT" },
  { key: "vin", label: "VIN", group: "vehicle", type: "text", width: 175, placeholder: "17-char VIN", uppercase: true },
  { key: "license_plate", label: "Plate", group: "vehicle", type: "text", width: 90, uppercase: true },
  { key: "license_state", label: "State", group: "vehicle", type: "select", width: 75, options: STATE_OPTIONS },
  { key: "mileage_at_acquisition", label: "Mileage", group: "vehicle", type: "number", width: 85, placeholder: "0" },
  { key: "title_number", label: "Title #", group: "vehicle", type: "text", width: 100 },
  { key: "registration_expiry", label: "Reg Expiry", group: "vehicle", type: "date", width: 130 },
  { key: "vehicle_notes", label: "Notes", group: "vehicle", type: "text", width: 150 },
  // Book Basis
  { key: "acquisition_date", label: "Acq Date", group: "book", type: "date", width: 130, required: true },
  { key: "acquisition_cost", label: "Acq Cost", group: "book", type: "number", width: 120, required: true, placeholder: "0.00" },
  { key: "in_service_date", label: "In Service", group: "book", type: "date", width: 130, required: true },
  { key: "book_depreciation_method", label: "Book Method", group: "book", type: "select", width: 150, options: BOOK_METHOD_OPTIONS },
  { key: "book_useful_life_months", label: "Life (mo)", group: "book", type: "number", width: 85, placeholder: "60" },
  { key: "book_salvage_value", label: "Salvage", group: "book", type: "number", width: 100, placeholder: "0" },
  { key: "book_accumulated_depreciation", label: "Book Accum Depr", shortLabel: "Accum", group: "book", type: "number", width: 130, placeholder: "Auto-calc" },
  // Tax Basis
  { key: "tax_cost_basis", label: "Tax Basis", group: "tax", type: "number", width: 120, placeholder: "= Acq Cost" },
  { key: "tax_depreciation_method", label: "Tax Method", group: "tax", type: "select", width: 160, options: TAX_METHOD_OPTIONS },
  { key: "tax_useful_life_months", label: "Tax Life (mo)", group: "tax", type: "number", width: 95, placeholder: "Auto" },
  { key: "section_179_amount", label: "Sec 179", group: "tax", type: "number", width: 100, placeholder: "0" },
  { key: "bonus_depreciation_amount", label: "Bonus Depr", group: "tax", type: "number", width: 110, placeholder: "0" },
  { key: "tax_accumulated_depreciation", label: "Tax Accum Depr", shortLabel: "Tax Accum", group: "tax", type: "number", width: 130, placeholder: "Auto-calc" },
  // Status
  { key: "status", label: "Status", group: "status", type: "select", width: 120, options: STATUS_OPTIONS },
];

const GROUP_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  id:      { bg: "bg-slate-100 dark:bg-slate-800",   text: "text-slate-700 dark:text-slate-300",   border: "border-slate-200 dark:border-slate-700" },
  vehicle: { bg: "bg-emerald-50 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800" },
  book:    { bg: "bg-amber-50 dark:bg-amber-950",     text: "text-amber-700 dark:text-amber-300",     border: "border-amber-200 dark:border-amber-800" },
  tax:     { bg: "bg-violet-50 dark:bg-violet-950",   text: "text-violet-700 dark:text-violet-300",   border: "border-violet-200 dark:border-violet-800" },
  status:  { bg: "bg-gray-50 dark:bg-gray-900",       text: "text-gray-700 dark:text-gray-300",       border: "border-gray-200 dark:border-gray-700" },
};

const GROUP_LABELS: Record<string, string> = {
  id: "Identification",
  vehicle: "Vehicle Information",
  book: "Book Basis (GAAP)",
  tax: "Tax Basis (IRS)",
  status: "Status",
};

// Column groups for the spanning header
function getColumnGroups(): { group: string; span: number }[] {
  const groups: { group: string; span: number }[] = [];
  let current = "";
  for (const col of COLUMNS) {
    if (col.group !== current) {
      groups.push({ group: col.group, span: 1 });
      current = col.group;
    } else {
      groups[groups.length - 1].span++;
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Header mapping (same fuzzy logic as upload route)
// ---------------------------------------------------------------------------

function buildHeaderMap(headers: string[]): Record<FieldKey, string> {
  const find = (patterns: string[]): string => {
    for (const h of headers) {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const p of patterns) {
        if (lower.includes(p)) return h;
      }
    }
    return "";
  };

  return {
    asset_tag: find(["assettag", "tag", "assetid", "unitnumber", "unit"]),
    asset_name: find(["assetname", "name", "description"]),
    vehicle_class: find(["vehicleclass", "class", "classtype", "category"]),
    vehicle_year: find(["year", "modelyear", "vehicleyear"]),
    vehicle_make: find(["make", "manufacturer", "brand"]),
    vehicle_model: find(["model"]),
    vehicle_trim: find(["trim", "package", "level"]),
    vin: find(["vin", "vehicleid", "serialnumber", "serial"]),
    license_plate: find(["licenseplate", "plate", "license"]),
    license_state: find(["licensestate", "regstate"]),
    mileage_at_acquisition: find(["mileage", "miles", "odometer"]),
    title_number: find(["titlenumber", "title"]),
    registration_expiry: find(["registrationexpiry", "regexpiry", "registration"]),
    vehicle_notes: find(["notes", "comments", "memo"]),
    acquisition_date: find(["acquisitiondate", "acqdate", "purchasedate", "acquired", "dateacquired"]),
    acquisition_cost: find(["acquisitioncost", "cost", "purchaseprice", "price", "amount"]),
    in_service_date: find(["inservicedate", "inservice", "servicedate", "placedinservice"]),
    book_depreciation_method: find(["bookmethod", "bookdepreciation", "deprmethod"]),
    book_useful_life_months: find(["bookusefullife", "usefullife", "booklife", "lifemonths"]),
    book_salvage_value: find(["booksalvage", "salvage", "salvagevalue", "residual"]),
    tax_cost_basis: find(["taxcostbasis", "taxbasis", "taxcost"]),
    tax_depreciation_method: find(["taxmethod", "taxdepreciation", "taxdepr"]),
    tax_useful_life_months: find(["taxusefullife", "taxlife"]),
    section_179_amount: find(["section179", "sec179", "179"]),
    bonus_depreciation_amount: find(["bonusdepreciation", "bonus", "bonusdepr"]),
    book_accumulated_depreciation: find(["bookaccumulateddepreciation", "bookaccumdepr", "accumdepr", "accumulateddepreciation", "bookaccum", "netbookvalue", "nbv", "bookvalue"]),
    tax_accumulated_depreciation: find(["taxaccumulateddepreciation", "taxaccumdepr", "taxaccum"]),
    status: find(["status", "assetstatus"]),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _rowIdCounter = 0;
function nextRowId(): string {
  return `row_${++_rowIdCounter}_${Date.now()}`;
}

function createEmptyRow(): AssetRow {
  return {
    _id: nextRowId(),
    _errors: {},
    asset_tag: "",
    asset_name: "",
    vehicle_class: "",
    vehicle_year: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_trim: "",
    vin: "",
    license_plate: "",
    license_state: "",
    mileage_at_acquisition: "",
    title_number: "",
    registration_expiry: "",
    vehicle_notes: "",
    acquisition_date: "",
    acquisition_cost: "",
    in_service_date: "",
    book_depreciation_method: "straight_line",
    book_useful_life_months: "60",
    book_salvage_value: "0",
    tax_cost_basis: "",
    tax_depreciation_method: "macrs_5",
    tax_useful_life_months: "",
    section_179_amount: "0",
    bonus_depreciation_amount: "0",
    book_accumulated_depreciation: "",
    tax_accumulated_depreciation: "",
    status: "active",
  };
}

function parseDateValue(value: unknown): string {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (typeof value === "number") {
    // Excel serial date — offset from 1899-12-30
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + value * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return "";
}

function resolveBookMethod(value: unknown): string {
  if (!value) return "straight_line";
  const s = String(value).toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("declining") || s.includes("ddb")) return "declining_balance";
  if (s.includes("none")) return "none";
  return "straight_line";
}

function resolveTaxMethod(value: unknown): string {
  if (!value) return "macrs_5";
  const s = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.includes("179") || s.includes("section179")) return "section_179";
  if (s.includes("bonus100") || s === "bonus") return "bonus_100";
  if (s.includes("bonus80")) return "bonus_80";
  if (s.includes("bonus60")) return "bonus_60";
  if (s.includes("macrs10") || s.includes("10year")) return "macrs_10";
  if (s.includes("macrs7") || s.includes("7year")) return "macrs_7";
  if (s.includes("macrs5") || s.includes("5year")) return "macrs_5";
  if (s.includes("macrs")) return "macrs_5";
  if (s.includes("straightline") || s.includes("sl")) return "straight_line_tax";
  if (s.includes("none")) return "none";
  return "macrs_5";
}

function resolveVehicleClass(value: unknown): string {
  if (!value) return "";
  const str = String(value).trim();
  if (str in VEHICLE_CLASSIFICATIONS) return str;
  const upper = str.toUpperCase();
  for (const code of Object.keys(VEHICLE_CLASSIFICATIONS)) {
    if (code.toUpperCase() === upper) return code;
  }
  const lower = str.toLowerCase();
  for (const [code, cls] of Object.entries(VEHICLE_CLASSIFICATIONS)) {
    if (cls.className.toLowerCase() === lower) return code;
  }
  for (const [code, cls] of Object.entries(VEHICLE_CLASSIFICATIONS)) {
    if (cls.className.toLowerCase().includes(lower)) return code;
  }
  return "";
}

function resolveStatus(value: unknown): string {
  if (!value) return "active";
  const s = String(value).toLowerCase().replace(/[^a-z_]/g, "");
  if (s.includes("disposed")) return "disposed";
  if (s.includes("fully") || s.includes("depreciated")) return "fully_depreciated";
  if (s.includes("inactive")) return "inactive";
  return "active";
}

function validateRow(row: AssetRow): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!row.acquisition_date) errors.acquisition_date = "Required";
  if (!row.acquisition_cost) errors.acquisition_cost = "Required";
  if (!row.in_service_date) errors.in_service_date = "Required";
  // Validate dates
  if (row.acquisition_date && isNaN(new Date(String(row.acquisition_date)).getTime())) {
    errors.acquisition_date = "Invalid date";
  }
  if (row.in_service_date && isNaN(new Date(String(row.in_service_date)).getTime())) {
    errors.in_service_date = "Invalid date";
  }
  return errors;
}

const CURRENCY_FIELDS: Set<string> = new Set([
  "acquisition_cost", "book_salvage_value", "tax_cost_basis",
  "section_179_amount", "bonus_depreciation_amount",
  "book_accumulated_depreciation", "tax_accumulated_depreciation",
]);

function formatCellDisplay(col: ColumnDef, value: unknown): string {
  const str = String(value ?? "");
  if (!str) return "";
  if (col.type === "select" && col.options) {
    const opt = col.options.find((o) => o.value === str);
    return opt?.label ?? str;
  }
  if (col.type === "number" && CURRENCY_FIELDS.has(col.key)) {
    const n = parseFloat(str);
    if (!isNaN(n)) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return str;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AssetImportWizardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [activeCell, setActiveCell] = useState<{ row: number; col: FieldKey } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Auto-update asset_name when year/make/model changes
  const updateAssetName = useCallback((row: AssetRow): AssetRow => {
    const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean);
    const autoName = parts.join(" ");
    // Only auto-fill if asset_name is empty or was auto-generated
    if (!row.asset_name || row.asset_name === row._prevAutoName) {
      return { ...row, asset_name: autoName, _prevAutoName: autoName };
    }
    return { ...row, _prevAutoName: autoName };
  }, []);

  // ---- File Upload ----

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      if (rawRows.length === 0) {
        toast.error("Spreadsheet is empty");
        return;
      }

      const headers = Object.keys(rawRows[0]);
      const hm = buildHeaderMap(headers);

      const parsed: AssetRow[] = rawRows.map((raw) => {
        const row = createEmptyRow();
        // Map fields
        if (hm.asset_tag) row.asset_tag = String(raw[hm.asset_tag] ?? "").trim();
        if (hm.asset_name) row.asset_name = String(raw[hm.asset_name] ?? "").trim();
        if (hm.vehicle_class) row.vehicle_class = resolveVehicleClass(raw[hm.vehicle_class]);
        if (hm.vehicle_year) {
          const y = raw[hm.vehicle_year];
          row.vehicle_year = typeof y === "number" ? String(Math.round(y)) : String(y ?? "").trim();
        }
        if (hm.vehicle_make) row.vehicle_make = String(raw[hm.vehicle_make] ?? "").trim();
        if (hm.vehicle_model) row.vehicle_model = String(raw[hm.vehicle_model] ?? "").trim();
        if (hm.vehicle_trim) row.vehicle_trim = String(raw[hm.vehicle_trim] ?? "").trim();
        if (hm.vin) row.vin = String(raw[hm.vin] ?? "").trim().toUpperCase();
        if (hm.license_plate) row.license_plate = String(raw[hm.license_plate] ?? "").trim().toUpperCase();
        if (hm.license_state) row.license_state = String(raw[hm.license_state] ?? "").trim().toUpperCase();
        if (hm.mileage_at_acquisition) {
          const m = raw[hm.mileage_at_acquisition];
          row.mileage_at_acquisition = typeof m === "number" ? String(Math.round(m)) : String(m ?? "").replace(/[^0-9]/g, "");
        }
        if (hm.title_number) row.title_number = String(raw[hm.title_number] ?? "").trim();
        if (hm.registration_expiry) row.registration_expiry = parseDateValue(raw[hm.registration_expiry]);
        if (hm.vehicle_notes) row.vehicle_notes = String(raw[hm.vehicle_notes] ?? "").trim();
        if (hm.acquisition_date) row.acquisition_date = parseDateValue(raw[hm.acquisition_date]);
        if (hm.acquisition_cost) {
          const c = raw[hm.acquisition_cost];
          row.acquisition_cost = typeof c === "number" ? String(c) : String(c ?? "").replace(/[$,\s]/g, "");
        }
        if (hm.in_service_date) row.in_service_date = parseDateValue(raw[hm.in_service_date]);
        if (hm.book_depreciation_method) row.book_depreciation_method = resolveBookMethod(raw[hm.book_depreciation_method]);
        if (hm.book_useful_life_months) {
          const v = raw[hm.book_useful_life_months];
          row.book_useful_life_months = typeof v === "number" ? String(Math.round(v)) : String(v ?? "").replace(/[^0-9]/g, "") || "60";
        }
        if (hm.book_salvage_value) {
          const v = raw[hm.book_salvage_value];
          row.book_salvage_value = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "") || "0";
        }
        if (hm.tax_cost_basis) {
          const v = raw[hm.tax_cost_basis];
          row.tax_cost_basis = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "");
        }
        if (hm.tax_depreciation_method) row.tax_depreciation_method = resolveTaxMethod(raw[hm.tax_depreciation_method]);
        if (hm.tax_useful_life_months) {
          const v = raw[hm.tax_useful_life_months];
          row.tax_useful_life_months = typeof v === "number" ? String(Math.round(v)) : String(v ?? "").replace(/[^0-9]/g, "");
        }
        if (hm.section_179_amount) {
          const v = raw[hm.section_179_amount];
          row.section_179_amount = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "") || "0";
        }
        if (hm.bonus_depreciation_amount) {
          const v = raw[hm.bonus_depreciation_amount];
          row.bonus_depreciation_amount = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "") || "0";
        }
        if (hm.book_accumulated_depreciation) {
          const v = raw[hm.book_accumulated_depreciation];
          row.book_accumulated_depreciation = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "");
          // If the header matched a "net book value" pattern, convert NBV → accumulated
          const hdrNorm = hm.book_accumulated_depreciation.toLowerCase().replace(/[^a-z0-9]/g, "");
          if ((hdrNorm.includes("nbv") || hdrNorm.includes("netbookvalue") || hdrNorm.includes("bookvalue")) && row.book_accumulated_depreciation && row.acquisition_cost) {
            const nbv = parseFloat(row.book_accumulated_depreciation);
            const cost = parseFloat(row.acquisition_cost);
            if (!isNaN(nbv) && !isNaN(cost)) {
              row.book_accumulated_depreciation = String(cost - nbv);
            }
          }
        }
        if (hm.tax_accumulated_depreciation) {
          const v = raw[hm.tax_accumulated_depreciation];
          row.tax_accumulated_depreciation = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "");
        }
        if (hm.status) row.status = resolveStatus(raw[hm.status]);

        // Auto-set in_service_date from acquisition_date if missing
        if (!row.in_service_date && row.acquisition_date) {
          row.in_service_date = row.acquisition_date;
        }

        // Auto-generate asset name
        const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean);
        if (parts.length > 0 && !row.asset_name) {
          row.asset_name = (parts as string[]).join(" ");
        }

        // Validate
        row._errors = validateRow(row);
        return row;
      });

      setRows(parsed);
      setStep(2);
      toast.success(`Loaded ${parsed.length} rows from ${file.name}`);
    } catch (err) {
      toast.error("Failed to parse spreadsheet");
      console.error(err);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ---- Template Download ----

  async function handleDownloadTemplate() {
    const XLSX = await import("xlsx");
    const supabase = createClient();
    const headers = COLUMNS.map((c) => c.label);

    // Fetch all existing assets for this entity
    const { data: assets } = await supabase
      .from("fixed_assets")
      .select(
        "asset_tag, asset_name, vehicle_class, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vin, license_plate, license_state, mileage_at_acquisition, title_number, registration_expiry, vehicle_notes, acquisition_date, acquisition_cost, in_service_date, book_depreciation_method, book_useful_life_months, book_salvage_value, book_accumulated_depreciation, tax_cost_basis, tax_depreciation_method, tax_useful_life_months, section_179_amount, bonus_depreciation_amount, tax_accumulated_depreciation, status"
      )
      .eq("entity_id", entityId)
      .order("acquisition_date");

    const BOOK_METHOD_LABELS: Record<string, string> = {
      straight_line: "Straight-Line",
      declining_balance: "Double Declining",
      none: "None",
    };
    const TAX_METHOD_LABELS: Record<string, string> = {
      macrs_5: "MACRS 5-Year",
      macrs_7: "MACRS 7-Year",
      macrs_10: "MACRS 10-Year",
      section_179: "Section 179",
      bonus_100: "100% Bonus",
      bonus_80: "80% Bonus",
      bonus_60: "60% Bonus",
      straight_line_tax: "Straight-Line (Tax)",
      none: "None",
    };
    const STATUS_LABELS: Record<string, string> = {
      active: "Active",
      disposed: "Disposed",
      fully_depreciated: "Fully Depreciated",
      inactive: "Inactive",
    };

    let dataRows: unknown[][];
    if (assets && assets.length > 0) {
      dataRows = assets.map((a) =>
        COLUMNS.map((col) => {
          const v = (a as Record<string, unknown>)[col.key];
          if (col.key === "book_depreciation_method") return BOOK_METHOD_LABELS[v as string] ?? v ?? "";
          if (col.key === "tax_depreciation_method") return TAX_METHOD_LABELS[v as string] ?? v ?? "";
          if (col.key === "status") return STATUS_LABELS[v as string] ?? v ?? "";
          if (v === null || v === undefined) return "";
          return v;
        })
      );
    } else {
      // Fallback: single example row
      dataRows = [
        COLUMNS.map((c) => {
          switch (c.key) {
            case "asset_tag": return "VEH-001";
            case "vehicle_class": return "13";
            case "vehicle_year": return 2024;
            case "vehicle_make": return "Ford";
            case "vehicle_model": return "F-150";
            case "vehicle_trim": return "XLT";
            case "vin": return "1FTFW1E80NFA12345";
            case "license_plate": return "ABC1234";
            case "license_state": return "CA";
            case "mileage_at_acquisition": return 0;
            case "acquisition_date": return "2024-01-15";
            case "acquisition_cost": return 45000;
            case "in_service_date": return "2024-01-20";
            case "book_depreciation_method": return "Straight-Line";
            case "book_useful_life_months": return 60;
            case "book_salvage_value": return 5000;
            case "tax_depreciation_method": return "MACRS 5-Year";
            case "status": return "Active";
            default: return "";
          }
        }),
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = COLUMNS.map((c) => ({ wch: Math.max(c.label.length + 2, Math.round(c.width / 8)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rental Assets");
    XLSX.writeFile(wb, "rental_assets_import_template.xlsx");
  }

  // ---- Start Blank ----

  function handleStartBlank() {
    setRows(Array.from({ length: 10 }, () => createEmptyRow()));
    setFileName(null);
    setStep(2);
  }

  // ---- Cell Editing ----

  function handleCellClick(rowIdx: number, colKey: FieldKey) {
    setActiveCell({ row: rowIdx, col: colKey });
  }

  function handleCellChange(rowIdx: number, colKey: FieldKey, value: string) {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIdx] };
      row[colKey] = value;
      // Auto-update asset name
      if (colKey === "vehicle_year" || colKey === "vehicle_make" || colKey === "vehicle_model") {
        const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean);
        const autoName = (parts as string[]).join(" ");
        if (!row.asset_name || row._prevAutoName === row.asset_name) {
          row.asset_name = autoName;
        }
        row._prevAutoName = autoName;
      }
      // Auto-copy acq date to in-service if in-service is empty
      if (colKey === "acquisition_date" && !row.in_service_date) {
        row.in_service_date = value;
      }
      // Re-validate
      row._errors = validateRow(row);
      updated[rowIdx] = row;
      return updated;
    });
  }

  function handleCellBlur() {
    // We keep activeCell set — it only changes on click or keyboard navigation
  }

  function handleCellKeyDown(e: React.KeyboardEvent, rowIdx: number, colKey: FieldKey) {
    const colIdx = COLUMNS.findIndex((c) => c.key === colKey);
    if (e.key === "Tab") {
      e.preventDefault();
      const nextColIdx = e.shiftKey ? colIdx - 1 : colIdx + 1;
      if (nextColIdx >= 0 && nextColIdx < COLUMNS.length) {
        setActiveCell({ row: rowIdx, col: COLUMNS[nextColIdx].key });
      } else if (!e.shiftKey && rowIdx < rows.length - 1) {
        setActiveCell({ row: rowIdx + 1, col: COLUMNS[0].key });
      } else if (e.shiftKey && rowIdx > 0) {
        setActiveCell({ row: rowIdx - 1, col: COLUMNS[COLUMNS.length - 1].key });
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (rowIdx < rows.length - 1) {
        setActiveCell({ row: rowIdx + 1, col: colKey });
      }
    } else if (e.key === "Escape") {
      setActiveCell(null);
    }
  }

  // ---- Row Management ----

  function addRows(count: number = 5) {
    setRows((prev) => [...prev, ...Array.from({ length: count }, () => createEmptyRow())]);
  }

  function deleteRow(rowIdx: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
    setActiveCell(null);
  }

  // ---- Validate All ----

  function validateAll(): boolean {
    let valid = true;
    setRows((prev) =>
      prev.map((row) => {
        const errors = validateRow(row);
        if (Object.keys(errors).length > 0) valid = false;
        return { ...row, _errors: errors };
      })
    );
    return valid;
  }

  // ---- Import ----

  async function handleImport() {
    // Remove fully empty rows
    const nonEmpty = rows.filter((row) => {
      return COLUMNS.some((col) => {
        const val = String(row[col.key] ?? "");
        if (col.key === "book_depreciation_method" && val === "straight_line") return false;
        if (col.key === "tax_depreciation_method" && val === "macrs_5") return false;
        if (col.key === "book_useful_life_months" && val === "60") return false;
        if (col.key === "book_salvage_value" && val === "0") return false;
        if (col.key === "section_179_amount" && val === "0") return false;
        if (col.key === "bonus_depreciation_amount" && val === "0") return false;
        if (col.key === "status" && val === "active") return false;
        return !!val;
      });
    });

    if (nonEmpty.length === 0) {
      toast.error("No data to import — all rows are empty");
      return;
    }

    setRows(nonEmpty);

    // Validate
    let hasErrors = false;
    const validated: AssetRow[] = nonEmpty.map((row) => {
      const errors = validateRow(row);
      if (Object.keys(errors).length > 0) hasErrors = true;
      return { ...row, _errors: errors };
    });
    setRows(validated);

    if (hasErrors) {
      toast.error("Fix validation errors before importing (required fields highlighted in red)");
      return;
    }

    setImporting(true);
    setImportProgress(10);

    // Build API payload
    const payload = validated.map((row) => ({
      asset_tag: String(row.asset_tag || ""),
      asset_name: String(row.asset_name || ""),
      vehicle_class: String(row.vehicle_class || "") || undefined,
      vehicle_year: row.vehicle_year ? Number(row.vehicle_year) : undefined,
      vehicle_make: String(row.vehicle_make || "") || undefined,
      vehicle_model: String(row.vehicle_model || "") || undefined,
      vehicle_trim: String(row.vehicle_trim || "") || undefined,
      vin: String(row.vin || "") || undefined,
      license_plate: String(row.license_plate || "") || undefined,
      license_state: String(row.license_state || "") || undefined,
      mileage_at_acquisition: row.mileage_at_acquisition ? Number(row.mileage_at_acquisition) : undefined,
      title_number: String(row.title_number || "") || undefined,
      registration_expiry: String(row.registration_expiry || "") || undefined,
      vehicle_notes: String(row.vehicle_notes || "") || undefined,
      acquisition_date: String(row.acquisition_date),
      acquisition_cost: Number(row.acquisition_cost),
      in_service_date: String(row.in_service_date),
      book_useful_life_months: Number(row.book_useful_life_months) || 60,
      book_salvage_value: Number(row.book_salvage_value) || 0,
      book_depreciation_method: String(row.book_depreciation_method || "straight_line"),
      tax_cost_basis: row.tax_cost_basis ? Number(row.tax_cost_basis) : undefined,
      tax_depreciation_method: String(row.tax_depreciation_method || "macrs_5"),
      tax_useful_life_months: row.tax_useful_life_months ? Number(row.tax_useful_life_months) : undefined,
      section_179_amount: Number(row.section_179_amount) || 0,
      bonus_depreciation_amount: Number(row.bonus_depreciation_amount) || 0,
      book_accumulated_depreciation: row.book_accumulated_depreciation ? Number(row.book_accumulated_depreciation) : undefined,
      tax_accumulated_depreciation: row.tax_accumulated_depreciation ? Number(row.tax_accumulated_depreciation) : undefined,
      status: String(row.status || "active"),
    }));

    setImportProgress(30);

    try {
      const res = await fetch("/api/assets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, rows: payload }),
      });

      setImportProgress(90);
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Import failed");
        setImporting(false);
        return;
      }

      setImportProgress(100);
      setResults(json);
      setStep(3);
    } catch {
      toast.error("Import failed — network error");
    }

    setImporting(false);
  }

  // ---- Render ----

  const colGroups = getColumnGroups();
  const totalErrors = rows.reduce(
    (sum, row) => sum + Object.keys(row._errors).length,
    0
  );
  const filledRows = rows.filter((row) =>
    row.acquisition_date || row.acquisition_cost
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (step === 2) setStep(1);
            else router.push(`/${entityId}/assets`);
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {step === 2 ? "Back" : "Assets"}
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Import Rental Assets</h1>
          <p className="text-muted-foreground">
            {step === 1 && "Upload a spreadsheet or start with a blank grid"}
            {step === 2 && "Review and edit your data, then import"}
            {step === 3 && "Import complete"}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 text-sm">
        <StepBadge num={1} label="Upload" active={step === 1} done={step > 1} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <StepBadge num={2} label="Review & Edit" active={step === 2} done={step > 2} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <StepBadge num={3} label="Results" active={step === 3} done={false} />
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
          {/* Upload Card */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Spreadsheet
              </CardTitle>
              <CardDescription>
                Import from an Excel (.xlsx) or CSV file. Columns are
                auto-mapped to asset fields.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
              >
                <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">Click to upload or drag & drop</p>
                <p className="text-sm text-muted-foreground mt-1">
                  XLSX, XLS, or CSV
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Options */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Start Blank</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Open an empty spreadsheet grid and enter assets manually.
                </p>
                <Button onClick={handleStartBlank} variant="outline" className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Blank Grid
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Download Template</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Get an Excel template with all available columns and sample data.
                </p>
                <Button onClick={handleDownloadTemplate} variant="outline" className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Template (.xlsx)
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Step 2: Spreadsheet */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{rows.length}</span> rows
              {filledRows > 0 && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span className="font-medium text-foreground">{filledRows}</span> with data
                </>
              )}
              {totalErrors > 0 && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  <span className="font-medium text-destructive">{totalErrors}</span> errors
                </>
              )}
            </div>
            {fileName && (
              <Badge variant="secondary" className="text-xs">
                {fileName}
              </Badge>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => addRows(5)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add 5 Rows
            </Button>
            <Button variant="outline" size="sm" onClick={() => addRows(1)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Row
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || rows.length === 0}
            >
              {importing ? "Importing..." : "Import All"}
            </Button>
          </div>

          {importing && (
            <Progress value={importProgress} className="h-2" />
          )}

          {/* Spreadsheet Grid */}
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
              <table className="text-sm border-collapse min-w-max">
                {/* Column Group Headers */}
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th
                      className="sticky left-0 z-30 bg-background border-b border-r px-2 py-1.5 text-center font-medium text-muted-foreground"
                      style={{ width: 52 }}
                      rowSpan={2}
                    >
                      #
                    </th>
                    {colGroups.map(({ group, span }) => (
                      <th
                        key={group}
                        colSpan={span}
                        className={`border-b border-r px-2 py-1 text-center text-xs font-semibold uppercase tracking-wider ${GROUP_COLORS[group].bg} ${GROUP_COLORS[group].text} ${GROUP_COLORS[group].border}`}
                      >
                        {GROUP_LABELS[group]}
                      </th>
                    ))}
                    <th
                      className="sticky right-0 z-30 bg-background border-b border-l px-2 py-1.5"
                      style={{ width: 40 }}
                      rowSpan={2}
                    />
                  </tr>
                  {/* Column Headers */}
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`border-b border-r px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap ${GROUP_COLORS[col.group].bg} ${GROUP_COLORS[col.group].text}`}
                        style={{ width: col.width, minWidth: col.width }}
                      >
                        {col.shortLabel || col.label}
                        {col.required && <span className="text-destructive ml-0.5">*</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr
                      key={row._id}
                      className={`${rowIdx % 2 === 0 ? "bg-background" : "bg-muted/30"} hover:bg-muted/50`}
                    >
                      {/* Row Number */}
                      <td className="sticky left-0 z-10 bg-inherit border-b border-r px-2 py-0.5 text-center text-xs text-muted-foreground font-mono tabular-nums">
                        {rowIdx + 1}
                      </td>
                      {/* Data Cells */}
                      {COLUMNS.map((col) => {
                        const isActive = activeCell?.row === rowIdx && activeCell?.col === col.key;
                        const error = row._errors[col.key];
                        const value = String(row[col.key] ?? "");

                        return (
                          <td
                            key={col.key}
                            className={`border-b border-r p-0 ${error ? "bg-destructive/10" : ""}`}
                            style={{ width: col.width, minWidth: col.width }}
                            onClick={() => handleCellClick(rowIdx, col.key)}
                            title={error || undefined}
                          >
                            {isActive ? (
                              <CellEditor
                                col={col}
                                value={value}
                                onChange={(v) => handleCellChange(rowIdx, col.key, v)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIdx, col.key)}
                                error={error}
                              />
                            ) : (
                              <div
                                className={`px-2 py-1 h-[30px] flex items-center text-xs truncate cursor-text ${
                                  error ? "text-destructive" : ""
                                } ${!value ? "text-muted-foreground/50" : ""}`}
                              >
                                {formatCellDisplay(col, value) || col.placeholder || ""}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {/* Delete */}
                      <td className="sticky right-0 z-10 bg-inherit border-b border-l px-1 py-0.5 text-center">
                        <button
                          onClick={() => deleteRow(rowIdx)}
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete row"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Field Legend */}
          <div className="flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
            <span><span className="text-destructive font-medium">*</span> = required field</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-destructive/10 border border-destructive/30" />
              = validation error
            </span>
            <span>Tab to move between cells, Enter to move down, Esc to deselect</span>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && results && (
        <div className="max-w-lg space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Import Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                    {results.imported}
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400">Imported</p>
                </div>
                <div className="text-center p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                    {results.skipped}
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400">Skipped</p>
                </div>
              </div>

              {results.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">Errors:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {results.errors.map((err, i) => (
                      <p key={i} className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
                        {err}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Link href={`/${entityId}/assets`} className="flex-1">
                  <Button className="w-full">
                    View Assets
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep(1);
                    setRows([]);
                    setResults(null);
                    setImportProgress(0);
                    setFileName(null);
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Import More
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${active ? "text-primary font-medium" : done ? "text-green-600" : "text-muted-foreground"}`}>
      <span
        className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium ${
          active
            ? "bg-primary text-primary-foreground"
            : done
            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : num}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function CellEditor({
  col,
  value,
  onChange,
  onKeyDown,
  error,
}: {
  col: ColumnDef;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const baseClasses = `w-full h-[30px] px-2 text-xs border-0 outline-none ring-2 ring-inset ${
    error ? "ring-destructive bg-destructive/5" : "ring-primary bg-primary/5"
  }`;

  if (col.type === "select" && col.options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={`${baseClasses} cursor-pointer`}
      >
        <option value="">—</option>
        {col.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={col.type === "date" ? "date" : col.type === "number" ? "text" : "text"}
      value={value}
      onChange={(e) => {
        let v = e.target.value;
        if (col.uppercase) v = v.toUpperCase();
        onChange(v);
      }}
      onKeyDown={onKeyDown}
      placeholder={col.placeholder}
      className={baseClasses}
      inputMode={col.type === "number" ? "decimal" : undefined}
    />
  );
}
