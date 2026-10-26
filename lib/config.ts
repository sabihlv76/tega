"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicConfigDTO } from "@/shared/types";
import { apiFetch } from "./api";

/** Public platform configuration (payment modes, support contacts, fare-cap policy). Cached for 5 minutes. */
export function usePublicConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => apiFetch<PublicConfigDTO>("/config"), staleTime: 300_000 });
}
