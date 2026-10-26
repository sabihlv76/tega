import { type Locale, TIME_ZONE } from "@/shared/constants";
import type { Translator } from "@/shared/i18n";

// Locale-aware display helpers. Everything is shown in Rwanda time regardless of device settings.

const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", rw: "rw-RW", sw: "sw-TZ" };

function intlLocale(locale: Locale): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([INTL_LOCALE[locale]]).length ? INTL_LOCALE[locale] : "en-GB";
  } catch {
    return "en-GB";
  }
}

export function formatDate(value: string | Date, locale: Locale, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(new Date(value));
}

export function formatDayLabel(dateStr: string, locale: Locale, t: Translator, today: string): string {
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (dateStr === today) return t("common.today");
  if (dateStr === tomorrow.toISOString().slice(0, 10)) return t("common.tomorrow");
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function weekdayShort(day: number, locale: Locale): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2023, 0, 1 + day, 12)),
  );
}

export function relativeTime(value: string | Date, t: Translator): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { count: hours });
  return t("common.daysAgo", { count: Math.round(hours / 24) });
}

export function chartLabel(label: string, locale: Locale): string {
  if (/^\d{4}-\d{2}$/.test(label)) {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", timeZone: "UTC" }).format(new Date(`${label}-15T12:00:00Z`));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${label}T12:00:00Z`),
    );
  }
  return label;
}
