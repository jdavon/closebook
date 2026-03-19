import type {
  ClosePhase,
  CloseSourceModule,
  GateCheckType,
  GateCheckStatus,
} from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

export const CLOSE_PHASES: Record<
  ClosePhase,
  { name: string; description: string }
> = {
  1: { name: "Pre-Close", description: "Data sync, cutoffs, and period setup" },
  2: { name: "Adjustments", description: "Depreciation, accruals, and journal entries" },
  3: { name: "Reconciliations", description: "Subledger-to-GL reconciliations" },
  4: { name: "Review & Reporting", description: "TB review, flux analysis, financial statements, sign-off" },
};

export const PHASE_ORDER: ClosePhase[] = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
// Gate check definitions
// ---------------------------------------------------------------------------

export interface GateCheckConfig {
  checkType: GateCheckType;
  label: string;
  description: string;
  isCritical: boolean;
}

export const GATE_CHECKS: GateCheckConfig[] = [
  {
    checkType: "balance_sheet_balance",
    label: "Balance Sheet Balance",
    description: "Assets = Liabilities + Equity",
    isCritical: true,
  },
  {
    checkType: "trial_balance_footing",
    label: "Trial Balance Footing",
    description: "Total Debits = Total Credits",
    isCritical: true,
  },
  {
    checkType: "intercompany_net_zero",
    label: "Intercompany Net-Zero",
    description: "IC eliminations net to zero across entities",
    isCritical: true,
  },
  {
    checkType: "debt_reconciliation",
    label: "Debt Reconciliation",
    description: "All debt GL groups reconciled to subledger",
    isCritical: false,
  },
  {
    checkType: "asset_reconciliation",
    label: "Asset Reconciliation",
    description: "All asset GL groups reconciled to register",
    isCritical: false,
  },
];

// ---------------------------------------------------------------------------
// Auto-discovery module definitions
// ---------------------------------------------------------------------------

export interface AutoDiscoveryModule {
  sourceModule: CloseSourceModule;
  phase: ClosePhase;
  category: string;
  description: string;
}

export const AUTO_DISCOVERY_MODULES: AutoDiscoveryModule[] = [
  {
    sourceModule: "debt",
    phase: 3,
    category: "Reconciliation",
    description: "Reconcile debt GL accounts to amortization schedule",
  },
  {
    sourceModule: "assets",
    phase: 3,
    category: "Reconciliation",
    description: "Reconcile fixed asset GL groups to asset register",
  },
  {
    sourceModule: "leases",
    phase: 3,
    category: "Reconciliation",
    description: "Reconcile ROU asset and lease liability to schedules",
  },
  {
    sourceModule: "payroll",
    phase: 2,
    category: "Accruals",
    description: "Record and verify payroll accrual entries",
  },
  {
    sourceModule: "intercompany",
    phase: 4,
    category: "Review",
    description: "Verify intercompany eliminations net to zero",
  },
  {
    sourceModule: "tb",
    phase: 4,
    category: "Review",
    description: "Review trial balance for anomalies and unmatched accounts",
  },
  {
    sourceModule: "financial_statements",
    phase: 4,
    category: "Reporting",
    description: "Review financial statements and sign off",
  },
];

// ---------------------------------------------------------------------------
// Phase blocking logic
// ---------------------------------------------------------------------------

export interface TaskForBlocking {
  phase: number;
  status: string;
}

/**
 * Returns which phases are blocked based on task completion.
 * A phase is blocked if any task in a prior phase is not yet approved/na.
 */
export function computePhaseBlocking(
  tasks: TaskForBlocking[]
): Record<ClosePhase, boolean> {
  const phaseComplete: Record<ClosePhase, boolean> = { 1: true, 2: true, 3: true, 4: true };

  for (const task of tasks) {
    const p = task.phase as ClosePhase;
    if (p >= 1 && p <= 4 && task.status !== "approved" && task.status !== "na") {
      phaseComplete[p] = false;
    }
  }

  return {
    1: false, // Phase 1 is never blocked
    2: !phaseComplete[1],
    3: !phaseComplete[1] || !phaseComplete[2],
    4: !phaseComplete[1] || !phaseComplete[2] || !phaseComplete[3],
  };
}

// ---------------------------------------------------------------------------
// Phase progress computation
// ---------------------------------------------------------------------------

export interface PhaseProgress {
  phase: ClosePhase;
  name: string;
  total: number;
  completed: number;
  percentage: number;
  isBlocked: boolean;
}

export function computePhaseProgress(
  tasks: Array<{ phase: number; status: string }>
): PhaseProgress[] {
  const blocking = computePhaseBlocking(tasks);

  return PHASE_ORDER.map((phase) => {
    const phaseTasks = tasks.filter((t) => t.phase === phase);
    const completed = phaseTasks.filter(
      (t) => t.status === "approved" || t.status === "na"
    ).length;
    const total = phaseTasks.length;

    return {
      phase,
      name: CLOSE_PHASES[phase].name,
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 100,
      isBlocked: blocking[phase],
    };
  });
}

// ---------------------------------------------------------------------------
// Gate check status helpers
// ---------------------------------------------------------------------------

export function getGateCheckStatusColor(status: GateCheckStatus): string {
  switch (status) {
    case "passed":
      return "text-green-600";
    case "failed":
      return "text-red-600";
    case "warning":
      return "text-yellow-600";
    case "skipped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function getGateCheckStatusLabel(status: GateCheckStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "warning":
      return "Warning";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}

// ---------------------------------------------------------------------------
// Source module navigation helpers
// ---------------------------------------------------------------------------

export function getSourceModuleUrl(
  entityId: string,
  sourceModule: CloseSourceModule
): string | null {
  switch (sourceModule) {
    case "debt":
      return `/${entityId}/debt`;
    case "assets":
      return `/${entityId}/assets`;
    case "leases":
      return `/${entityId}/real-estate`;
    case "payroll":
      return `/${entityId}/payroll`;
    case "intercompany":
      return `/${entityId}/reports/flux-analysis`;
    case "tb":
      return `/${entityId}/trial-balance`;
    case "financial_statements":
      return `/${entityId}/reports`;
    case "schedules":
      return `/${entityId}/schedules`;
    default:
      return null;
  }
}

export function getSourceModuleLabel(sourceModule: CloseSourceModule): string {
  switch (sourceModule) {
    case "debt":
      return "Debt Schedule";
    case "assets":
      return "Fixed Assets";
    case "leases":
      return "Lease Schedule";
    case "payroll":
      return "Payroll";
    case "intercompany":
      return "Intercompany";
    case "tb":
      return "Trial Balance";
    case "financial_statements":
      return "Financial Statements";
    case "schedules":
      return "Schedules";
    default:
      return sourceModule;
  }
}
