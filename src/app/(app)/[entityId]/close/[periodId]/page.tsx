"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
} from "lucide-react";
import { getPeriodLabel, formatCurrency } from "@/lib/utils/dates";
import type { TaskStatus, CloseStatus } from "@/lib/types/database";

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

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; icon: React.ElementType; color: string }
> = {
  not_started: { label: "Not Started", icon: MinusCircle, color: "text-muted-foreground" },
  in_progress: { label: "In Progress", icon: Clock, color: "text-yellow-500" },
  pending_review: { label: "Pending Review", icon: AlertCircle, color: "text-blue-500" },
  approved: { label: "Approved", icon: CheckCircle2, color: "text-green-500" },
  rejected: { label: "Rejected", icon: XCircle, color: "text-red-500" },
  na: { label: "N/A", icon: MinusCircle, color: "text-muted-foreground" },
};

export default function ClosePeriodDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const periodId = params.periodId as string;
  const supabase = createClient();

  const [period, setPeriod] = useState<ClosePeriod | null>(null);
  const [tasks, setTasks] = useState<CloseTask[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [periodResult, tasksResult] = await Promise.all([
      supabase
        .from("close_periods")
        .select("*")
        .eq("id", periodId)
        .single(),
      supabase
        .from("close_tasks")
        .select("*, accounts(name, account_number)")
        .eq("close_period_id", periodId)
        .order("display_order")
        .order("name"),
    ]);

    setPeriod(periodResult.data as ClosePeriod | null);
    setTasks((tasksResult.data as unknown as CloseTask[]) ?? []);
    setLoading(false);
  }, [supabase, periodId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleStatusChange(taskId: string, newStatus: TaskStatus) {
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

  async function handleClosePeriod() {
    const unfinished = tasks.filter(
      (t) => t.status !== "approved" && t.status !== "na"
    );
    if (unfinished.length > 0) {
      toast.error(
        `Cannot close: ${unfinished.length} task(s) are not yet approved or N/A`
      );
      return;
    }

    const { error } = await supabase
      .from("close_periods")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", periodId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setPeriod((prev) => (prev ? { ...prev, status: "closed" } : null));
    toast.success("Period closed successfully");
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (!period) {
    return <p className="text-muted-foreground">Period not found</p>;
  }

  const filteredTasks =
    filter === "all"
      ? tasks
      : tasks.filter((t) => t.status === filter);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status === "approved" || t.status === "na"
  ).length;
  const progressPct =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const categories = [...new Set(tasks.map((t) => t.category).filter(Boolean))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {getPeriodLabel(period.period_year, period.period_month)}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge
              variant={
                period.status === "closed" ? "default" : "outline"
              }
            >
              {period.status === "closed" ? (
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
        {period.status !== "closed" && period.status !== "locked" && (
          <Button onClick={handleClosePeriod}>
            <Lock className="mr-2 h-4 w-4" />
            Close Period
          </Button>
        )}
      </div>

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
                  <SelectItem value="pending_review">
                    Pending Review
                  </SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="na">N/A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">GL Balance</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    {tasks.length === 0
                      ? "No tasks yet. Add task templates in Settings to auto-generate tasks."
                      : "No tasks match the current filter."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map((task) => {
                  const statusConfig = STATUS_CONFIG[task.status];
                  const StatusIcon = statusConfig.icon;

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        {task.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {task.accounts
                          ? `${task.accounts.account_number ?? ""} ${task.accounts.name}`.trim()
                          : "---"}
                      </TableCell>
                      <TableCell>
                        {task.category && (
                          <Badge variant="outline" className="text-xs">
                            {task.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {period.status === "closed" ||
                        period.status === "locked" ? (
                          <div className="flex items-center gap-1">
                            <StatusIcon
                              className={`h-4 w-4 ${statusConfig.color}`}
                            />
                            <span className="text-sm">
                              {statusConfig.label}
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
                                    <SelectItem key={key} value={key}>
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
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
