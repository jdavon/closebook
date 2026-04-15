/**
 * Excel export helpers shared across the rental asset schedules. Builds
 * audit-ready workbooks — title block, formatted headers, zebra rows,
 * totals line, frozen panes, currency/date formats — all from a single
 * declarative config so each report looks consistent.
 */
import ExcelJS, { type Workbook, type Worksheet, type Fill } from "exceljs";

/** Standard number format strings used across the schedules. */
export const NUMBER_FORMATS = {
  currency: '_-$* #,##0.00_-;[Red]_-$* (#,##0.00);_-$* "-"??_-;_-@_-',
  currencyWhole: '_-$* #,##0_-;[Red]_-$* (#,##0);_-$* "-"_-;_-@_-',
  number: "#,##0.00;[Red](#,##0.00);-",
  integer: "#,##0;[Red](#,##0);-",
  percent: "0.00%",
  date: "m/d/yyyy",
  month: "mmm yyyy",
};

const HEADER_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F3A5F" }, // deep navy — professional, prints well mono
};

const SUBHEADER_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8ECF1" }, // pale slate
};

const ZEBRA_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF7F9FC" }, // near-white alternating
};

export type Align = "left" | "right" | "center";

export interface ColumnDef<T> {
  header: string;
  /** Width in Excel units (1 unit ≈ 1 character). */
  width: number;
  /** How cells in this column render a row's value. */
  value: (row: T) => string | number | Date | null | undefined;
  /** Number-format string (see NUMBER_FORMATS) or undefined for text. */
  format?: string;
  align?: Align;
  /** Optional totaling — "sum" or "none" (default). */
  total?: "sum" | "none";
  /** Custom formatter to render totals for this column (e.g. "—"). */
  totalValue?: (rows: T[]) => string | number | Date | null | undefined;
}

export interface TitleBlock {
  entityName?: string | null;
  reportTitle: string;
  /** Period shown under the report title (e.g. "Year Ended Dec 31, 2025"). */
  period?: string;
  /** Optional subtitle line (e.g. "Vehicles & Trailers"). */
  subtitle?: string;
  /** Optional "As of" date line. */
  asOf?: string;
}

export interface SheetDef<T> {
  name: string;
  columns: ColumnDef<T>[];
  rows: T[];
  title: TitleBlock;
  /** Group rows on a field; groups render with a label row and group total. */
  groupBy?: (row: T) => string;
  /** Sort applied before grouping/rendering (stable). */
  sort?: (a: T, b: T) => number;
  /** If true, emit a grand total row. */
  grandTotal?: boolean;
  /** Optional note line shown below the totals. */
  footnote?: string;
}

/**
 * Apply the standard title block at the top of a worksheet and return the
 * next free row (1-indexed). Caller then appends headers/data from that row.
 */
function writeTitleBlock(ws: Worksheet, columnCount: number, title: TitleBlock): number {
  let row = 1;
  if (title.entityName) {
    ws.mergeCells(row, 1, row, columnCount);
    const cell = ws.getCell(row, 1);
    cell.value = title.entityName;
    cell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF1F3A5F" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(row).height = 20;
    row++;
  }
  ws.mergeCells(row, 1, row, columnCount);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = title.reportTitle;
  titleCell.font = { name: "Calibri", size: 16, bold: true };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(row).height = 24;
  row++;
  if (title.subtitle) {
    ws.mergeCells(row, 1, row, columnCount);
    const c = ws.getCell(row, 1);
    c.value = title.subtitle;
    c.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF4A5568" } };
    row++;
  }
  if (title.period) {
    ws.mergeCells(row, 1, row, columnCount);
    const c = ws.getCell(row, 1);
    c.value = title.period;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF4A5568" } };
    row++;
  }
  if (title.asOf) {
    ws.mergeCells(row, 1, row, columnCount);
    const c = ws.getCell(row, 1);
    c.value = title.asOf;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF4A5568" } };
    row++;
  }
  // Blank spacer row
  row++;
  return row;
}

function styleHeaderRow(ws: Worksheet, rowIdx: number, columns: ColumnDef<unknown>[]) {
  const headerRow = ws.getRow(rowIdx);
  headerRow.height = 22;
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? (col.format ? "right" : "left"),
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F3A5F" } },
      bottom: { style: "thin", color: { argb: "FF1F3A5F" } },
      left: { style: "thin", color: { argb: "FFFFFFFF" } },
      right: { style: "thin", color: { argb: "FFFFFFFF" } },
    };
  });
}

function writeBodyRow<T>(
  ws: Worksheet,
  rowIdx: number,
  row: T,
  columns: ColumnDef<T>[],
  zebra: boolean,
  indent = 0
) {
  const r = ws.getRow(rowIdx);
  columns.forEach((col, idx) => {
    const cell = r.getCell(idx + 1);
    const raw = col.value(row);
    cell.value = raw as ExcelJS.CellValue;
    if (col.format) cell.numFmt = col.format;
    cell.font = { name: "Calibri", size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? (col.format ? "right" : "left"),
      indent: idx === 0 ? indent : 0,
    };
    if (zebra) cell.fill = ZEBRA_FILL;
    cell.border = {
      bottom: { style: "hair", color: { argb: "FFD1D5DB" } },
    };
  });
}

function writeTotalRow<T>(
  ws: Worksheet,
  rowIdx: number,
  label: string,
  rows: T[],
  columns: ColumnDef<T>[],
  fill: Fill = SUBHEADER_FILL
) {
  const r = ws.getRow(rowIdx);
  columns.forEach((col, idx) => {
    const cell = r.getCell(idx + 1);
    if (idx === 0) {
      cell.value = label;
    } else if (col.totalValue) {
      cell.value = col.totalValue(rows) as ExcelJS.CellValue;
    } else if (col.total === "sum" && col.format) {
      // Derive sum from the column values of the given rows.
      let sum = 0;
      for (const row of rows) {
        const v = col.value(row);
        if (typeof v === "number") sum += v;
      }
      cell.value = sum;
    } else {
      cell.value = "";
    }
    if (col.format && cell.value !== "") cell.numFmt = col.format;
    cell.font = { name: "Calibri", size: 10, bold: true };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? (col.format ? "right" : "left"),
    };
    cell.fill = fill;
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F3A5F" } },
      bottom: { style: "double", color: { argb: "FF1F3A5F" } },
    };
  });
}

export function addSheet<T>(wb: Workbook, def: SheetDef<T>): Worksheet {
  const ws = wb.addWorksheet(def.name, {
    views: [{ state: "frozen", xSplit: 0, ySplit: 0, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 16 },
  });

  // Column widths
  ws.columns = def.columns.map((c) => ({ width: c.width }));

  const columnCount = def.columns.length;
  let rowIdx = writeTitleBlock(ws, columnCount, def.title);

  // Header row
  styleHeaderRow(ws, rowIdx, def.columns as ColumnDef<unknown>[]);
  const headerRowIdx = rowIdx;
  rowIdx++;

  // Freeze below title + header
  ws.views = [
    {
      state: "frozen",
      xSplit: 1,
      ySplit: headerRowIdx,
      showGridLines: false,
    },
  ];

  const sortedRows = def.sort ? [...def.rows].sort(def.sort) : def.rows;

  if (def.groupBy) {
    const groups = new Map<string, T[]>();
    for (const row of sortedRows) {
      const key = def.groupBy(row);
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    for (const [key, groupRows] of groups) {
      // Group label row
      const labelRow = ws.getRow(rowIdx);
      ws.mergeCells(rowIdx, 1, rowIdx, columnCount);
      const cell = labelRow.getCell(1);
      cell.value = key;
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF1F3A5F" } };
      cell.fill = SUBHEADER_FILL;
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      cell.border = {
        top: { style: "thin", color: { argb: "FF1F3A5F" } },
      };
      rowIdx++;

      // Group body rows
      groupRows.forEach((row, i) => {
        writeBodyRow(ws, rowIdx, row, def.columns, i % 2 === 1, 1);
        rowIdx++;
      });

      // Group subtotal
      writeTotalRow(ws, rowIdx, `${key} Total`, groupRows, def.columns);
      rowIdx++;
    }
  } else {
    sortedRows.forEach((row, i) => {
      writeBodyRow(ws, rowIdx, row, def.columns, i % 2 === 1);
      rowIdx++;
    });
  }

  if (def.grandTotal) {
    writeTotalRow(ws, rowIdx, "Grand Total", sortedRows, def.columns, {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD7DEE8" },
    });
    rowIdx++;
  }

  if (def.footnote) {
    rowIdx++;
    const cell = ws.getCell(rowIdx, 1);
    ws.mergeCells(rowIdx, 1, rowIdx, columnCount);
    cell.value = def.footnote;
    cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF6B7280" } };
  }

  return ws;
}

export interface MatrixColumn {
  header: string;
  width?: number;
  format?: string;
}

export interface MatrixRow {
  /** Row label shown in the first column. */
  label: string;
  /** One value per data column. */
  values: (number | string | null | undefined)[];
  bold?: boolean;
  /** Top border and semi-bold treatment — use for totals / ending lines. */
  totalStyle?: boolean;
  /** Parenthesize & optionally color red (negative presentation). */
  presentation?: "positive" | "parenNegative" | "parenNegativeRed";
  /** Indent the label (useful for nested breakdown rows). */
  indent?: number;
}

export interface MatrixSheetDef {
  name: string;
  title: TitleBlock;
  /** First column is the row label — subsequent columns are periods. */
  labelColumn: { header: string; width: number };
  periodColumns: MatrixColumn[];
  rows: MatrixRow[];
  /** Optional section title block above a group of rows. Each string is the label for the next row index. */
  sections?: { afterRowIndex: number; title: string }[];
}

/**
 * Build a "wide" roll-forward-style sheet where each period is a column and
 * the rows are beginning / additions / disposals / ending balances.
 */
export function addMatrixSheet(wb: Workbook, def: MatrixSheetDef): Worksheet {
  const ws = wb.addWorksheet(def.name, {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 16 },
  });

  const columnCount = def.periodColumns.length + 1;
  ws.columns = [
    { width: def.labelColumn.width },
    ...def.periodColumns.map((c) => ({ width: c.width ?? 14 })),
  ];

  let rowIdx = writeTitleBlock(ws, columnCount, def.title);

  // Header row
  const headerRow = ws.getRow(rowIdx);
  headerRow.height = 22;
  const labelHeader = headerRow.getCell(1);
  labelHeader.value = def.labelColumn.header;
  labelHeader.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  labelHeader.fill = HEADER_FILL;
  labelHeader.alignment = { vertical: "middle", horizontal: "left" };
  labelHeader.border = {
    top: { style: "thin", color: { argb: "FF1F3A5F" } },
    bottom: { style: "thin", color: { argb: "FF1F3A5F" } },
  };
  def.periodColumns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 2);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "right" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F3A5F" } },
      bottom: { style: "thin", color: { argb: "FF1F3A5F" } },
    };
  });
  const headerRowIdx = rowIdx;
  rowIdx++;

  ws.views = [
    {
      state: "frozen",
      xSplit: 1,
      ySplit: headerRowIdx,
      showGridLines: false,
    },
  ];

  def.rows.forEach((row) => {
    const r = ws.getRow(rowIdx);
    const labelCell = r.getCell(1);
    labelCell.value = row.label;
    labelCell.font = {
      name: "Calibri",
      size: 10,
      bold: row.bold || row.totalStyle,
    };
    labelCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      indent: row.indent ?? 0,
    };
    if (row.totalStyle) {
      labelCell.border = {
        top: { style: "thin", color: { argb: "FF1F3A5F" } },
      };
    }
    row.values.forEach((v, idx) => {
      const cell = r.getCell(idx + 2);
      const col = def.periodColumns[idx];
      if (typeof v === "number") {
        if (
          (row.presentation === "parenNegative" ||
            row.presentation === "parenNegativeRed") &&
          v !== 0
        ) {
          // Positive displayed as parens (accumulated as contra-asset).
          cell.value = v;
          cell.numFmt = row.presentation === "parenNegativeRed"
            ? '[Red]"("$#,##0.00")";"-"'
            : '"("$#,##0.00")";"-"';
        } else {
          cell.value = v;
          cell.numFmt = col.format ?? NUMBER_FORMATS.currency;
        }
      } else if (v == null || v === "") {
        cell.value = "";
      } else {
        cell.value = v;
      }
      cell.font = {
        name: "Calibri",
        size: 10,
        bold: row.bold || row.totalStyle,
      };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      if (row.totalStyle) {
        cell.border = {
          top: { style: "thin", color: { argb: "FF1F3A5F" } },
          bottom: { style: "double", color: { argb: "FF1F3A5F" } },
        };
      }
    });
    rowIdx++;
  });

  return ws;
}

/**
 * Download a workbook as a file in the browser. Safe to call on the client
 * only — returns immediately on the server.
 */
export async function downloadWorkbook(wb: Workbook, filename: string): Promise<void> {
  if (typeof window === "undefined") return;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Build a fresh workbook with standard metadata. */
export function createWorkbook(opts?: {
  creator?: string;
  title?: string;
  company?: string;
}): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts?.creator ?? "Accounting App";
  wb.company = opts?.company ?? "";
  wb.created = new Date();
  wb.modified = new Date();
  if (opts?.title) wb.title = opts.title;
  return wb;
}

/** Format a YYYY-MM-DD ISO date into "MMM D, YYYY" for title blocks. */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** Parse YYYY-MM-DD → JS Date without timezone drift. */
export function parseIsoDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}
