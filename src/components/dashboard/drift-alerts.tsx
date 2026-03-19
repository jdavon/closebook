"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface DriftAlert {
  id: string;
  account_id: string;
  period_year: number;
  period_month: number;
  previous_balance: number;
  current_balance: number;
  drift_amount: number;
  snapshot_date: string;
  previous_snapshot_date: string;
  accounts: {
    name: string;
    account_number: string | null;
    account_type: string;
    classification: string;
  };
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function DriftAlertBanner({
  entityId,
  initialAlerts,
}: {
  entityId: string;
  initialAlerts: DriftAlert[];
}) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  if (alerts.length === 0) return null;

  async function dismissAlert(alertId: string) {
    try {
      const res = await fetch("/api/drift/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        toast.success("Alert dismissed");
      }
    } catch {
      toast.error("Failed to dismiss alert");
    }
  }

  async function dismissAll() {
    setDismissing(true);
    try {
      const res = await fetch("/api/drift/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissAll: true, entityId }),
      });
      if (res.ok) {
        setAlerts([]);
        toast.success("All alerts dismissed");
      }
    } catch {
      toast.error("Failed to dismiss alerts");
    }
    setDismissing(false);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {alerts.length} balance drift{alerts.length !== 1 ? "s" : ""} detected
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Monitored account balances changed since last sync
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              dismissAll();
            }}
            disabled={dismissing}
            className="text-amber-700 border-amber-300 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-700"
          >
            Dismiss All
          </Button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-amber-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-amber-600" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium">{alert.accounts.name}</span>
                      {alert.accounts.account_number && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          #{alert.accounts.account_number}
                        </span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs mt-0.5">
                      {alert.accounts.classification}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {MONTH_NAMES[alert.period_month]} {alert.period_year}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(alert.previous_balance)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(alert.current_balance)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-sm font-medium ${
                      alert.drift_amount > 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {alert.drift_amount > 0 ? "+" : ""}
                    {formatCurrency(alert.drift_amount)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => dismissAlert(alert.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
