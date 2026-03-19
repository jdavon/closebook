"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Minus,
} from "lucide-react";
import { getPeriodLabel } from "@/lib/utils/dates";
import type { CloseStatus, GateCheckStatus } from "@/lib/types/database";

interface ClosePeriod {
  id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  status: CloseStatus;
  due_date: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: CloseStatus }) {
  const variants: Record<
    CloseStatus,
    "default" | "secondary" | "outline" | "destructive"
  > = {
    closed: "default",
    locked: "default",
    soft_closed: "secondary",
    review: "secondary",
    in_progress: "secondary",
    open: "outline",
  };
  const labels: Record<CloseStatus, string> = {
    open: "Open",
    in_progress: "In Progress",
    review: "In Review",
    soft_closed: "Soft Closed",
    closed: "Closed",
    locked: "Locked",
  };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

function GateCheckIcon({ checks }: { checks: Array<{ status: string; is_critical: boolean }> }) {
  if (checks.length === 0) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }

  const criticalFailed = checks.some(
    (c) => c.is_critical && c.status === "failed"
  );
  const anyFailed = checks.some((c) => c.status === "failed");
  const allPassed = checks.every(
    (c) => c.status === "passed" || c.status === "skipped"
  );
  const anyPending = checks.some((c) => c.status === "pending");

  if (criticalFailed) {
    return <XCircle className="h-4 w-4 text-red-500" />;
  }
  if (allPassed) {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  }
  if (anyFailed) {
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  }
  if (anyPending) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export default function ClosePeriodsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();
  const [periods, setPeriods] = useState<ClosePeriod[]>([]);
  const [taskCounts, setTaskCounts] = useState<
    Record<string, { total: number; completed: number }>
  >({});
  const [gateChecks, setGateChecks] = useState<
    Record<string, Array<{ status: string; is_critical: boolean }>>
  >({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadPeriods = useCallback(async () => {
    const { data } = await supabase
      .from("close_periods")
      .select("*")
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    setPeriods((data as ClosePeriod[]) ?? []);

    if (data && data.length > 0) {
      const periodIds = data.map((p) => p.id);

      // Load task counts
      const { data: tasks } = await supabase
        .from("close_tasks")
        .select("close_period_id, status")
        .in("close_period_id", periodIds);

      if (tasks) {
        const counts: Record<string, { total: number; completed: number }> = {};
        for (const task of tasks) {
          if (!counts[task.close_period_id]) {
            counts[task.close_period_id] = { total: 0, completed: 0 };
          }
          counts[task.close_period_id].total++;
          if (task.status === "approved" || task.status === "na") {
            counts[task.close_period_id].completed++;
          }
        }
        setTaskCounts(counts);
      }

      // Load gate check summaries
      const { data: checks } = await supabase
        .from("close_gate_checks")
        .select("close_period_id, status, is_critical")
        .in("close_period_id", periodIds);

      if (checks) {
        const grouped: Record<
          string,
          Array<{ status: string; is_critical: boolean }>
        > = {};
        for (const check of checks) {
          if (!grouped[check.close_period_id]) {
            grouped[check.close_period_id] = [];
          }
          grouped[check.close_period_id].push({
            status: check.status,
            is_critical: check.is_critical,
          });
        }
        setGateChecks(grouped);
      }
    }

    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  async function handleInitializePeriod() {
    setCreating(true);

    // Determine the next period to create
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;

    if (periods.length > 0) {
      const latest = periods[0];
      month = latest.period_month + 1;
      year = latest.period_year;
      if (month > 12) {
        month = 1;
        year++;
      }
    }

    try {
      const res = await fetch("/api/close/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          periodYear: year,
          periodMonth: month,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to initialize period");
        setCreating(false);
        return;
      }

      toast.success(
        `Close period initialized: ${getPeriodLabel(year, month)} (${data.taskCount} tasks)`
      );
      setCreating(false);
      router.push(`/${entityId}/close/${data.period.id}`);
    } catch {
      toast.error("Failed to initialize period");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Close Management
          </h1>
          <p className="text-muted-foreground">
            Manage month-end close periods and tasks
          </p>
        </div>
        <Button onClick={handleInitializePeriod} disabled={creating}>
          <Plus className="mr-2 h-4 w-4" />
          {creating ? "Creating..." : "Initialize Period"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Close Periods</CardTitle>
          <CardDescription>
            {periods.length} period{periods.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No close periods yet. Click &quot;Initialize Period&quot; to create
              your first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Gate Checks</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const counts = taskCounts[period.id];
                  const pct =
                    counts && counts.total > 0
                      ? Math.round((counts.completed / counts.total) * 100)
                      : 0;
                  const periodChecks = gateChecks[period.id] ?? [];

                  return (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">
                        {getPeriodLabel(
                          period.period_year,
                          period.period_month
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={period.status} />
                      </TableCell>
                      <TableCell>
                        {counts ? (
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-2 w-20" />
                            <span className="text-xs text-muted-foreground">
                              {counts.completed}/{counts.total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No tasks
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <GateCheckIcon checks={periodChecks} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {period.due_date
                          ? new Date(period.due_date).toLocaleDateString()
                          : "---"}
                      </TableCell>
                      <TableCell>
                        <Link href={`/${entityId}/close/${period.id}`}>
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
        </CardContent>
      </Card>
    </div>
  );
}
