"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowRight, TableProperties } from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import type { ScheduleStatus, ScheduleType } from "@/lib/types/database";

interface Schedule {
  id: string;
  name: string;
  schedule_type: ScheduleType;
  status: ScheduleStatus;
  total_amount: number;
  gl_balance: number | null;
  variance: number | null;
  accounts?: { name: string; account_number: string | null } | null;
}

const TYPE_LABELS: Record<ScheduleType, string> = {
  prepaid: "Prepaid",
  fixed_asset: "Fixed Asset",
  debt: "Debt",
  accrual: "Accrual",
  custom: "Custom",
};

export default function SchedulesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSchedules = useCallback(async () => {
    const { data } = await supabase
      .from("schedules")
      .select("*, accounts(name, account_number)")
      .eq("entity_id", entityId)
      .order("name");

    setSchedules((data as unknown as Schedule[]) ?? []);
    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-muted-foreground">
            Supporting schedules tied to GL accounts
          </p>
        </div>
        <Link href={`/${entityId}/schedules/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Schedule
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <TableProperties className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Schedules Yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Create supporting schedules to track prepaid expenses, fixed
                assets, debt, and more.
              </p>
              <Link href={`/${entityId}/schedules/new`}>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Schedule
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">GL Balance</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TYPE_LABELS[schedule.schedule_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {schedule.accounts
                        ? `${schedule.accounts.account_number ?? ""} ${schedule.accounts.name}`.trim()
                        : "---"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          schedule.status === "finalized"
                            ? "default"
                            : "outline"
                        }
                      >
                        {schedule.status === "finalized"
                          ? "Finalized"
                          : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(schedule.total_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {schedule.gl_balance !== null
                        ? formatCurrency(schedule.gl_balance)
                        : "---"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {schedule.variance !== null ? (
                        <span
                          className={
                            schedule.variance === 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {formatCurrency(schedule.variance)}
                        </span>
                      ) : (
                        "---"
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/${entityId}/schedules/${schedule.id}`}
                      >
                        <Button variant="ghost" size="sm">
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
