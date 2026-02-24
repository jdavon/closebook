"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { StatementCard } from "@/components/financial-statements/statement-card";
import { ConfigToolbar } from "@/components/financial-statements/config-toolbar";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import type {
  Granularity,
  Scope,
  StatementTab,
  FinancialModelConfig,
} from "@/components/financial-statements/types";

interface Entity {
  id: string;
  name: string;
  code: string;
}

export default function FinancialModelPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  // Organization / entity state
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [scope, setScope] = useState<Scope>("organization");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Config state
  const [startYear, setStartYear] = useState(currentPeriod.year);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(currentPeriod.year);
  const [endMonth, setEndMonth] = useState(currentPeriod.month);
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [includeBudget, setIncludeBudget] = useState(false);
  const [includeYoY, setIncludeYoY] = useState(false);
  const [activeTab, setActiveTab] = useState<StatementTab>("all");

  // Load organization
  const loadOrg = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);

      const { data: ents } = await supabase
        .from("entities")
        .select("id, name, code")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("name");

      setEntities(ents ?? []);
    }
  }, [supabase]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const config: FinancialModelConfig = {
    scope,
    entityId: scope === "entity" ? (selectedEntityId ?? undefined) : undefined,
    organizationId:
      scope === "organization" ? (organizationId ?? undefined) : undefined,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
    includeBudget,
    includeYoY,
  };

  // Only fetch when we have the IDs we need
  const canFetch =
    (scope === "organization" && organizationId) ||
    (scope === "entity" && selectedEntityId);

  const { data, loading, error } = useFinancialStatements(config, !!canFetch);

  function buildExportUrl(statements: StatementTab) {
    const exportParams = new URLSearchParams({
      scope,
      startYear: String(startYear),
      startMonth: String(startMonth),
      endYear: String(endYear),
      endMonth: String(endMonth),
      granularity,
      includeBudget: String(includeBudget),
      includeYoY: String(includeYoY),
      statements,
    });
    if (scope === "entity" && selectedEntityId) {
      exportParams.set("entityId", selectedEntityId);
    }
    if (scope === "organization" && organizationId) {
      exportParams.set("organizationId", organizationId);
    }
    return `/api/financial-statements/export?${exportParams.toString()}`;
  }

  function handleExport() {
    window.location.href = buildExportUrl(activeTab);
  }

  function handleExportAll() {
    window.location.href = buildExportUrl("all");
  }

  function handlePrint() {
    window.print();
  }

  const companyName =
    data?.metadata.organizationName ?? data?.metadata.entityName ?? "";

  const titlePrefix = scope === "organization" ? "Consolidated " : "";

  const sharedCardProps = {
    companyName,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="stmt-no-print">
        <h1 className="text-2xl font-semibold tracking-tight">
          Financial Model
        </h1>
        <p className="text-muted-foreground text-sm">
          Consolidated three-statement financial model
        </p>
      </div>

      {/* Scope selector */}
      <div className="stmt-no-print flex items-end gap-3 pb-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scope</Label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Consolidated</SelectItem>
              <SelectItem value="entity">Single Entity</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {scope === "entity" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Entity</Label>
            <Select
              value={selectedEntityId ?? ""}
              onValueChange={setSelectedEntityId}
            >
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue placeholder="Select entity..." />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Config toolbar */}
      <ConfigToolbar
        startYear={startYear}
        startMonth={startMonth}
        endYear={endYear}
        endMonth={endMonth}
        granularity={granularity}
        includeBudget={includeBudget}
        includeYoY={includeYoY}
        onStartYearChange={setStartYear}
        onStartMonthChange={setStartMonth}
        onEndYearChange={setEndYear}
        onEndMonthChange={setEndMonth}
        onGranularityChange={setGranularity}
        onIncludeBudgetChange={setIncludeBudget}
        onIncludeYoYChange={setIncludeYoY}
        onExport={handleExport}
        onExportAll={handleExportAll}
        onPrint={handlePrint}
        loading={loading}
        activeTab={activeTab}
      />

      {!canFetch && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {scope === "entity"
                ? "Select an entity to view financial statements."
                : "Loading organization data..."}
            </p>
          </CardContent>
        </Card>
      )}

      {loading && canFetch && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Loading financial statements...
            </p>
          </CardContent>
        </Card>
      )}

      {error && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.periods.length > 0 && canFetch && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as StatementTab)}
        >
          <TabsList className="stmt-no-print">
            <TabsTrigger value="all">All Statements</TabsTrigger>
            <TabsTrigger value="income-statement">Income Statement</TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
          </TabsList>

          {/* All Statements */}
          <TabsContent value="all" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Income Statement`}
              statementData={data.incomeStatement}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Balance Sheet`}
              statementData={data.balanceSheet}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
              pageBreak
            />
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Statement of Cash Flows`}
              statementData={data.cashFlowStatement}
              periods={data.periods}
              showBudget={false}
              showYoY={includeYoY}
              pageBreak
            />
          </TabsContent>

          {/* Income Statement */}
          <TabsContent value="income-statement">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Income Statement`}
              statementData={data.incomeStatement}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
          </TabsContent>

          {/* Balance Sheet */}
          <TabsContent value="balance-sheet">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Balance Sheet`}
              statementData={data.balanceSheet}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
          </TabsContent>

          {/* Cash Flow */}
          <TabsContent value="cash-flow">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Statement of Cash Flows`}
              statementData={data.cashFlowStatement}
              periods={data.periods}
              showBudget={false}
              showYoY={includeYoY}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
