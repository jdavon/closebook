"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import type { OrgSummary } from "@/lib/db/queries/org-summary";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface OrgSummaryCardProps {
  summary: OrgSummary;
}

export function OrgSummaryCard({ summary }: OrgSummaryCardProps) {
  const periodLabel = summary.currentPeriod
    ? `${MONTH_LABELS[summary.currentPeriod.month - 1]} ${summary.currentPeriod.year}`
    : "No open period";

  const { closed, inProgress, open, total } = summary.closeStatus;

  return (
    <Link
      href="/close-dashboard"
      className="group flex flex-col gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5 text-xs transition-colors hover:bg-sidebar-accent"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-sidebar-foreground">
          Current Period
        </span>
        <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="text-sm font-semibold text-sidebar-foreground">
        {periodLabel}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="size-3 text-emerald-500" />
            {closed}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3 text-amber-500" />
            {inProgress}
          </span>
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="size-3 text-muted-foreground" />
            {open}
          </span>
          <span className="ml-auto">of {total}</span>
        </div>
      )}
    </Link>
  );
}
