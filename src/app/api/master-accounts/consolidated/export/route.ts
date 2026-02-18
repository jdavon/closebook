import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const periodYear = searchParams.get("periodYear");
  const periodMonth = searchParams.get("periodMonth");

  if (!organizationId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "organizationId, periodYear, and periodMonth are required" },
      { status: 400 }
    );
  }

  // Verify access
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(name)")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Fetch consolidated data by calling the consolidated logic inline
  const adminClient = createAdminClient();
  const pYear = parseInt(periodYear);
  const pMonth = parseInt(periodMonth);

  const { data: masterAccounts } = await adminClient
    .from("master_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("classification")
    .order("display_order")
    .order("account_number");

  const masterAccountIds = (masterAccounts ?? []).map((ma) => ma.id);

  const { data: mappings } = await adminClient
    .from("master_account_mappings")
    .select("id, master_account_id, entity_id, account_id")
    .in("master_account_id", masterAccountIds.length > 0 ? masterAccountIds : ["_"]);

  const accountIds = (mappings ?? []).map((m) => m.account_id);

  const { data: entities } = await adminClient
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  const entityMap = new Map((entities ?? []).map((e) => [e.id, e]));

  let glBalances: Array<{
    account_id: string;
    entity_id: string;
    ending_balance: number;
    beginning_balance: number;
    debit_total: number;
    credit_total: number;
    net_change: number;
  }> = [];

  if (accountIds.length > 0) {
    const { data } = await adminClient
      .from("gl_balances")
      .select("account_id, entity_id, ending_balance, beginning_balance, debit_total, credit_total, net_change")
      .in("account_id", accountIds)
      .eq("period_year", pYear)
      .eq("period_month", pMonth);
    glBalances = data ?? [];
  }

  const { data: eliminations } = await adminClient
    .from("consolidation_eliminations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("period_year", pYear)
    .eq("period_month", pMonth)
    .eq("status", "posted");

  // Build balance map
  const balanceMap = new Map<string, (typeof glBalances)[0]>();
  for (const b of glBalances) {
    balanceMap.set(`${b.account_id}:${b.entity_id}`, b);
  }

  // Build elimination adjustments
  const elimAdjustments = new Map<string, number>();
  for (const e of eliminations ?? []) {
    elimAdjustments.set(
      e.debit_master_account_id,
      (elimAdjustments.get(e.debit_master_account_id) ?? 0) + Number(e.amount)
    );
    elimAdjustments.set(
      e.credit_master_account_id,
      (elimAdjustments.get(e.credit_master_account_id) ?? 0) - Number(e.amount)
    );
  }

  // Group mappings by master account
  const mappingsByMaster = new Map<string, Array<{ entity_id: string; account_id: string }>>();
  for (const m of mappings ?? []) {
    const arr = mappingsByMaster.get(m.master_account_id) ?? [];
    arr.push({ entity_id: m.entity_id, account_id: m.account_id });
    mappingsByMaster.set(m.master_account_id, arr);
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Build consolidated trial balance sheet
  const tbRows: Record<string, string | number>[] = [];
  let currentClassification = "";

  for (const ma of masterAccounts ?? []) {
    if (ma.classification !== currentClassification) {
      currentClassification = ma.classification;
      tbRows.push({
        "Account Number": "",
        "Account Name": currentClassification.toUpperCase(),
        "Beginning Balance": "",
        Debits: "",
        Credits: "",
        "Ending Balance": "",
        Eliminations: "",
        "Adjusted Balance": "",
      });
    }

    const acctMappings = mappingsByMaster.get(ma.id) ?? [];
    let totalEnding = 0;
    let totalBeginning = 0;
    let totalDebits = 0;
    let totalCredits = 0;

    for (const mapping of acctMappings) {
      const bal = balanceMap.get(`${mapping.account_id}:${mapping.entity_id}`);
      totalEnding += bal?.ending_balance ?? 0;
      totalBeginning += bal?.beginning_balance ?? 0;
      totalDebits += bal?.debit_total ?? 0;
      totalCredits += bal?.credit_total ?? 0;
    }

    const elimAdj = elimAdjustments.get(ma.id) ?? 0;

    tbRows.push({
      "Account Number": ma.account_number,
      "Account Name": ma.name,
      "Beginning Balance": totalBeginning,
      Debits: totalDebits,
      Credits: totalCredits,
      "Ending Balance": totalEnding,
      Eliminations: elimAdj,
      "Adjusted Balance": totalEnding + elimAdj,
    });
  }

  // Build entity breakdown sheet
  const detailRows: Record<string, string | number>[] = [];
  for (const ma of masterAccounts ?? []) {
    const acctMappings = mappingsByMaster.get(ma.id) ?? [];
    for (const mapping of acctMappings) {
      const entity = entityMap.get(mapping.entity_id);
      const bal = balanceMap.get(`${mapping.account_id}:${mapping.entity_id}`);

      detailRows.push({
        "Master Account": `${ma.account_number} - ${ma.name}`,
        Classification: ma.classification,
        Entity: entity?.name ?? "Unknown",
        "Entity Code": entity?.code ?? "???",
        "Beginning Balance": bal?.beginning_balance ?? 0,
        Debits: bal?.debit_total ?? 0,
        Credits: bal?.credit_total ?? 0,
        "Ending Balance": bal?.ending_balance ?? 0,
      });
    }
  }

  // Build eliminations sheet
  const elimRows: Record<string, string | number>[] = [];
  const masterAccountMap = new Map((masterAccounts ?? []).map((ma) => [ma.id, ma]));
  for (const elim of eliminations ?? []) {
    const debitAcct = masterAccountMap.get(elim.debit_master_account_id);
    const creditAcct = masterAccountMap.get(elim.credit_master_account_id);
    elimRows.push({
      Description: elim.description,
      Type: elim.elimination_type,
      "Debit Account": debitAcct
        ? `${debitAcct.account_number} - ${debitAcct.name}`
        : elim.debit_master_account_id,
      "Credit Account": creditAcct
        ? `${creditAcct.account_number} - ${creditAcct.name}`
        : elim.credit_master_account_id,
      Amount: Number(elim.amount),
      Status: elim.status,
      Memo: elim.memo ?? "",
    });
  }

  // Create workbook
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(tbRows);
  XLSX.utils.book_append_sheet(wb, ws1, "Consolidated TB");

  if (detailRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Entity Breakdown");
  }

  if (elimRows.length > 0) {
    const ws3 = XLSX.utils.json_to_sheet(elimRows);
    XLSX.utils.book_append_sheet(wb, ws3, "Eliminations");
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const orgName =
    (membership as Record<string, unknown>).organizations &&
    typeof (membership as Record<string, unknown>).organizations === "object"
      ? ((membership as Record<string, unknown>).organizations as { name: string }).name
      : "Consolidated";
  const filename = `${orgName.replace(/[^a-zA-Z0-9]/g, "_")}_Consolidated_TB_${months[pMonth - 1]}_${pYear}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
