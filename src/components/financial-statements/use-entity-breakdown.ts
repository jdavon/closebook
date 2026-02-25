"use client";

import { useState, useEffect, useCallback } from "react";
import type { EntityBreakdownResponse } from "./types";

interface UseEntityBreakdownConfig {
  organizationId?: string;
  reportingEntityId?: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: string;
  includeProForma: boolean;
  includeAllocations?: boolean;
}

interface UseEntityBreakdownReturn {
  data: EntityBreakdownResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEntityBreakdown(
  config: UseEntityBreakdownConfig,
  enabled: boolean = true
): UseEntityBreakdownReturn {
  const [data, setData] = useState<EntityBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled || !config.organizationId) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organizationId: config.organizationId,
      startYear: String(config.startYear),
      startMonth: String(config.startMonth),
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
      granularity: config.granularity,
      includeProForma: String(config.includeProForma),
      includeAllocations: String(config.includeAllocations ?? false),
    });

    if (config.reportingEntityId)
      params.set("reportingEntityId", config.reportingEntityId);

    try {
      const response = await fetch(
        `/api/financial-statements/entity-breakdown?${params.toString()}`
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: EntityBreakdownResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [
    enabled,
    config.organizationId,
    config.reportingEntityId,
    config.startYear,
    config.startMonth,
    config.endYear,
    config.endMonth,
    config.granularity,
    config.includeProForma,
    config.includeAllocations,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
