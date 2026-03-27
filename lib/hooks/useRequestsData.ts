"use client";

import { useCallback, useState } from "react";
import { RequestItem } from "@/lib/types";

type RequestPayload = {
  items: RequestItem[];
};

export function useRequestsData() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshRequests = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/orders", { cache: "no-store" });
    if (!response.ok) {
      setLoading(false);
      return;
    }

    const data = (await response.json()) as RequestPayload;
    setItems(data.items);
    setLoading(false);
  }, []);

  return {
    items,
    loading,
    refreshRequests,
  };
}
