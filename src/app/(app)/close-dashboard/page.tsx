"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ChevronDown,
  Lock,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GateCheck {
  checkType: string;
  status: string;
  isCritical: boolean;
}

interface PeriodData {
  id: string;
  year: number;
  month: number;
  status: string;
  openedAt: string;
  closedAt: string | null;
  tasks: {
    total: number;
    completed: number;
    byPhase: Record<number, { total: number; completed: number }>;
  };
  gateChecks: {
    total: number;
    passed: number;
    failed: number;
    criticalFailed: number;
    checks: GateCheck[];
  };
  completionPct: number;
}

interface EntitySummary {
  id: string;
  name: string;
  code: string;
  period: PeriodData | null;
}

interface AvailablePeriod {
  year: number;
  month: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PHASE_NAMES: Record<number, string> = {
  1: "Pre-Close",
  2: "Adjustments",
  3: "Reconciliations",
  4: "Review & Reporting",
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "closed":
    case "locked":
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Closed
        </Badge>
      );
    case "in_progress":
    case "review":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          In Progress
        </Badge>
      );
    case "open":
      return (
        <Badge variant="outline" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Open
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function GateCheckSummary({ gateChecks }: { gateChecks: PeriodData["gateChecks"] }) {
  if (gateChecks.total === 0) {
    return <span className="text-xs text-muted-foreground">No checks</span>;
  }

  const allPassed = gateChecks.passed === gateChecks.total;
  const hasCriticalFail = gateChecks.criticalFailed > 0;

  if (allPassed) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <ShieldCheck className="h-3.5 w-3.5" />
        All passed
      </span>
    );
  }

  if (hasCriticalFail) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-600">
        <ShieldAlert className="h-3.5 w-3.5" />
        {gateChecks.criticalFailed} critical
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-yellow-600">
      <ShieldQuestion className="h-3.5 w-3.5" />
      {gateChecks.passed}/{gateChecks.total} passed
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CloseDashboardPage() {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [availablePeriods, setAvailablePeriods] = useState<AvailablePeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (periodKey?: string) => {
    setLoading(true);
    try {
      let url = "/api/close/dashboard";
      if (periodKey && periodKey !== "latest") {
        const [year, month] = periodKey.split("-");
        url += `?periodYear=${year}&periodMonth=${month}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setEntities(data.entities ?? []);
      if (data.availablePeriods && data.availablePeriods.length > 0) {
        setAvailablePeriods(data.availablePeriods);
        if (!periodKey) {
          const latest = data.availablePeriods[0];
          setSelectedPeriod(`${latest.year}-${latest.month}`);
        }
      }
    } catch {
      console.error("Failed to load close dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePeriodChange = (value: string) => {
    setSelectedPeriod(value);
    fetchData(value);
  };

  // Compute org-level summary
  const entitiesWithPeriod = entities.filter((e) => e.period);
  const totalTasks = entitiesWithPeriod.reduce(
    (s, e) => s + (e.period?.tasks.total ?? 0),
    0
  );
  const completedTasks = entitiesWithPeriod.reduce(
    (s, e) => s + (e.period?.tasks.completed ?? 0),
    0
  );
  const closedEntities = entitiesWithPeriod.filter(
    (e) => e.period?.status === "closed" || e.period?.status === "locked"
  );
  const orgCompletionPct =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Close Dashboard
          </h1>
          <p className="text-muted-foreground">
            Cross-entity month-end close status
          </p>
        </div>
        {availablePeriods.length > 0 && (
          <Select value={selectedPeriod} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {availablePeriods.map((p) => (
                <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                  {MONTH_NAMES[p.month - 1]} {p.year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Loading...
        </div>
      ) : entities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Entities</h3>
            <p className="text-muted-foreground text-center">
              No entities found for this organization.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Org-Level Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Entities</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {closedEntities.length}/{entities.length}
                </div>
                <p className="text-xs text-muted-foreground">closed this period</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Overall Progress</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{orgCompletionPct}%</div>
                <Progress value={orgCompletionPct} className="mt-2 h-2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Tasks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {completedTasks}/{totalTasks}
                </div>
                <p className="text-xs text-muted-foreground">completed across all entities</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Gate Checks</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const totalGC = entitiesWithPeriod.reduce(
                    (s, e) => s + (e.period?.gateChecks.total ?? 0),
                    0
                  );
                  const passedGC = entitiesWithPeriod.reduce(
                    (s, e) => s + (e.period?.gateChecks.passed ?? 0),
                    0
                  );
                  const critFailed = entitiesWithPeriod.reduce(
                    (s, e) => s + (e.period?.gateChecks.criticalFailed ?? 0),
                    0
                  );
                  return (
                    <>
                      <div className="text-2xl font-bold">
                        {passedGC}/{totalGC}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {critFailed > 0
                          ? `${critFailed} critical failures`
                          : "checks passed"}
                      </p>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Entity Detail Table */}
          <Card>
            <CardHeader>
              <CardTitle>Entity Status</CardTitle>
              <CardDescription>
                {selectedPeriod
                  ? `${MONTH_NAMES[Number(selectedPeriod.split("-")[1]) - 1]} ${selectedPeriod.split("-")[0]}`
                  : "Latest period"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Entity</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Progress</th>
                      <th className="pb-2 font-medium text-center">Phase 1</th>
                      <th className="pb-2 font-medium text-center">Phase 2</th>
                      <th className="pb-2 font-medium text-center">Phase 3</th>
                      <th className="pb-2 font-medium text-center">Phase 4</th>
                      <th className="pb-2 font-medium">Gate Checks</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entities.map((entity) => (
                      <tr key={entity.id} className="border-b last:border-0">
                        <td className="py-3">
                          <div className="font-medium">{entity.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {entity.code}
                          </div>
                        </td>
                        <td className="py-3">
                          {entity.period ? (
                            <StatusBadge status={entity.period.status} />
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              No period
                            </span>
                          )}
                        </td>
                        <td className="py-3 min-w-[120px]">
                          {entity.period ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span>
                                  {entity.period.tasks.completed}/
                                  {entity.period.tasks.total}
                                </span>
                                <span className="text-muted-foreground">
                                  {entity.period.completionPct}%
                                </span>
                              </div>
                              <Progress
                                value={entity.period.completionPct}
                                className="h-1.5"
                              />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        {[1, 2, 3, 4].map((phase) => (
                          <td key={phase} className="py-3 text-center">
                            {entity.period?.tasks.byPhase[phase] ? (
                              <PhaseCell
                                total={entity.period.tasks.byPhase[phase].total}
                                completed={
                                  entity.period.tasks.byPhase[phase].completed
                                }
                              />
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        ))}
                        <td className="py-3">
                          {entity.period ? (
                            <GateCheckSummary
                              gateChecks={entity.period.gateChecks}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3">
                          {entity.period ? (
                            <Link
                              href={`/${entity.id}/close/${entity.period.id}`}
                            >
                              <Button variant="ghost" size="sm">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          ) : (
                            <Link href={`/${entity.id}/close`}>
                              <Button variant="ghost" size="sm">
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Timeline View */}
          <Card>
            <CardHeader>
              <CardTitle>Close Timeline</CardTitle>
              <CardDescription>
                Phase completion across entities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {entities
                  .filter((e) => e.period)
                  .map((entity) => (
                    <div key={entity.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {entity.name}
                        </span>
                        <StatusBadge status={entity.period!.status} />
                      </div>
                      <div className="flex gap-1 h-6">
                        {[1, 2, 3, 4].map((phase) => {
                          const phaseData =
                            entity.period!.tasks.byPhase[phase];
                          const pct =
                            phaseData && phaseData.total > 0
                              ? (phaseData.completed / phaseData.total) * 100
                              : 0;
                          const isComplete = pct === 100;
                          const hasWork =
                            phaseData && phaseData.total > 0;

                          return (
                            <div
                              key={phase}
                              className="flex-1 relative rounded overflow-hidden"
                              title={`${PHASE_NAMES[phase]}: ${phaseData?.completed ?? 0}/${phaseData?.total ?? 0} tasks`}
                            >
                              <div className="absolute inset-0 bg-muted" />
                              {hasWork && (
                                <div
                                  className={`absolute inset-y-0 left-0 transition-all ${
                                    isComplete
                                      ? "bg-green-500"
                                      : pct > 0
                                        ? "bg-blue-500"
                                        : ""
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              )}
                              <div className="relative flex items-center justify-center h-full text-xs font-medium">
                                {hasWork ? (
                                  isComplete ? (
                                    <CheckCircle2 className="h-3 w-3 text-white" />
                                  ) : (
                                    <span
                                      className={
                                        pct > 50
                                          ? "text-white"
                                          : "text-muted-foreground"
                                      }
                                    >
                                      P{phase}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-muted-foreground/50">
                                    P{phase}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PhaseCell({
  total,
  completed,
}: {
  total: number;
  completed: number;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = pct === 100;

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      {isComplete ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <span className="text-xs font-medium">
          {completed}/{total}
        </span>
      )}
      <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${isComplete ? "bg-green-500" : pct > 0 ? "bg-blue-500" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
