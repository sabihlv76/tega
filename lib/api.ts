"use client";

import type { AuthResponse } from "@/shared/types";

// Browser API client. Requests go to same-origin /api/v1 (proxied by Next to the Express API).
// The short-lived access token lives in memory; the refresh token is an httpOnly cookie that only
// /api/v1/auth can read, so a reload silently restores the session via refreshSession().

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field reported by the API for validation-style errors. */
  get field(): string | undefined {
    const d = this.details as { field?: string } | undefined;
    return d?.field;
  }
}

let accessToken: string | null = null;
let locale = "en";
const tokenListeners = new Set<(token: string | null) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of tokenListeners) listener(token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export function setApiLocale(next: string): void {
  locale = next;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
  /** Retry once after refreshing an expired access token (default true). */
  retry?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return `/api/v1${path}${s ? `?${s}` : ""}`;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    return new ApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? res.statusText, res.status, body.error?.details);
  } catch {
    return new ApiError(res.status === 404 ? "NOT_FOUND" : "INTERNAL", res.statusText, res.status);
  }
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { "x-fika-locale": locale };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("NETWORK", "Network error", 0);
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, options);
  if (res.status === 401 && options.retry !== false && !path.startsWith("/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawRequest(path, options);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

let refreshing: Promise<AuthResponse | null> | null = null;

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await rawRequest("/auth/refresh", { method: "POST" });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      return data;
    } catch {
      return null;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

/** Downloads a protected file (CSV export, uploaded document) with the current credentials. */
export async function downloadFile(path: string, filename: string, query?: Query): Promise<void> {
  let res = await rawRequest(path, { query });
  if (res.status === 401 && (await refreshSession())) res = await rawRequest(path, { query });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens a protected document in a new tab. */
export async function openProtectedFile(fileId: string): Promise<void> {
  const tab = window.open("", "_blank");
  let res = await rawRequest(`/files/${fileId}`, {});
  if (res.status === 401 && (await refreshSession())) res = await rawRequest(`/files/${fileId}`, {});
  if (!res.ok) {
    tab?.close();
    throw await parseError(res);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
}
