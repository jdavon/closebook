import { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "transition"
  | "import"
  | "sync";

export type AuditResourceType =
  | "organization"
  | "entity"
  | "organization_member"
  | "close_period"
  | "close_task"
  | "workpaper"
  | "debt_instrument"
  | "debt_transaction"
  | "fixed_asset"
  | "lease"
  | "sublease"
  | "insurance_policy"
  | "insurance_claim"
  | "budget"
  | "schedule"
  | "master_account"
  | "account_mapping"
  | "reporting_entity"
  | "commission_rule"
  | "intercompany_elimination"
  | "paylocity_connection"
  | "qbo_connection"
  | "reconciliation_template";

export interface AuditLogParams {
  organizationId: string;
  entityId?: string | null;
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  request?: Request;
}

/**
 * Fire-and-forget audit log writer. Call after a successful mutation.
 * Never throws — errors are logged to console.
 */
export function logAuditEvent(params: AuditLogParams): void {
  _writeAuditLog(params).catch((err) => {
    console.error("[audit] Failed to write audit log:", err);
  });
}

async function _writeAuditLog(params: AuditLogParams): Promise<void> {
  const admin = createAdminClient();

  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  if (params.request) {
    ipAddress =
      params.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      params.request.headers.get("x-real-ip") ??
      null;
    userAgent = params.request.headers.get("user-agent") ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("audit_log").insert({
    organization_id: params.organizationId,
    entity_id: params.entityId ?? null,
    user_id: params.userId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId ?? null,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    ip_address: ipAddress,
    user_agent: userAgent,
  });
}
