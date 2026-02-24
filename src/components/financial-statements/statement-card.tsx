"use client";

import { Card, CardContent } from "@/components/ui/card";
import { StatementHeader } from "./statement-header";
import { StatementTable } from "./statement-table";
import type { StatementData, Period, Granularity } from "./types";

interface StatementCardProps {
  companyName: string;
  statementTitle: string;
  statementData: StatementData;
  periods: Period[];
  showBudget: boolean;
  showYoY: boolean;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  pageBreak?: boolean;
}

export function StatementCard({
  companyName,
  statementTitle,
  statementData,
  periods,
  showBudget,
  showYoY,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  pageBreak = false,
}: StatementCardProps) {
  return (
    <div className={pageBreak ? "stmt-page-break" : undefined}>
      <Card>
        <CardContent className="pt-2 pb-6 px-4">
          <StatementHeader
            companyName={companyName}
            statementTitle={statementTitle}
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            granularity={granularity}
          />
          <StatementTable
            data={statementData}
            periods={periods}
            showBudget={showBudget}
            showYoY={showYoY}
          />
        </CardContent>
      </Card>
    </div>
  );
}
