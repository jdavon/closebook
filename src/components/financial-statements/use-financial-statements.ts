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

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      scope: config.scope,
      startYear: String(config.startYear),
      startMonth: String(config.startMonth),
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
      granularity: config.granularity,
      includeBudget: String(config.includeBudget),
      includeYoY: String(config.includeYoY),
    });

    if (config.entityId) params.set("entityId", config.entityId);
    if (config.organizationId)
      params.set("organizationId", config.organizationId);

    try {
      const response = await fetch(
        `/api/financial-statements?${params.toString()}`
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: FinancialStatementsResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [
    enabled,
    config.scope,
    config.entityId,
    config.organizationId,
    config.startYear,
    config.startMonth,
    config.endYear,
    config.endMonth,
    config.granularity,
    config.includeBudget,
    config.includeYoY,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
