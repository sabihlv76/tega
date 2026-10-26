import { TIME_ZONE, TZ_OFFSET_MINUTES, type TimeOfDay } from "./constants";

// All schedules and "today" calculations use Rwanda local time (UTC+2, no DST),
// regardless of the timezone the server or the browser runs in.

const OFFSET_MS = TZ_OFFSET_MINUTES * 60_000;

/** Calendar date (YYYY-MM-DD) in Kigali for an instant. */
export function kigaliDate(date: Date = new Date()): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since midnight (Kigali) for an instant. */
export function kigaliMinutes(date: Date): number {
  const d = new Date(date.getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Day of week in Kigali (0 = Sunday … 6 = Saturday). */
export function kigaliWeekday(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Instant for a Kigali calendar date and "HH:mm" local time. */
export function kigaliDateTime(dateStr: string, time: string): Date {
  return new Date(`${dateStr}T${time.padStart(5, "0")}:00+02:00`);
}

/** [start, end) instants covering a Kigali calendar day. */
export function kigaliDayRange(dateStr: string): { start: Date; end: Date } {
  const start = kigaliDateTime(dateStr, "00:00");
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

export function isValidTimeString(value: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

export function timeOfDay(date: Date): TimeOfDay {
  const minutes = kigaliMinutes(date);
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}

/** "06:30" style clock time in Kigali. */
export function formatClock(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** "2h 30min" from minutes. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
