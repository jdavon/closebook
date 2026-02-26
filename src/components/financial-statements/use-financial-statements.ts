"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  FinancialStatementsResponse,
  FinancialModelConfig,
} from "./types";

interface UseFinancialStatementsReturn {
  data: FinancialStatementsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFinancialStatements(
  config: FinancialModelConfig,
  enabled: boolean = true
): UseFinancialStatementsReturn {
  const [data, setData] = useState<FinancialStatementsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    const { signal } = controller;

    const params = new URLSearchParams({
      scope: config.scope,
      startYear: String(config.startYear),
      startMonth: String(config.startMonth),
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
      granularity: config.granularity,
      includeBudget: String(config.includeBudget),
      includeYoY: String(config.includeYoY),
      includeProForma: String(config.includeProForma),
      includeAllocations: String(config.includeAllocations),
    });

    if (config.entityId) params.set("entityId", config.entityId);
    if (config.organizationId)
      params.set("organizationId", config.organizationId);
    if (config.reportingEntityId)
      params.set("reportingEntityId", config.reportingEntityId);

    setLoading(true);
    setError(null);

    fetch(`/api/financial-statements?${params.toString()}`, { signal })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
          );
        }
        return response.json();
      })
      .then((result: FinancialStatementsResponse) => {
        if (!signal.aborted) {
          setData(result);
        }
      })
      .catch((err) => {
        if (!signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load data"
          );
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    enabled,
    config.scope,
    config.entityId,
    config.organizationId,
    config.reportingEntityId,
    config.startYear,
    config.startMonth,
    config.endYear,
    config.endMonth,
    config.granularity,
    config.includeBudget,
    config.includeYoY,
    config.includeProForma,
    config.includeAllocations,
    fetchCount,
  ]);

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return { data, loading, error, refetch };
}
