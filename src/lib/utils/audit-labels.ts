export const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  transition: "Status Changed",
  import: "Imported",
  sync: "Synced",
};

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  organization: "Organization",
  entity: "Entity",
  organization_member: "Team Member",
  close_period: "Close Period",
  close_task: "Close Task",
  workpaper: "Workpaper",
  debt_instrument: "Debt Instrument",
  debt_transaction: "Debt Transaction",
  fixed_asset: "Fixed Asset",
  lease: "Lease",
  sublease: "Sublease",
  insurance_policy: "Insurance Policy",
  insurance_claim: "Insurance Claim",
  budget: "Budget",
  schedule: "Schedule",
  master_account: "Master GL Account",
  account_mapping: "Account Mapping",
  reporting_entity: "Reporting Entity",
  commission_rule: "Commission Rule",
  intercompany_elimination: "IC Elimination",
  paylocity_connection: "Paylocity Connection",
  qbo_connection: "QuickBooks Connection",
  reconciliation_template: "Recon Template",
};

export function describeAuditEvent(
  action: string,
  resourceType: string,
  newValues?: Record<string, unknown> | null,
  oldValues?: Record<string, unknown> | null
): string {
  const actionLabel = ACTION_LABELS[action] ?? action;
  const resourceLabel = RESOURCE_TYPE_LABELS[resourceType] ?? resourceType;

  const name = (
    newValues?.instrument_name ??
    newValues?.name ??
    newValues?.lease_name ??
    newValues?.policy_name ??
    oldValues?.instrument_name ??
    oldValues?.name ??
    oldValues?.lease_name ??
    oldValues?.policy_name
  ) as string | undefined;

  if (action === "transition" && oldValues?.status && newValues?.status) {
    return `${resourceLabel} status changed from "${oldValues.status}" to "${newValues.status}"${name ? ` (${name})` : ""}`;
  }

  return `${actionLabel} ${resourceLabel}${name ? `: ${name}` : ""}`;
}
