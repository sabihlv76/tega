"use client";

import { AlertTriangle } from "lucide-react";
import { Badge, Dot } from "@/components/ui/feedback";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/shared/money";
import { formatClock, formatDuration } from "@/shared/time";
import type { TripDTO } from "@/shared/types";

/** "06:30 ──● 09:00" with duration and stops, matching the FIKA results design. */
export function TimeRow({ trip, large = true, muted }: { trip: TripDTO; large?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", muted && "opacity-50")}>
      <span className={cn("font-bold tabular tracking-tight", large ? "text-3xl" : "text-xl")}>{formatClock(trip.departureAt)}</span>
      <span className="flex items-center" aria-hidden>
        <span className="h-px w-8 bg-faint" />
        <span className="size-2 rounded-full bg-ink" />
      </span>
      <span className={cn("font-bold tabular tracking-tight", large ? "text-3xl" : "text-xl")}>{formatClock(trip.arrivalAt)}</span>
    </div>
  );
}

export function viaLabel(trip: TripDTO, t: ReturnType<typeof useT>): string {
  return trip.via.length ? t("common.via", { stops: trip.via.map((v) => v.name).join(", ") }) : t("common.direct");
}

function placesTone(left: number): "success" | "warning" | "error" {
  if (left === 0) return "error";
  return left <= 5 ? "warning" : "success";
}

export function TripCard({ trip, travelers, onSelect }: { trip: TripDTO; travelers: number; onSelect: (trip: TripDTO) => void }) {
  const t = useT();
  const full = trip.placesLeft === 0;
  const notEnough = !full && trip.placesLeft < travelers;
  const disabled = full || notEnough || trip.status === "cancelled";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(trip)}
      className="w-full border-b border-line py-6 text-left transition-colors last:border-b-0 enabled:hover:bg-canvas/60 disabled:cursor-not-allowed"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("text-[15px] font-semibold", disabled && "text-faint")}>{trip.operator.name}</p>
            {trip.boardStatus === "boarding" ? <Badge tone="success">{t("search.boarding")}</Badge> : null}
            {trip.boardStatus === "delayed" ? <Badge tone="warning">{t("search.delayed", { minutes: trip.delayMinutes })}</Badge> : null}
          </div>
          <TimeRow trip={trip} muted={disabled} />
          <p className={cn("text-[15px]", disabled ? "text-faint" : "text-muted")}>
            {formatDuration(trip.durationMinutes)} · {viaLabel(trip, t)}
          </p>
          <div className="pt-1">
            {full ? (
              <Dot tone="error">{t("search.full")}</Dot>
            ) : notEnough ? (
              <Dot tone="warning">{t("search.notEnoughPlaces", { count: travelers })}</Dot>
            ) : (
              <Dot tone={placesTone(trip.placesLeft)}>{t("search.placesLeft", { count: trip.placesLeft })}</Dot>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-3xl font-bold tabular tracking-tight", disabled && "text-faint")}>{formatAmount(trip.priceRwf)}</p>
          <p className="text-[15px] text-faint">RWF</p>
          {trip.aboveCap ? (
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-warning-ink">
              <AlertTriangle className="size-3.5" aria-hidden />
              {t("search.aboveCap")}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
