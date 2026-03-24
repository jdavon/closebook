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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Calendar,
} from "lucide-react";
import { getPeriodLabel } from "@/lib/utils/dates";
import type { CloseStatus, GateCheckStatus } from "@/lib/types/database";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

  // Year filter
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const years = [...new Set(periods.map((p) => p.period_year))].sort((a, b) => b - a);
  // Ensure current year and previous year are always in the list
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!years.includes(currentYear - 1)) years.push(currentYear - 1);
  years.sort((a, b) => b - a);

  // New period dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newMonth, setNewMonth] = useState(String(new Date().getMonth() + 1));
  const [newYear, setNewYear] = useState(String(currentYear));

  // Which months already have periods
  const existingPeriodKeys = new Set(
    periods.map((p) => `${p.period_year}-${p.period_month}`)
  );

  const filteredPeriods = selectedYear === "all"
    ? periods
    : periods.filter((p) => p.period_year === Number(selectedYear));

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

  async function handleCreatePeriod() {
    const year = Number(newYear);
    const month = Number(newMonth);

    if (existingPeriodKeys.has(`${year}-${month}`)) {
      toast.error(`${MONTH_NAMES[month - 1]} ${year} already exists`);
      return;
    }

    setCreating(true);

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
      setDialogOpen(false);
      setCreating(false);
      router.push(`/${entityId}/close/${data.period.id}`);
    } catch {
      toast.error("Failed to initialize period");
      setCreating(false);
    }
  }

  // Quick summary stats for the selected year
  const yearPeriods = periods.filter((p) => p.period_year === Number(selectedYear));
  const closedCount = yearPeriods.filter((p) =>
    ["closed", "locked", "soft_closed"].includes(p.status)
  ).length;
  const openCount = yearPeriods.filter((p) =>
    ["open", "in_progress", "review"].includes(p.status)
  ).length;
  const uninitializedCount = 12 - yearPeriods.length;

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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Initialize Period
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Initialize Close Period</DialogTitle>
              <DialogDescription>
                Select the month and year to create a new close period with auto-generated tasks.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 py-4">
              <Select value={newMonth} onValueChange={setNewMonth}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => {
                    const exists = existingPeriodKeys.has(`${newYear}-${i + 1}`);
                    return (
                      <SelectItem
                        key={i}
                        value={String(i + 1)}
                        disabled={exists}
                      >
                        {name} {exists ? "(exists)" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Select value={newYear} onValueChange={setNewYear}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreatePeriod}
                disabled={creating || existingPeriodKeys.has(`${newYear}-${newMonth}`)}
              >
                {creating ? "Creating..." : "Initialize"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Year summary */}
      {!loading && selectedYear !== "all" && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Closed</p>
                  <p className="text-2xl font-bold">{closedCount}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">In Progress</p>
                  <p className="text-2xl font-bold">{openCount}</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Not Initialized</p>
                  <p className="text-2xl font-bold">{uninitializedCount}</p>
                </div>
                <Minus className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Year</p>
                  <p className="text-2xl font-bold">{selectedYear}</p>
                </div>
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Year filter + period grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Close Periods</CardTitle>
              <CardDescription>
                {filteredPeriods.length} period{filteredPeriods.length !== 1 ? "s" : ""}
                {selectedYear !== "all" ? ` in ${selectedYear}` : ""}
              </CardDescription>
            </div>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : selectedYear !== "all" ? (
            /* Calendar grid view for a specific year */
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {MONTH_NAMES.map((name, i) => {
                const month = i + 1;
                const period = yearPeriods.find((p) => p.period_month === month);

                if (!period) {
                  return (
                    <button
                      key={month}
                      onClick={() => {
                        setNewMonth(String(month));
                        setNewYear(selectedYear);
                        setDialogOpen(true);
                      }}
                      className="rounded-lg border border-dashed p-4 text-center hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <p className="text-sm font-medium text-muted-foreground">{name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Not initialized</p>
                    </button>
                  );
                }

                const counts = taskCounts[period.id];
                const pct = counts && counts.total > 0
                  ? Math.round((counts.completed / counts.total) * 100)
                  : 0;

                return (
                  <Link key={month} href={`/${entityId}/close/${period.id}`}>
                    <div className="rounded-lg border p-4 text-center hover:border-primary/50 transition-colors cursor-pointer">
                      <p className="text-sm font-medium">{name}</p>
                      <div className="mt-2">
                        <StatusBadge status={period.status} />
                      </div>
                      {counts && (
                        <div className="mt-2 space-y-1">
                          <Progress value={pct} className="h-1.5" />
                          <p className="text-xs text-muted-foreground">
                            {counts.completed}/{counts.total} ({pct}%)
                          </p>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : filteredPeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No close periods yet. Click &quot;Initialize Period&quot; to create
              your first one.
            </p>
          ) : (
            /* Table view for all years */
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
                {filteredPeriods.map((period) => {
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
