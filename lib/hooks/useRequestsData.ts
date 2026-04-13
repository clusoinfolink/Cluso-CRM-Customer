"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RequestItem } from "@/lib/types";

type RequestPayload = {
  items: RequestItem[];
};

const REQUESTS_QUERY_KEY = ["customer-requests"];
const REQUESTS_STALE_TIME_MS = 5 * 60 * 1000;

type UseRequestsDataOptions = {
  enabled?: boolean;
};

async function fetchRequests() {
  const response = await fetch("/api/orders", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load requests.");
  }

  const data = (await response.json()) as RequestPayload;
  return data.items ?? [];
}

export function useRequestsData(options: UseRequestsDataOptions = {}) {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const requestsQuery = useQuery<RequestItem[]>({
    queryKey: REQUESTS_QUERY_KEY,
    queryFn: fetchRequests,
    staleTime: REQUESTS_STALE_TIME_MS,
    enabled,
  });

  const refreshRequests = useCallback(async (force = true) => {
    if (!enabled) {
      return;
    }

    await queryClient.fetchQuery({
      queryKey: REQUESTS_QUERY_KEY,
      queryFn: fetchRequests,
      staleTime: force ? 0 : REQUESTS_STALE_TIME_MS,
    });
  }, [enabled, queryClient]);

  return {
    items: enabled ? requestsQuery.data ?? [] : [],
    loading: enabled ? requestsQuery.isLoading : false,
    refreshRequests,
  };
}
