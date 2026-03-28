"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { MeResponse, PortalUser } from "@/lib/types";

const SESSION_QUERY_KEY = ["customer-portal-session"];
const SESSION_STALE_TIME_MS = 5 * 60 * 1000;

async function fetchPortalSession() {
  const response = await fetch("/api/auth/me", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Unauthorized");
  }

  const data = (await response.json()) as MeResponse;
  return data.user;
}

export function usePortalSession() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<PortalUser>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchPortalSession,
    staleTime: SESSION_STALE_TIME_MS,
    retry: false,
  });

  const refreshMe = useCallback(async (force = true) => {
    await queryClient.fetchQuery({
      queryKey: SESSION_QUERY_KEY,
      queryFn: fetchPortalSession,
      staleTime: force ? 0 : SESSION_STALE_TIME_MS,
    });
  }, [queryClient]);

  useEffect(() => {
    if (sessionQuery.isError) {
      router.push("/");
    }
  }, [router, sessionQuery.isError]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.removeQueries({ queryKey: SESSION_QUERY_KEY });
    router.push("/");
  }

  return {
    me: sessionQuery.data ?? null,
    loading: sessionQuery.isLoading,
    refreshMe,
    logout,
  };
}
