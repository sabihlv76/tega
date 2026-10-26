"use client";

import { useT } from "@/lib/i18n";
import { Badge, type Tone } from "./ui/feedback";

// One place that maps every status in the product to a colour and a translated label.

const TONES: Record<string, Record<string, Tone>> = {
  booking: { pending_payment: "warning", confirmed: "success", cancelled: "error", expired: "neutral", completed: "neutral" },
  payment: { unpaid: "neutral", pending: "warning", paid: "success", failed: "error", cash_due: "warning", refunded: "neutral" },
  paymentAttempt: { initiated: "neutral", pending: "warning", success: "success", failed: "error", refunded: "neutral", cancelled: "neutral" },
  trip: { scheduled: "neutral", boarding: "success", departed: "dark", arrived: "neutral", cancelled: "error" },
  board: { on_time: "success", boarding: "success", delayed: "warning", departed: "neutral", arrived: "neutral", cancelled: "error" },
  operator: { pending: "warning", approved: "success", suspended: "error", rejected: "neutral" },
  payout: { pending: "warning", processing: "info", paid: "success", failed: "error" },
  role: { passenger: "neutral", operator: "info", station: "info", admin: "dark" },
  user: { active: "success", suspended: "error", invited: "warning" },
  route: { active: "success", paused: "neutral" },
  vehicle: { active: "success", maintenance: "warning", retired: "neutral" },
  cap: { ok: "success", above_cap: "warning", no_cap: "neutral" },
  parcel: {
    pending_payment: "warning",
    awaiting_dropoff: "warning",
    received: "info",
    loaded: "info",
    in_transit: "info",
    arrived: "success",
    collected: "neutral",
    cancelled: "error",
    expired: "neutral",
  },
};

export type StatusKind = keyof typeof TONES;

export function statusTone(kind: StatusKind, status: string): Tone {
  return TONES[kind]?.[status] ?? "neutral";
}

export function StatusBadge({ kind, status, className }: { kind: StatusKind; status: string; className?: string }) {
  const t = useT();
  const label =
    kind === "parcel"
      ? t(`parcels.status.${status}`)
      : kind === "vehicle"
        ? t(`operator.vehicles.status.${status}`)
        : t(`statuses.${kind}.${status}`);
  return (
    <Badge tone={statusTone(kind, status)} className={className}>
      {label}
    </Badge>
  );
}
