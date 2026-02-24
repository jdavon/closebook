"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { StatementHeader } from "@/components/financial-statements/statement-header";
import { StatementTable } from "@/components/financial-statements/statement-table";
import { ConfigToolbar } from "@/components/financial-statements/config-toolbar";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import type {
  Granularity,
  Scope,
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

  // Refs for jump navigation
  const isRef = useRef<HTMLDivElement>(null);
  const bsRef = useRef<HTMLDivElement>(null);
  const cfRef = useRef<HTMLDivElement>(null);

  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleExport() {
    const params = new URLSearchParams({
      scope,
      startYear: String(startYear),
      startMonth: String(startMonth),
      endYear: String(endYear),
      endMonth: String(endMonth),
      granularity,
      includeBudget: String(includeBudget),
      includeYoY: String(includeYoY),
    });
    if (scope === "entity" && selectedEntityId) {
      params.set("entityId", selectedEntityId);
    }
    if (scope === "organization" && organizationId) {
      params.set("organizationId", organizationId);
    }
    window.location.href = `/api/financial-statements/export?${params.toString()}`;
  }

  function handlePrint() {
    window.print();
  }

  const companyName =
    data?.metadata.organizationName ?? data?.metadata.entityName ?? "";

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
        onPrint={handlePrint}
        loading={loading}
      />

      {/* Jump navigation */}
      {data && !loading && canFetch && (
        <div className="stmt-no-print flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => scrollTo(isRef)}
          >
            Income Statement
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => scrollTo(bsRef)}
          >
            Balance Sheet
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => scrollTo(cfRef)}
          >
            Cash Flow
          </Button>
        </div>
      )}

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
        <>
          <div ref={isRef}>
            <Card>
              <CardContent className="pt-2 pb-6 px-4">
                <StatementHeader
                  companyName={companyName}
                  statementTitle={
                    scope === "organization"
                      ? "Consolidated Income Statement"
                      : "Income Statement"
                  }
                  startYear={startYear}
                  startMonth={startMonth}
                  endYear={endYear}
                  endMonth={endMonth}
                  granularity={granularity}
                />
                <StatementTable
                  data={data.incomeStatement}
                  periods={data.periods}
                  showBudget={includeBudget}
                  showYoY={includeYoY}
                />
              </CardContent>
            </Card>
          </div>

          <div ref={bsRef} className="stmt-page-break">
            <Card>
              <CardContent className="pt-2 pb-6 px-4">
                <StatementHeader
                  companyName={companyName}
                  statementTitle={
                    scope === "organization"
                      ? "Consolidated Balance Sheet"
                      : "Balance Sheet"
                  }
                  startYear={startYear}
                  startMonth={startMonth}
                  endYear={endYear}
                  endMonth={endMonth}
                  granularity={granularity}
                />
                <StatementTable
                  data={data.balanceSheet}
                  periods={data.periods}
                  showBudget={includeBudget}
                  showYoY={includeYoY}
                />
              </CardContent>
            </Card>
          </div>

          <div ref={cfRef} className="stmt-page-break">
            <Card>
              <CardContent className="pt-2 pb-6 px-4">
                <StatementHeader
                  companyName={companyName}
                  statementTitle={
                    scope === "organization"
                      ? "Consolidated Statement of Cash Flows"
                      : "Statement of Cash Flows"
                  }
                  startYear={startYear}
                  startMonth={startMonth}
                  endYear={endYear}
                  endMonth={endMonth}
                  granularity={granularity}
                />
                <StatementTable
                  data={data.cashFlowStatement}
                  periods={data.periods}
                  showBudget={false}
                  showYoY={includeYoY}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
