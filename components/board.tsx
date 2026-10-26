"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BoltMark } from "@/components/brand";
import { StatusBadge } from "@/components/status";
import { PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent, useSocketRooms } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { formatClock } from "@/shared/time";
import type { BoardDTO } from "@/shared/types";

function useClock(everyMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useBoard(station: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["board", station],
    queryFn: () => apiFetch<BoardDTO>(`/board/${encodeURIComponent(station)}`),
    refetchInterval: 60_000,
    retry: 1,
  });
  const stationId = query.data?.station.id;
  useSocketRooms([stationId ? `board:${stationId}` : null]);
  useSocketEvent("board.updated", () => void queryClient.invalidateQueries({ queryKey: ["board", station] }), !!stationId);
  return query;
}

/**
 * Live departure board for one bus park. `dark` is the full-screen display for TVs at the station;
 * `light` sits inside the station desk.
 */
export function DepartureBoard({ station, variant = "dark" }: { station: string; variant?: "dark" | "light" }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const { data, isLoading, error } = useBoard(station);
  const dark = variant === "dark";

  if (isLoading) return <PageLoader />;
  if (error || !data) return <p className={cn("p-8 text-center", dark ? "text-neutral-400" : "text-muted")}>{t("common.somethingWrong")}</p>;

  return (
    <div className={cn(dark ? "text-white" : "text-ink")}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <BoltMark className={cn("size-12", dark && "bg-white text-ink")} />
          <div>
            <p className={cn("text-sm font-medium uppercase tracking-[0.2em]", dark ? "text-neutral-400" : "text-muted")}>
              {t("station.board.title")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{data.station.name}</h1>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular sm:text-5xl">{formatClock(now)}</p>
          <p className={cn("text-sm", dark ? "text-neutral-400" : "text-muted")}>
            {formatDate(now, locale, { weekday: "long", year: undefined })} · {t("station.board.remaining", { count: data.remaining })}
          </p>
        </div>
      </header>

      {data.items.length === 0 ? (
        <p className={cn("mt-16 text-center text-2xl", dark ? "text-neutral-400" : "text-muted")}>{t("station.board.noDepartures")}</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className={cn("text-sm uppercase tracking-wide", dark ? "text-neutral-400" : "text-muted")}>
                <th scope="col" className="pb-3 pr-4 font-medium">{t("station.board.time")}</th>
                <th scope="col" className="pb-3 pr-4 font-medium">{t("station.board.route")}</th>
                <th scope="col" className="pb-3 pr-4 font-medium">{t("station.board.operator")}</th>
                <th scope="col" className="pb-3 pr-4 font-medium">{t("station.board.bus")}</th>
                <th scope="col" className="pb-3 font-medium">{t("station.board.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const gone = item.status === "departed" || item.status === "cancelled";
                return (
                  <tr key={item.tripId} className={cn("border-t", dark ? "border-white/10" : "border-line", gone && "opacity-50")}>
                    <td className="py-4 pr-4 align-top">
                      <p className={cn("text-2xl font-bold tabular sm:text-3xl", item.status === "delayed" && (dark ? "text-amber-300" : "text-warning-ink"))}>
                        {formatClock(item.departureAt)}
                      </p>
                      {item.delayMinutes > 0 ? (
                        <p className={cn("text-sm line-through", dark ? "text-neutral-500" : "text-faint")}>{formatClock(item.scheduledAt)}</p>
                      ) : null}
                    </td>
                    <td className="py-4 pr-4 align-top">
                      <p className="text-xl font-semibold sm:text-2xl">{item.destination.name}</p>
                      {item.via.length ? (
                        <p className={cn("text-sm", dark ? "text-neutral-400" : "text-muted")}>
                          {t("common.via", { stops: item.via.map((v) => v.name).join(", ") })}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-4 pr-4 align-top text-lg">{item.operatorName}</td>
                    <td className="py-4 pr-4 align-top font-mono text-lg">{item.plateNumber}</td>
                    <td className="py-4 align-top">
                      <StatusBadge kind="board" status={item.status} className="px-2.5 py-1 text-sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
