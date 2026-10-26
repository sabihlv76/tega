"use client";

import { Check, Globe } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type Locale, LOCALE_LABELS, LOCALES } from "@/shared/constants";
import type { UserDTO } from "@/shared/types";
import { Menu, MenuItem, MenuLabel } from "./ui/menu";

export function LanguageSwitcher({ variant = "pill" }: { variant?: "pill" | "dark" }) {
  const { locale, setLocale, t } = useI18n();
  const { user, setUser } = useAuth();

  const choose = async (next: Locale) => {
    await setLocale(next);
    if (user) {
      try {
        setUser(await apiFetch<UserDTO>("/me", { method: "PATCH", body: { language: next } }));
      } catch {
        // The choice still applies on this device.
      }
    }
  };

  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={t("common.language")}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors",
            variant === "pill" ? "bg-subtle text-ink hover:bg-neutral-200" : "bg-white/10 text-white hover:bg-white/20",
          )}
        >
          <Globe className="size-4" aria-hidden />
          {LOCALE_LABELS[locale].short}
        </button>
      }
    >
      <MenuLabel>{t("common.language")}</MenuLabel>
      {LOCALES.map((l) => (
        <MenuItem key={l} onSelect={() => void choose(l)} icon={l === locale ? <Check aria-hidden /> : <span className="size-4" />}>
          <span lang={l}>{LOCALE_LABELS[l].native}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
