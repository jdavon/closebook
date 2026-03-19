"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  MinusCircle,
  ArrowRight,
  Lock,
  ChevronDown,
  ChevronRight,
  Zap,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldMinus,
  RefreshCw,
  ShieldQuestion,
} from "lucide-react";
import { getPeriodLabel, formatCurrency } from "@/lib/utils/dates";
import {
  CLOSE_PHASES,
  PHASE_ORDER,
  computePhaseBlocking,
  GATE_CHECKS,
  getGateCheckStatusColor,
  getGateCheckStatusLabel,
  getSourceModuleUrl,
} from "@/lib/utils/close-management";
import type {
  TaskStatus,
  CloseStatus,
  ClosePhase,
  GateCheckStatus,
} from "@/lib/types/database";

interface CloseTask {
  id: string;
  close_period_id: string;
  account_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  status: TaskStatus;
  preparer_id: string | null;
  reviewer_id: string | null;
  due_date: string | null;
  gl_balance: number | null;
  reconciled_balance: number | null;
  variance: number | null;
  display_order: number;
  phase: number;
  source_module: string | null;
  source_record_id: string | null;
  is_auto_generated: boolean;
  accounts?: { name: string; account_number: string | null } | null;
}

interface ClosePeriod {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  status: CloseStatus;
  due_date: string | null;
}

interface GateCheck {
  id: string;
  check_type: string;
  status: GateCheckStatus;
  is_critical: boolean;
  result_data: Record<string, unknown>;
  checked_at: string | null;
}

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; icon: React.ElementType; color: string }
> = {
  not_started: {
    label: "Not Started",
    icon: MinusCircle,
    color: "text-muted-foreground",
  },
  in_progress: {
    label: "In Progress",
    icon: Clock,
    color: "text-yellow-500",
  },
  pending_review: {
    label: "Pending Review",
    icon: AlertCircle,
    color: "text-blue-500",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    color: "text-green-500",
  },
  rejected: { label: "Rejected", icon: XCircle, color: "text-red-500" },
  na: { label: "N/A", icon: MinusCircle, color: "text-muted-foreground" },
};

function GateCheckStatusIcon({ status }: { status: GateCheckStatus }) {
  switch (status) {
    case "passed":
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    case "failed":
      return <ShieldAlert className="h-4 w-4 text-red-500" />;
    case "warning":
      return <Shield className="h-4 w-4 text-yellow-500" />;
    case "skipped":
      return <ShieldMinus className="h-4 w-4 text-muted-foreground" />;
    default:
      return <ShieldQuestion className="h-4 w-4 text-muted-foreground" />;
  }
}

function GateCheckResultDetail({
  check,
}: {
  check: GateCheck;
}) {
  const data = check.result_data;
  if (!data || check.status === "pending" || check.status === "skipped") {
    if (check.status === "skipped" && data?.reason) {
      return (
        <span className="text-xs text-muted-foreground">
          {String(data.reason)}
        </span>
      );
    }
    return null;
  }

  switch (check.check_type) {
    case "balance_sheet_balance":
      return (
        <span className="text-xs text-muted-foreground">
          A: {formatCurrency(Number(data.totalAssets ?? 0))} | L+E:{" "}
          {formatCurrency(
            Number(data.totalLiabilities ?? 0) + Number(data.totalEquity ?? 0)
          )}{" "}
          | Diff: {formatCurrency(Number(data.difference ?? 0))}
        </span>
      );
    case "trial_balance_footing":
      return (
        <span className="text-xs text-muted-foreground">
          Dr: {formatCurrency(Number(data.totalDebits ?? 0))} | Cr:{" "}
          {formatCurrency(Number(data.totalCredits ?? 0))} | Var:{" "}
          {formatCurrency(Number(data.variance ?? 0))}
        </span>
      );
    case "intercompany_net_zero":
      return (
        <span className="text-xs text-muted-foreground">
          Net: {formatCurrency(Number(data.netBalance ?? 0))} | {String(data.icAccountCount ?? 0)}{" "}
          IC accounts
        </span>
      );
    case "debt_reconciliation":
    case "asset_reconciliation": {
      const total = Number(data.totalGroups ?? 0);
      const recon = Number(data.reconciledGroups ?? 0);
      return (
        <span className="text-xs text-muted-foreground">
          {recon}/{total} groups reconciled
        </span>
      );
    }
    default:
      return null;
  }
}

export default function ClosePeriodDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const periodId = params.periodId as string;
  const supabase = createClient();

  const [period, setPeriod] = useState<ClosePeriod | null>(null);
  const [tasks, setTasks] = useState<CloseTask[]>([]);
  const [gateChecks, setGateChecks] = useState<GateCheck[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [runningChecks, setRunningChecks] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState<
    Record<ClosePhase, boolean>
  >({ 1: false, 2: false, 3: false, 4: false });

  const loadData = useCallback(async () => {
    const periodResult = await supabase
      .from("close_periods")
      .select("*")
      .eq("id", periodId)
      .single();

    const tasksResult = await supabase
      .from("close_tasks")
      .select("*, accounts(name, account_number)")
      .eq("close_period_id", periodId)
      .order("phase")
      .order("display_order")
      .order("name");

    const checksResult = await supabase
      .from("close_gate_checks")
      .select("*")
      .eq("close_period_id", periodId)
      .order("created_at");

    setPeriod(periodResult.data as ClosePeriod | null);
    setTasks((tasksResult.data as unknown as CloseTask[]) ?? []);
    setGateChecks((checksResult.data as unknown as GateCheck[]) ?? []);
    setLoading(false);
  }, [supabase, periodId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute phase blocking client-side
  const phaseBlocking = useMemo(
    () => computePhaseBlocking(tasks),
    [tasks]
  );

  async function handleStatusChange(taskId: string, newStatus: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Don't allow status changes on blocked tasks
    if (phaseBlocking[task.phase as ClosePhase]) {
      toast.error("Complete tasks in earlier phases first");
      return;
    }

    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === "approved") {
      updateData.reviewed_at = new Date().toISOString();
    }
    if (newStatus === "pending_review") {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("close_tasks")
      .update(updateData)
      .eq("id", taskId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );
    toast.success("Task status updated");
  }

  async function handleRunGateChecks() {
    setRunningChecks(true);
    try {
      const res = await fetch("/api/close/gate-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closePeriodId: periodId }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to run checks");
      } else {
        setGateChecks(data.checks ?? []);
        const failed = (data.checks ?? []).filter(
          (c: GateCheck) => c.status === "failed" && c.is_critical
        );
        if (failed.length > 0) {
          toast.error(`${failed.length} critical check(s) failed`);
        } else {
          toast.success("Gate checks completed");
        }
      }
    } catch {
      toast.error("Failed to run gate checks");
    }
    setRunningChecks(false);
  }

  async function handleTransition(targetStatus: CloseStatus) {
    setTransitioning(true);
    try {
      const res = await fetch("/api/close/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, targetStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Transition failed");
      } else {
        setPeriod((prev) =>
          prev ? { ...prev, status: targetStatus } : null
        );
        toast.success(
          `Period moved to ${targetStatus.replace("_", " ")}`
        );
      }
    } catch {
      toast.error("Transition failed");
    }
    setTransitioning(false);
  }

  function togglePhase(phase: ClosePhase) {
    setCollapsedPhases((prev) => ({ ...prev, [phase]: !prev[phase] }));
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (!period) {
    return <p className="text-muted-foreground">Period not found</p>;
  }

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status === "approved" || t.status === "na"
  ).length;
  const progressPct =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const isPeriodLocked =
    period.status === "closed" || period.status === "locked" || period.status === "soft_closed";

  // Group tasks by phase
  const tasksByPhase = tasks.reduce(
    (acc, task) => {
      const p = (task.phase || 3) as ClosePhase;
      if (!acc[p]) acc[p] = [];
      acc[p].push(task);
      return acc;
    },
    {} as Record<ClosePhase, CloseTask[]>
  );

  // Apply status filter
  const filterTasks = (phaseTasks: CloseTask[]) =>
    filter === "all"
      ? phaseTasks
      : phaseTasks.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {getPeriodLabel(period.period_year, period.period_month)}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge
              variant={isPeriodLocked ? "default" : "outline"}
            >
              {isPeriodLocked ? (
                <Lock className="mr-1 h-3 w-3" />
              ) : null}
              {period.status.charAt(0).toUpperCase() +
                period.status.slice(1).replace("_", " ")}
            </Badge>
            <div className="flex items-center gap-2">
              <Progress value={progressPct} className="h-2 w-32" />
              <span className="text-sm text-muted-foreground">
                {completedTasks}/{totalTasks} ({progressPct}%)
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {period.status === "open" && (
            <Button
              onClick={() => handleTransition("in_progress")}
              disabled={transitioning}
            >
              <Clock className="mr-2 h-4 w-4" />
              Start Close
            </Button>
          )}
          {period.status === "in_progress" && (
            <Button
              onClick={() => handleTransition("review")}
              disabled={transitioning}
            >
              <AlertCircle className="mr-2 h-4 w-4" />
              Move to Review
            </Button>
          )}
          {period.status === "review" && (
            <>
              <Button
                variant="outline"
                onClick={() => handleTransition("in_progress")}
                disabled={transitioning}
              >
                Revert to In Progress
              </Button>
              <Button
                onClick={() => handleTransition("soft_closed")}
                disabled={transitioning}
              >
                <Shield className="mr-2 h-4 w-4" />
                Soft Close
              </Button>
            </>
          )}
          {period.status === "soft_closed" && (
            <>
              <Button
                variant="outline"
                onClick={() => handleTransition("review")}
                disabled={transitioning}
              >
                Revert to Review
              </Button>
              <Button
                onClick={() => handleTransition("closed")}
                disabled={transitioning}
              >
                <Lock className="mr-2 h-4 w-4" />
                Hard Close
              </Button>
            </>
          )}
          {period.status === "closed" && (
            <>
              <Button
                variant="outline"
                onClick={() => handleTransition("soft_closed")}
                disabled={transitioning}
              >
                Revert to Soft Close
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleTransition("locked")}
                disabled={transitioning}
              >
                <Lock className="mr-2 h-4 w-4" />
                Lock Period
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Gate Checks Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Close Readiness Checks
              </CardTitle>
              <CardDescription>
                Automated validations that must pass before closing the period
              </CardDescription>
            </div>
            {!isPeriodLocked && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunGateChecks}
                disabled={runningChecks}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${runningChecks ? "animate-spin" : ""}`}
                />
                {runningChecks ? "Running..." : "Run Checks"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {gateChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No gate checks configured for this period.
            </p>
          ) : (
            <div className="space-y-3">
              {gateChecks.map((check) => {
                const cfg = GATE_CHECKS.find(
                  (gc) => gc.checkType === check.check_type
                );
                return (
                  <div
                    key={check.id}
                    className="flex items-start gap-3 p-3 rounded-lg border"
                  >
                    <GateCheckStatusIcon
                      status={check.status as GateCheckStatus}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {cfg?.label ?? check.check_type}
                        </span>
                        {check.is_critical && (
                          <Badge variant="destructive" className="text-xs px-1.5 py-0">
                            Critical
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-xs px-1.5 py-0 ${getGateCheckStatusColor(check.status as GateCheckStatus)}`}
                        >
                          {getGateCheckStatusLabel(
                            check.status as GateCheckStatus
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cfg?.description}
                      </p>
                      <GateCheckResultDetail check={check} />
                      {check.checked_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last run:{" "}
                          {new Date(check.checked_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Task Checklist by Phase */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Task Checklist</CardTitle>
            <div className="flex gap-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="na">N/A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {tasks.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No tasks yet. Add task templates in Settings to auto-generate
              tasks.
            </p>
          ) : (
            PHASE_ORDER.map((phase) => {
              const phaseTasks = tasksByPhase[phase] ?? [];
              if (phaseTasks.length === 0 && filter !== "all") return null;
              if (phaseTasks.length === 0) return null;

              const filteredPhaseTasks = filterTasks(phaseTasks);
              const phaseCompleted = phaseTasks.filter(
                (t) => t.status === "approved" || t.status === "na"
              ).length;
              const phasePct =
                phaseTasks.length > 0
                  ? Math.round(
                      (phaseCompleted / phaseTasks.length) * 100
                    )
                  : 100;
              const isBlocked = phaseBlocking[phase];
              const isCollapsed = collapsedPhases[phase];

              return (
                <Collapsible
                  key={phase}
                  open={!isCollapsed}
                  onOpenChange={() => togglePhase(phase)}
                >
                  <CollapsibleTrigger asChild>
                    <div
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors ${
                        isBlocked ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              Phase {phase}: {CLOSE_PHASES[phase].name}
                            </span>
                            {isBlocked && (
                              <Badge variant="outline" className="text-xs">
                                <Lock className="mr-1 h-3 w-3" />
                                Blocked
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {CLOSE_PHASES[phase].description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={phasePct}
                            className="h-2 w-20"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {phaseCompleted}/{phaseTasks.length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {filteredPhaseTasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No tasks match the current filter in this phase.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">
                              GL Balance
                            </TableHead>
                            <TableHead className="text-right">
                              Variance
                            </TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPhaseTasks.map((task) => {
                            const statusConfig = STATUS_CONFIG[task.status];
                            const StatusIcon = statusConfig.icon;
                            const taskBlocked = isBlocked;
                            const moduleUrl = task.source_module
                              ? getSourceModuleUrl(
                                  entityId,
                                  task.source_module as any
                                )
                              : null;

                            return (
                              <TableRow
                                key={task.id}
                                className={taskBlocked ? "opacity-50" : ""}
                              >
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">
                                      {task.name}
                                    </span>
                                    {task.is_auto_generated && (
                                      <span title="Auto-generated"><Zap className="h-3 w-3 text-yellow-500 flex-shrink-0" /></span>
                                    )}
                                    {moduleUrl && (
                                      <Link
                                        href={moduleUrl}
                                        className="flex-shrink-0"
                                        title="Go to module"
                                      >
                                        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                      </Link>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {task.accounts
                                    ? `${task.accounts.account_number ?? ""} ${task.accounts.name}`.trim()
                                    : "---"}
                                </TableCell>
                                <TableCell>
                                  {task.category && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {task.category}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {isPeriodLocked || taskBlocked ? (
                                    <div className="flex items-center gap-1">
                                      {taskBlocked && !isPeriodLocked ? (
                                        <Lock className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <StatusIcon
                                          className={`h-4 w-4 ${statusConfig.color}`}
                                        />
                                      )}
                                      <span className="text-sm">
                                        {taskBlocked && !isPeriodLocked
                                          ? "Blocked"
                                          : statusConfig.label}
                                      </span>
                                    </div>
                                  ) : (
                                    <Select
                                      value={task.status}
                                      onValueChange={(v) =>
                                        handleStatusChange(
                                          task.id,
                                          v as TaskStatus
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-8 w-36">
                                        <div className="flex items-center gap-1">
                                          <StatusIcon
                                            className={`h-3 w-3 ${statusConfig.color}`}
                                          />
                                          <span className="text-xs">
                                            {statusConfig.label}
                                          </span>
                                        </div>
                                      </SelectTrigger>
                                      <SelectContent>
                                        {Object.entries(STATUS_CONFIG).map(
                                          ([key, config]) => {
                                            const Icon = config.icon;
                                            return (
                                              <SelectItem
                                                key={key}
                                                value={key}
                                              >
                                                <div className="flex items-center gap-1">
                                                  <Icon
                                                    className={`h-3 w-3 ${config.color}`}
                                                  />
                                                  {config.label}
                                                </div>
                                              </SelectItem>
                                            );
                                          }
                                        )}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {task.gl_balance !== null
                                    ? formatCurrency(task.gl_balance)
                                    : "---"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {task.variance !== null ? (
                                    <span
                                      className={
                                        task.variance === 0
                                          ? "text-green-600"
                                          : "text-red-600"
                                      }
                                    >
                                      {formatCurrency(task.variance)}
                                    </span>
                                  ) : (
                                    "---"
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Link
                                    href={`/${entityId}/close/${periodId}/tasks/${task.id}`}
                                  >
                                    <Button variant="ghost" size="sm">
                                      <ArrowRight className="h-4 w-4" />
                                    </Button>
                                  </Link>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
