"use client";

import { getStatementPeriodDescription } from "./format-utils";
import type { Granularity } from "./types";

interface StatementHeaderProps {
  companyName: string;
  statementTitle: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  unaudited?: boolean;
}

export function StatementHeader({
  companyName,
  statementTitle,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  unaudited = true,
}: StatementHeaderProps) {
  const periodDescription = getStatementPeriodDescription(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );

  return (
    <div className="text-center py-4 space-y-0.5">
      <div className="text-sm font-bold uppercase tracking-wide">
        {companyName}
      </div>
      <div className="text-sm font-bold uppercase tracking-wide">
        {statementTitle}
        {unaudited && " UNAUDITED"}
      </div>
      <div className="text-xs text-muted-foreground italic">
        {periodDescription}
      </div>
    </div>
  );
}
