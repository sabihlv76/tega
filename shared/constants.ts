// Shared domain constants used by the web app, the API and tests.

export const BRAND_NAME = "FIKA";
export const CURRENCY = "RWF";
export const TIME_ZONE = "Africa/Kigali";
/** Rwanda (CAT) is UTC+2 all year round (no daylight saving). */
export const TZ_OFFSET_MINUTES = 120;

export const LOCALES = ["en", "rw", "fr", "sw"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "fika_locale";
export const LOCALE_LABELS: Record<Locale, { short: string; native: string }> = {
  en: { short: "EN", native: "English" },
  rw: { short: "RW", native: "Ikinyarwanda" },
  fr: { short: "FR", native: "Français" },
  sw: { short: "SW", native: "Kiswahili" },
};

export const ROLES = ["passenger", "operator", "station", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES: readonly Role[] = ["operator", "station", "admin"];

export const USER_STATUSES = ["active", "suspended", "invited"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const OPERATOR_STATUSES = ["pending", "approved", "suspended", "rejected"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export const VEHICLE_STATUSES = ["active", "maintenance", "retired"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const ROUTE_STATUSES = ["active", "paused"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const CAP_STATUSES = ["ok", "above_cap", "no_cap"] as const;
export type CapStatus = (typeof CAP_STATUSES)[number];

export const TRIP_STATUSES = ["scheduled", "boarding", "departed", "arrived", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** Status shown on departure boards (derived from trip status + delay). */
export const BOARD_STATUSES = ["on_time", "boarding", "delayed", "departed", "arrived", "cancelled"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const BOOKING_STATUSES = ["pending_payment", "confirmed", "cancelled", "expired", "completed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_METHODS = ["mtn", "airtel", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Payment state of a booking or parcel. */
export const PAYMENT_STATES = ["unpaid", "pending", "paid", "failed", "cash_due", "refunded"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Lifecycle of a single payment attempt. */
export const PAYMENT_STATUSES = ["initiated", "pending", "success", "failed", "refunded", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PARCEL_STATUSES = [
  "pending_payment",
  "awaiting_dropoff",
  "received",
  "loaded",
  "in_transit",
  "arrived",
  "collected",
  "cancelled",
  "expired",
] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const PARCEL_SIZES = ["small", "medium", "large"] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];
/** Maximum weight in kilograms accepted for each parcel size. */
export const PARCEL_SIZE_MAX_KG: Record<ParcelSize, number> = { small: 5, medium: 15, large: 30 };

export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const TICKET_SCAN_RESULTS = [
  "valid",
  "already_used",
  "invalid",
  "wrong_station",
  "wrong_day",
  "cancelled",
  "unpaid",
] as const;
export type TicketScanResult = (typeof TICKET_SCAN_RESULTS)[number];

export const FARE_CAP_ENFORCEMENT = ["warn", "block"] as const;
export type FareCapEnforcement = (typeof FARE_CAP_ENFORCEMENT)[number];

export const DOCUMENT_TYPES = [
  "rura_licence",
  "tax_clearance",
  "insurance",
  "roadworthiness",
  "rura_permit",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const TIME_OF_DAY = ["morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export const MAX_PLACES_PER_BOOKING = 6;

/** Platform defaults. Admins can change most of them at runtime (app settings). */
export const DEFAULT_SETTINGS = {
  commissionRate: 0.05,
  holdMinutes: 10,
  parcelHoldMinutes: 30,
  fareCapEnforcement: "warn" as FareCapEnforcement,
  defaultCancellationHours: 2,
  reminderMinutesBeforeDeparture: 60,
  payoutCycleDays: 7,
  channels: { sms: true, email: true, inApp: true },
  supportPhone: "+250 788 000 000",
  supportEmail: "support@fika.rw",
};
export type PlatformSettings = typeof DEFAULT_SETTINGS;

/** Rwandan mobile prefixes: MTN 078/079, Airtel 072/073. */
export const MOBILE_PREFIXES: Record<Exclude<PaymentMethod, "cash">, string[]> = {
  mtn: ["78", "79"],
  airtel: ["72", "73"],
};
