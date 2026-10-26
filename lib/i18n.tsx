"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Locale, LOCALE_COOKIE } from "@/shared/constants";
import { createTranslator, type Messages, type Translator } from "@/shared/i18n";
import { setApiLocale } from "./api";

// Client-side i18n. The root layout passes the messages for the visitor's locale (from the cookie or
// Accept-Language); switching language loads the other catalog lazily and remembers the choice.

const loaders: Record<Locale, () => Promise<Messages>> = {
  en: () => import("@/shared/i18n/messages/en").then((m) => m.en),
  fr: () => import("@/shared/i18n/messages/fr").then((m) => m.fr),
  rw: () => import("@/shared/i18n/messages/rw").then((m) => m.rw),
  sw: () => import("@/shared/i18n/messages/sw").then((m) => m.sw),
};

let englishFallback: Messages | null = null;

interface I18nContextValue {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: Locale;
  initialMessages: Messages;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [messages, setMessages] = useState<Messages>(initialMessages);

  useEffect(() => {
    setApiLocale(locale);
    document.documentElement.lang = locale;
    if (locale !== "en" && !englishFallback) {
      void loaders.en().then((m) => {
        englishFallback = m;
      });
    }
  }, [locale]);

  const setLocale = useCallback(async (next: Locale) => {
    const loaded = await loaders[next]();
    setMessages(loaded);
    setLocaleState(next);
    setApiLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);

  const t = useMemo(
    () => createTranslator(locale, messages, englishFallback ?? (locale === "en" ? messages : undefined)),
    [locale, messages],
  );

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useT(): Translator {
  return useI18n().t;
}
