import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Suggestion {
  entityId: string;
  entityName: string;
  entityCode: string;
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  accountClassification: string;
  accountBalance: number;
  masterAccountId: string;
  masterAccountNumber: string;
  masterAccountName: string;
  masterClassification: string;
  confidence: "high" | "medium" | "low";
  matchReason: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await request.json();

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Get master accounts
  const { data: masterAccounts } = await adminClient
    .from("master_accounts")
    .select("id, account_number, name, classification, account_type, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (!masterAccounts || masterAccounts.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  // Get entities
  const { data: entities } = await adminClient
    .from("entities")
    .select("id, name, code")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (!entities || entities.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  // Get existing mappings
  const { data: existingMappings } = await adminClient
    .from("master_account_mappings")
    .select("account_id")
    .in(
      "master_account_id",
      masterAccounts.map((ma) => ma.id)
    );

  const mappedAccountIds = new Set(
    (existingMappings ?? []).map((m) => m.account_id)
  );

  // Get all unmapped entity accounts
  const { data: allAccounts } = await adminClient
    .from("accounts")
    .select(
      "id, entity_id, name, account_number, classification, account_type, current_balance"
    )
    .in(
      "entity_id",
      entities.map((e) => e.id)
    )
    .eq("is_active", true);

  const unmappedAccounts = (allAccounts ?? []).filter(
    (a) => !mappedAccountIds.has(a.id)
  );

  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // Build suggestions
  const suggestions: Suggestion[] = [];

  for (const account of unmappedAccounts) {
    const entity = entityMap.get(account.entity_id);
    if (!entity) continue;

    let bestMatch: {
      master: (typeof masterAccounts)[0];
      confidence: "high" | "medium" | "low";
      reason: string;
    } | null = null;

    for (const master of masterAccounts) {
      // 1. Exact account number match + same classification (highest confidence)
      if (
        account.account_number &&
        master.account_number &&
        account.account_number === master.account_number &&
        account.classification === master.classification
      ) {
        bestMatch = {
          master,
          confidence: "high",
          reason: `Exact account number match (${account.account_number}) and same classification`,
        };
        break;
      }

      // 2. Exact account number match, different classification
      if (
        account.account_number &&
        master.account_number &&
        account.account_number === master.account_number
      ) {
        if (
          !bestMatch ||
          bestMatch.confidence === "low" ||
          (bestMatch.confidence === "medium" &&
            account.classification !== bestMatch.master.classification)
        ) {
          bestMatch = {
            master,
            confidence: "medium",
            reason: `Account number match (${account.account_number})`,
          };
        }
        continue;
      }

      // 3. Normalized name exact match + same classification
      if (
        normalize(account.name) === normalize(master.name) &&
        account.classification === master.classification
      ) {
        if (!bestMatch || bestMatch.confidence !== "high") {
          bestMatch = {
            master,
            confidence: "high",
            reason: `Exact name match and same classification`,
          };
        }
        continue;
      }

      // 4. Name contains match + same classification
      const normAcct = normalize(account.name);
      const normMaster = normalize(master.name);
      if (
        account.classification === master.classification &&
        (normAcct.includes(normMaster) || normMaster.includes(normAcct)) &&
        normAcct.length > 2 &&
        normMaster.length > 2
      ) {
        if (!bestMatch || bestMatch.confidence === "low") {
          bestMatch = {
            master,
            confidence: "medium",
            reason: `Name similarity and same classification`,
          };
        }
        continue;
      }

      // 5. Same classification + same account type
      if (
        account.classification === master.classification &&
        account.account_type === master.account_type
      ) {
        if (!bestMatch) {
          bestMatch = {
            master,
            confidence: "low",
            reason: `Same classification (${account.classification}) and type (${account.account_type})`,
          };
        }
      }
    }

    if (bestMatch) {
      suggestions.push({
        entityId: entity.id,
        entityName: entity.name,
        entityCode: entity.code,
        accountId: account.id,
        accountNumber: account.account_number,
        accountName: account.name,
        accountClassification: account.classification,
        accountBalance: account.current_balance,
        masterAccountId: bestMatch.master.id,
        masterAccountNumber: bestMatch.master.account_number,
        masterAccountName: bestMatch.master.name,
        masterClassification: bestMatch.master.classification,
        confidence: bestMatch.confidence,
        matchReason: bestMatch.reason,
      });
    }
  }

  // Sort: high confidence first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return NextResponse.json({ suggestions });
}
