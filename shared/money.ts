import { type CapStatus, CURRENCY, MOBILE_PREFIXES, type PaymentMethod } from "./constants";

// Business rules for prices, fees and fare caps. Kept framework-free so they are unit-tested
// and identical on the API (source of truth) and in the web app (display only).

/** "3,500" grouping used across the product. */
export function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString("en-US");
}

/** "3,500 RWF" */
export function formatRwf(amount: number): string {
  return `${formatAmount(amount)} ${CURRENCY}`;
}

/** "RWF 842K" style compact figure for dashboards. */
export function formatRwfCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${CURRENCY} ${trim(amount / 1_000_000)}M`;
  if (abs >= 10_000) return `${CURRENCY} ${trim(amount / 1_000)}K`;
  return `${CURRENCY} ${formatAmount(amount)}`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function bookingTotal(unitPrice: number, places: number): number {
  return Math.round(unitPrice) * places;
}

/** Platform commission on a gross amount (rounded to the nearest franc). */
export function commissionOf(amount: number, rate: number): number {
  if (rate < 0 || rate > 1) throw new RangeError("Commission rate must be between 0 and 1");
  return Math.round(amount * rate);
}

/** Compare an operator price with the regulated RURA cap. */
export function capStatusFor(priceRwf: number, capRwf: number | null | undefined): CapStatus {
  if (capRwf == null) return "no_cap";
  return priceRwf > capRwf ? "above_cap" : "ok";
}

/** Parcel price: per-kg rate on the (minimum 1 kg) weight, never below the operator minimum, rounded up to 50. */
export function parcelPrice(weightKg: number, perKg: number, minimum: number): number {
  const chargeable = Math.max(1, Math.ceil(weightKg * 2) / 2);
  const raw = Math.max(minimum, chargeable * perKg);
  return Math.ceil(raw / 50) * 50;
}

/**
 * Normalises a Rwandan mobile number to E.164 (+2507XXXXXXXX).
 * Accepts 07XXXXXXXX, 7XXXXXXXX, 2507XXXXXXXX and +2507XXXXXXXX (spaces/dashes ignored).
 */
export function normalizeRwPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  let local: string | null = null;
  if (/^\+2507\d{8}$/.test(digits)) local = digits.slice(4);
  else if (/^2507\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^07\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^7\d{8}$/.test(digits)) local = digits;
  return local ? `+250${local}` : null;
}

/** Which mobile money network a Rwandan number belongs to. */
export function networkOf(phoneE164: string): "mtn" | "airtel" | null {
  const prefix = phoneE164.replace("+250", "").slice(0, 2);
  if (MOBILE_PREFIXES.mtn.includes(prefix)) return "mtn";
  if (MOBILE_PREFIXES.airtel.includes(prefix)) return "airtel";
  return null;
}

export function phoneMatchesMethod(phoneE164: string, method: PaymentMethod): boolean {
  if (method === "cash") return true;
  return networkOf(phoneE164) === method;
}

/** "+250 788 123 456" */
export function formatPhone(phoneE164: string | null | undefined): string {
  if (!phoneE164) return "";
  const m = /^\+250(\d{3})(\d{3})(\d{3})$/.exec(phoneE164);
  return m ? `+250 ${m[1]} ${m[2]} ${m[3]}` : phoneE164;
}

/** Percentage change, rounded, or null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
