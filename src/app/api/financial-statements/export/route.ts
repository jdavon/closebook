import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import type { StatementData } from "@/components/financial-statements/types";

// Re-use the main financial statements API logic by fetching from it internally
async function fetchStatements(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();

  // Forward all query params to the main API
  for (const [key, value] of searchParams.entries()) {
    params.set(key, value);
  }

  const baseUrl = new URL(request.url);
  const apiUrl = `${baseUrl.origin}/api/financial-statements?${params.toString()}`;

  const response = await fetch(apiUrl, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error ?? "Failed to fetch financial statements");
  }

  return response.json();
}

export async function GET(request: Request) {
  try {
    const data = await fetchStatements(request);

    const {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata,
    } = data;

    const periodLabels: string[] = periods.map(
      (p: { label: string }) => p.label
    );
    const periodKeys: string[] = periods.map(
      (p: { key: string }) => p.key
    );

    const wb = XLSX.utils.book_new();

    // Helper that uses period keys directly (more reliable than label matching)
    function addSheet(
      sheetName: string,
      statement: StatementData
    ) {
      const rows: (string | number | null)[][] = [];

      // Title
      const titleLine = metadata?.organizationName
        ? `${metadata.organizationName} — ${statement.title}`
        : statement.title;
      rows.push([titleLine]);
      rows.push([]);

      // Header
      rows.push(["", ...periodLabels]);

      for (const section of statement.sections) {
        if (section.title) {
          rows.push([section.title]);
        }

        for (const line of section.lines) {
          if (line.isHeader) {
            rows.push([`  ${line.label}`]);
            continue;
          }
          if (line.isSeparator) continue;

          const row: (string | number | null)[] = [`    ${line.label}`];
          for (const key of periodKeys) {
            row.push(line.amounts[key] ?? null);
          }
          rows.push(row);
        }

        if (section.subtotalLine) {
          const line = section.subtotalLine;
          const isMargin = line.id.endsWith("_margin");
          const row: (string | number | null)[] = [
            isMargin ? `  ${line.label}` : line.label,
          ];
          for (const key of periodKeys) {
            let val = line.amounts[key] ?? null;
            if (isMargin && val !== null) val = val * 100;
            row.push(val);
          }
          rows.push(row);
        }

        if (section.title) rows.push([]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 45 },
        ...periodLabels.map(() => ({ wch: 16 })),
      ];

      // Apply number format to data cells
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (let r = 3; r <= range.e.r; r++) {
        for (let c = 1; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell && typeof cell.v === "number") {
            cell.z = "#,##0";
          }
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    addSheet("Income Statement", incomeStatement);
    addSheet("Balance Sheet", balanceSheet);
    addSheet("Cash Flow", cashFlowStatement);

    const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const entityName =
      metadata?.entityName ?? metadata?.organizationName ?? "financial";
    const filename = `${entityName.replace(/[^a-zA-Z0-9]/g, "_")}_statements_${metadata?.startPeriod}_to_${metadata?.endPeriod}.xlsx`;

    return new Response(xlsxBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
