"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Role } from "@/shared/constants";
import type { AuthResponse, UserDTO } from "@/shared/types";
import { apiFetch, refreshSession, setAccessToken } from "./api";
import { useI18n } from "./i18n";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: UserDTO | null;
  status: Status;
  signIn: (response: AuthResponse) => void;
  signOut: () => Promise<void>;
  setUser: (user: UserDTO) => void;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const REFRESH_EVERY_MS = 12 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const { locale, setLocale } = useI18n();
  const queryClient = useQueryClient();

  const applyUser = useCallback(
    (next: UserDTO | null) => {
      setUserState(next);
      setStatus(next ? "authenticated" : "anonymous");
      if (next && next.language !== locale) void setLocale(next.language);
    },
    [locale, setLocale],
  );

  const reload = useCallback(async () => {
    const session = await refreshSession();
    applyUser(session?.user ?? null);
  }, [applyUser]);

  // Restore the session from the refresh cookie on first load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    void reload();
  }, []);

  // Keep the short-lived access token fresh while the app is open.
  useEffect(() => {
    if (status !== "authenticated") return;
    const timer = setInterval(() => void refreshSession(), REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [status]);

  const signIn = useCallback(
    (response: AuthResponse) => {
      setAccessToken(response.accessToken);
      applyUser(response.user);
    },
    [applyUser],
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST", retry: false });
    } finally {
      setAccessToken(null);
      queryClient.clear();
      applyUser(null);
    }
  }, [applyUser, queryClient]);

  const value = useMemo(
    () => ({ user, status, signIn, signOut, setUser: (u: UserDTO) => applyUser(u), reload }),
    [user, status, signIn, signOut, applyUser, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/**
 * Sends anonymous visitors to sign in (returning here afterwards). When `roles` is given, users
 * without one of them get `allowed: false` so the page can show a "no access" state. The API
 * enforces the same rules; this only drives navigation.
 */
export function useRequireAuth(roles?: Role[]): { ready: boolean; allowed: boolean; user: UserDTO | null } {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (status === "anonymous") {
      const next = typeof window !== "undefined" ? `${pathname}${window.location.search}` : pathname;
      router.replace(`/auth/login?next=${encodeURIComponent(next)}`);
    }
  }, [status, router, pathname]);
  const allowed = !!user && (!roles || roles.includes(user.role));
  return { ready: status === "authenticated", allowed, user };
}
