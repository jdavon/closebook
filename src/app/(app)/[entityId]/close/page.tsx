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
import { Plus, ArrowRight } from "lucide-react";
import { getPeriodLabel } from "@/lib/utils/dates";
import type { CloseStatus } from "@/lib/types/database";

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
  const variants: Record<CloseStatus, "default" | "secondary" | "outline" | "destructive"> = {
    closed: "default",
    locked: "default",
    review: "secondary",
    in_progress: "secondary",
    open: "outline",
  };
  const labels: Record<CloseStatus, string> = {
    open: "Open",
    in_progress: "In Progress",
    review: "In Review",
    closed: "Closed",
    locked: "Locked",
  };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
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

    // Load task counts for each period
    if (data && data.length > 0) {
      const { data: tasks } = await supabase
        .from("close_tasks")
        .select("close_period_id, status")
        .in("close_period_id", data.map((p) => p.id));

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

    // Create the close period
    const { data: period, error } = await supabase
      .from("close_periods")
      .insert({
        entity_id: entityId,
        period_year: year,
        period_month: month,
        status: "open",
      })
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }

    // Get user's org to load task templates
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      // Load templates and create tasks
      const { data: templates } = await supabase
        .from("close_task_templates")
        .select("*")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("display_order");

      if (templates && templates.length > 0) {
        // Match templates to accounts
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, classification, account_type")
          .eq("entity_id", entityId)
          .eq("is_active", true);

        const tasksToInsert = [];

        for (const template of templates) {
          if (template.account_classification || template.account_type) {
            // Create one task per matching account
            const matchingAccounts = (accounts ?? []).filter(
              (a) =>
                (!template.account_classification ||
                  a.classification === template.account_classification) &&
                (!template.account_type ||
                  a.account_type === template.account_type)
            );

            for (const account of matchingAccounts) {
              tasksToInsert.push({
                close_period_id: period.id,
                template_id: template.id,
                account_id: account.id,
                name: template.name,
                description: template.description,
                category: template.category,
                display_order: template.display_order,
              });
            }
          } else {
            // General task not linked to specific accounts
            tasksToInsert.push({
              close_period_id: period.id,
              template_id: template.id,
              name: template.name,
              description: template.description,
              category: template.category,
              display_order: template.display_order,
            });
          }
        }

        if (tasksToInsert.length > 0) {
          await supabase.from("close_tasks").insert(tasksToInsert);
        }
      }
    }

    toast.success(
      `Close period initialized: ${getPeriodLabel(year, month)}`
    );
    setCreating(false);
    loadPeriods();
    router.push(`/${entityId}/close/${period.id}`);
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
              No close periods yet. Click &quot;Initialize Period&quot; to create your
              first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
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
