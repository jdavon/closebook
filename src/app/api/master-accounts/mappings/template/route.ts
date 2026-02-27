import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import * as XLSX from "xlsx";

/**
 * GET /api/master-accounts/mappings/template?entityId=<uuid>
 *
 * Generates a downloadable Excel template pre-filled with the entity's
 * accounts.  The user fills in the "Master GL Account" column and
 * uploads the result via the import endpoint.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json(
      { error: "entityId query parameter is required" },
      { status: 400 }
    );
  }

  // ── Resolve organisation ─────────────────────────────────────────────
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "No organization found" },
      { status: 404 }
    );
  }

  const orgId = membership.organization_id;

  // Verify entity belongs to the organisation
  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, code")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .single();

  if (!entity) {
    return NextResponse.json(
      { error: "Entity not found in your organization" },
      { status: 404 }
    );
  }

  // ── Load entity accounts ─────────────────────────────────────────────
  const entityAccounts = await fetchAllPaginated<any>((offset, limit) =>
    supabase
      .from("accounts")
      .select("account_number, name, classification, account_type")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("classification")
      .order("account_number")
      .order("name")
      .range(offset, offset + limit - 1)
  );

  // ── Load master accounts (for the reference sheet) ───────────────────
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    supabase
      .from("master_accounts")
      .select("account_number, name, classification")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number")
      .range(offset, offset + limit - 1)
  );

  // ── Build workbook ───────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Mappings (user fills in the last column)
  const mappingRows = [
    [
      "Entity Account Number",
      "Entity Account Name",
      "Classification",
      "Master GL Account",
    ],
    ...entityAccounts.map((a) => [
      a.account_number ?? "",
      a.name,
      a.classification,
      "", // user fills this in
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(mappingRows);
  ws["!cols"] = [{ wch: 24 }, { wch: 44 }, { wch: 16 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, ws, "Mappings");

  // Sheet 2 — Master GL Accounts (reference list)
  const refRows = [
    ["Master Account Number", "Master Account Name", "Classification"],
    ...masterAccounts.map((m) => [
      m.account_number,
      m.name,
      m.classification,
    ]),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(refRows);
  refWs["!cols"] = [{ wch: 22 }, { wch: 44 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, refWs, "Master GL Accounts");

  // ── Return as downloadable file ──────────────────────────────────────
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `mapping-template-${entity.code || entity.name}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
