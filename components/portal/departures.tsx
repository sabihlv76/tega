"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/feedback";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatClock } from "@/shared/time";
import type { StationTripDTO } from "@/shared/types";

/** Departure row used on operator and station dashboards (time tile · route · bus · places). */
export function DepartureRow({
  trip,
  href,
  highlight,
  showOperator,
}: {
  trip: StationTripDTO;
  href?: string;
  highlight?: boolean;
  showOperator?: boolean;
}) {
  const t = useT();
  const full = trip.booked >= trip.seatsTotal;
  const content = (
    <div
      className={cn(
        "flex items-center gap-4 rounded-card p-3 transition-colors",
        highlight ? "bg-ink text-white" : "bg-canvas hover:bg-subtle",
      )}
    >
      <span
        className={cn(
          "flex h-14 w-16 shrink-0 items-center justify-center rounded-card text-lg font-bold tabular",
          highlight ? "bg-white text-ink" : "bg-ink text-white",
        )}
      >
        {formatClock(trip.departureAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {trip.origin.name} → {trip.destination.name}
        </p>
        <p className={cn("truncate text-sm", highlight ? "text-neutral-300" : "text-muted")}>
          {showOperator ? `${trip.operator.name} · ` : ""}
          {t("common.bus")} {trip.plateNumber} · {t("operator.dashboard.placesBooked", { booked: trip.booked, total: trip.seatsTotal })}
        </p>
      </div>
      {full && trip.boardStatus === "on_time" ? (
        <Badge tone="dark" className={highlight ? "bg-white text-ink" : undefined}>
          {t("search.full")}
        </Badge>
      ) : (
        <StatusBadge kind="board" status={trip.boardStatus} />
      )}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
