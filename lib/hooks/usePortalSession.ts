"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MeResponse, PortalUser } from "@/lib/types";

export function usePortalSession() {
  const router = useRouter();
  const [me, setMe] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe() {
    const response = await fetch("/api/auth/me", { cache: "no-store" });

    if (!response.ok) {
      router.push("/");
      return;
    }

    const data = (await response.json()) as MeResponse;
    setMe(data.user);
    setLoading(false);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    me,
    loading,
    refreshMe,
    logout,
  };
}
