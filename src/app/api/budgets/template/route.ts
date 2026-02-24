import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

// GET — download a pre-populated budget template XLSX
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");
  const fiscalYear = searchParams.get("fiscalYear") ?? "2025";

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Get entity info
  const { data: entity } = await admin
    .from("entities")
    .select("name, code")
    .eq("id", entityId)
    .single();

  // Get accounts for the entity (P&L accounts for budgeting)
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, name, account_number, classification, account_type")
    .eq("entity_id", entityId)
    .eq("is_active", true)
    .in("classification", ["Revenue", "Expense"])
    .order("classification")
    .order("account_number");

  const accountList = accounts ?? [];

  // Build worksheet data
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const wsData: (string | number)[][] = [];

  // Header row
  wsData.push([
    "Account Number",
    "Account Name",
    "Classification",
    ...MONTHS.map((m) => `${m} ${fiscalYear}`),
    "Annual Total",
  ]);

  // Account rows
  for (const account of accountList) {
    wsData.push([
      account.account_number ?? "",
      account.name,
      account.classification,
      // 12 blank month columns
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      // Annual total formula placeholder (will show 0)
      0,
    ]);
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws["!cols"] = [
    { wch: 18 }, // Account Number
    { wch: 40 }, // Account Name
    { wch: 15 }, // Classification
    ...MONTHS.map(() => ({ wch: 15 })), // Month columns
    { wch: 15 }, // Annual Total
  ];

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    `Budget ${fiscalYear}`
  );

  // Add instructions sheet
  const instrData = [
    ["Budget Import Template"],
    [""],
    [`Entity: ${entity?.name ?? "Unknown"} (${entity?.code ?? ""})`],
    [`Fiscal Year: ${fiscalYear}`],
    [""],
    ["Instructions:"],
    ["1. Fill in monthly budget amounts for each account."],
    ["2. Amounts should be positive for both Revenue and Expense accounts."],
    ["3. Leave amounts as 0 for accounts with no budget."],
    ["4. Do not modify Account Number or Account Name columns."],
    ["5. Save the file and upload it on the Budget Management page."],
    [""],
    ["Notes:"],
    ["- Only Revenue and Expense accounts are included (P&L budget)."],
    ["- Balance Sheet accounts are not budgeted in this template."],
    ["- The Annual Total column is for reference only and not imported."],
  ];

  const instrWs = XLSX.utils.aoa_to_sheet(instrData);
  instrWs["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

  // Generate buffer
  const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `budget_template_${entity?.code ?? entityId}_${fiscalYear}.xlsx`;

  return new Response(xlsxBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
