"use client";

import { useState, useEffect, useCallback } from "react";
import type { ICEliminationsResponse } from "./types";

interface UseICEliminationsConfig {
  organizationId?: string;
  endYear: number;
  endMonth: number;
}

interface UseICEliminationsReturn {
  data: ICEliminationsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useICEliminations(
  config: UseICEliminationsConfig,
  enabled: boolean = true
): UseICEliminationsReturn {
  const [data, setData] = useState<ICEliminationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (!enabled || !config.organizationId) return;

    const controller = new AbortController();
    const { signal } = controller;

    const params = new URLSearchParams({
      organizationId: config.organizationId,
      endYear: String(config.endYear),
      endMonth: String(config.endMonth),
    });

    setLoading(true);
    setError(null);

    fetch(`/api/intercompany-eliminations?${params.toString()}`, { signal })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody.error ?? `HTTP ${response.status}: ${response.statusText}`
          );
        }
        return response.json();
      })
      .then((result: ICEliminationsResponse) => {
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
    config.organizationId,
    config.endYear,
    config.endMonth,
    fetchCount,
  ]);

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return { data, loading, error, refetch };
}
