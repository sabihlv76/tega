import { cookies, headers } from "next/headers";
import { DEFAULT_SETTINGS, LOCALE_COOKIE, type Locale } from "@/shared/constants";
import { isLocale, resolveLocale } from "@/shared/i18n";
import type { PublicConfigDTO } from "@/shared/types";

// Helpers for server components only (they read request cookies/headers).

const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** The visitor's language: saved choice first, then the browser's Accept-Language. */
export async function requestLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return resolveLocale((await headers()).get("accept-language"));
}

/** Support contacts from the API, falling back to the defaults when the API is unreachable. */
export async function supportContacts(): Promise<{ phone: string; email: string }> {
  try {
    const res = await fetch(`${API_URL}/api/v1/config`, { next: { revalidate: 300 } });
    if (res.ok) {
      const config = (await res.json()) as PublicConfigDTO;
      return { phone: config.supportPhone, email: config.supportEmail };
    }
  } catch {
    // Fall through to defaults.
  }
  return { phone: DEFAULT_SETTINGS.supportPhone, email: DEFAULT_SETTINGS.supportEmail };
}
