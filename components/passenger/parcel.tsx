"use client";

import { Check } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ParcelStatus } from "@/shared/constants";
import type { ParcelDTO } from "@/shared/types";

const FLOW: ParcelStatus[] = ["awaiting_dropoff", "received", "loaded", "in_transit", "arrived", "collected"];

/** Step-by-step tracking timeline (drop-off → station → bus → in transit → arrived → collected). */
export function ParcelTimeline({ parcel }: { parcel: ParcelDTO }) {
  const { t, locale } = useI18n();
  if (parcel.status === "cancelled" || parcel.status === "expired" || parcel.status === "pending_payment") {
    return <p className="text-[15px] text-muted">{t(`parcels.status.${parcel.status}`)}</p>;
  }
  const currentIndex = FLOW.indexOf(parcel.status);
  const eventFor = (s: ParcelStatus) => [...parcel.events].reverse().find((e) => e.status === s);
  return (
    <ol className="relative">
      {FLOW.map((s, i) => {
        const done = i <= currentIndex;
        const current = i === currentIndex;
        const event = eventFor(s);
        const label =
          s === "awaiting_dropoff"
            ? t("parcels.dropOffAt", { station: parcel.origin.name })
            : s === "loaded" && parcel.trip
              ? `${t("parcels.status.loaded")} · ${parcel.trip.plateNumber}`
              : t(`parcels.status.${s}`);
        return (
          <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
            {i < FLOW.length - 1 ? (
              <span className={cn("absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5", i < currentIndex ? "bg-ink" : "bg-line")} aria-hidden />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                done ? "border-ink bg-ink text-white" : "border-line bg-paper",
                current && "ring-4 ring-black/10",
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-[15px]", done ? "font-semibold text-ink" : "text-faint")}>{label}</p>
              {event ? (
                <p className="text-sm text-muted">
                  {formatDateTime(event.at, locale)}
                  {event.station ? ` · ${event.station.name}` : ""}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
