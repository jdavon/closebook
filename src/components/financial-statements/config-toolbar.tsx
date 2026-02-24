"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Printer, ChevronDown } from "lucide-react";
import type { Granularity, StatementTab } from "./types";

const TAB_LABELS: Record<StatementTab, string> = {
  "income-statement": "Income Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
  all: "All Statements",
};

interface ConfigToolbarProps {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeBudget: boolean;
  includeYoY: boolean;
  onStartYearChange: (year: number) => void;
  onStartMonthChange: (month: number) => void;
  onEndYearChange: (year: number) => void;
  onEndMonthChange: (month: number) => void;
  onGranularityChange: (granularity: Granularity) => void;
  onIncludeBudgetChange: (val: boolean) => void;
  onIncludeYoYChange: (val: boolean) => void;
  onExport: () => void;
  onExportAll?: () => void;
  onPrint: () => void;
  loading?: boolean;
  activeTab?: StatementTab;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];

export function ConfigToolbar({
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  includeBudget,
  includeYoY,
  onStartYearChange,
  onStartMonthChange,
  onEndYearChange,
  onEndMonthChange,
  onGranularityChange,
  onIncludeBudgetChange,
  onIncludeYoYChange,
  onExport,
  onExportAll,
  onPrint,
  loading = false,
  activeTab,
}: ConfigToolbarProps) {
  const isIndividualTab = activeTab && activeTab !== "all";

  return (
    <div className="stmt-no-print flex flex-wrap items-end gap-3 pb-4 border-b">
      {/* Start Period */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <div className="flex gap-1">
          <Select
            value={String(startMonth)}
            onValueChange={(v) => onStartMonthChange(parseInt(v))}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(startYear)}
            onValueChange={(v) => onStartYearChange(parseInt(v))}
          >
            <SelectTrigger className="w-[80px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* End Period */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <div className="flex gap-1">
          <Select
            value={String(endMonth)}
            onValueChange={(v) => onEndMonthChange(parseInt(v))}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(endYear)}
            onValueChange={(v) => onEndYearChange(parseInt(v))}
          >
            <SelectTrigger className="w-[80px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Granularity */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">View</Label>
        <Select
          value={granularity}
          onValueChange={(v) => onGranularityChange(v as Granularity)}
        >
          <SelectTrigger className="w-[110px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Separator */}
      <div className="h-8 w-px bg-border" />

      {/* Toggles */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={includeYoY}
            onCheckedChange={(checked) => onIncludeYoYChange(checked === true)}
          />
          YoY Change
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={includeBudget}
            onCheckedChange={(checked) =>
              onIncludeBudgetChange(checked === true)
            }
          />
          Budget
        </label>
      </div>

      {/* Separator */}
      <div className="h-8 w-px bg-border" />

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isIndividualTab ? (
          /* Split button: main exports current tab, dropdown offers "Export All" */
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={loading}
              className="h-8 text-xs rounded-r-none border-r-0"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export {TAB_LABELS[activeTab]}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="h-8 px-1.5 rounded-l-none"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onExportAll}>
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Export All Statements
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={loading}
            className="h-8 text-xs"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onPrint}
          disabled={loading}
          className="h-8 text-xs"
        >
          <Printer className="h-3.5 w-3.5 mr-1" />
          Print
        </Button>
      </div>
    </div>
  );
}
