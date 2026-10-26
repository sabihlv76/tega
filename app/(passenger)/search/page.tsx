"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BusFront } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useLocations } from "@/components/location-picker";
import { FlowHeader } from "@/components/passenger/shell";
import { TripCard } from "@/components/passenger/trip";
import { Button } from "@/components/ui/button";
import { EmptyState, PageLoader, Skeleton } from "@/components/ui/feedback";
import { Chips } from "@/components/ui/segmented";
import { apiFetch } from "@/lib/api";
import { formatDayLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent, useSocketRooms } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { TimeOfDay } from "@/shared/constants";
import { addDays, kigaliDate, timeOfDay } from "@/shared/time";
import type { TripDTO } from "@/shared/types";

type Filter = "all" | TimeOfDay;

function SearchResults() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const today = kigaliDate();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const date = params.get("date") ?? today;
  const travelers = Math.max(1, Number(params.get("travelers")) || 1);
  const [filter, setFilter] = useState<Filter>("all");
  const { data: locations } = useLocations();

  const name = (slug: string) => locations?.find((l) => l.slug === slug)?.name ?? slug;
  const key = ["trips", from, to, date];
  const trips = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TripDTO[]>("/trips/search", { query: { from, to, date } }),
    enabled: !!from && !!to,
    refetchInterval: 60_000,
  });

  // Live seat counts and delays while the passenger is choosing.
  useSocketRooms((trips.data ?? []).slice(0, 25).map((tr) => `trip:${tr.id}`));
  useSocketEvent<TripDTO>("trip.updated", (updated) => {
    queryClient.setQueryData<TripDTO[]>(key, (old) => old?.map((tr) => (tr.id === updated.id ? updated : tr)));
  });

  const visible = useMemo(
    () => (trips.data ?? []).filter((tr) => filter === "all" || timeOfDay(new Date(tr.departureAt)) === filter),
    [trips.data, filter],
  );

  const setDate = (next: string) => router.replace(`/search?from=${from}&to=${to}&date=${next}&travelers=${travelers}`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  return (
    <div className="min-h-dvh pb-16">
      <FlowHeader
        backHref="/"
        title={`${name(from)} → ${name(to)}`}
        subtitle={t("search.subtitle", {
          date: formatDayLabel(date, locale, t, today),
          travelers: t("home.adults", { count: travelers }),
        })}
      />
      <div className="space-y-3 border-b border-line px-6 py-4">
        <div className="flex gap-2 overflow-x-auto scrollbar-none" role="tablist" aria-label={t("common.date")}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === date}
              onClick={() => setDate(d)}
              className={cn(
                "shrink-0 rounded-card border px-3 py-1.5 text-sm font-medium",
                d === date ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink",
              )}
            >
              {formatDayLabel(d, locale, t, today)}
            </button>
          ))}
        </div>
        <Chips<Filter>
          label={t("common.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("search.all") },
            { value: "morning", label: t("search.morning") },
            { value: "afternoon", label: t("search.afternoon") },
            { value: "evening", label: t("search.evening") },
          ]}
        />
      </div>

      <main className="px-6">
        {trips.isLoading ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<BusFront className="size-5" />}
            title={t("search.noTrips")}
            body={t("search.noTripsHint")}
            action={
              <Button variant="outline" onClick={() => setDate(addDays(date, 1))}>
                {t("search.tryNextDay")}
              </Button>
            }
          />
        ) : (
          <div>
            {visible.map((trip) => (
              <TripCard key={trip.id} trip={trip} travelers={travelers} onSelect={(tr) => router.push(`/book/${tr.id}?travelers=${travelers}`)} />
            ))}
          </div>
        )}
      </main>

      {visible.length > 0 ? (
        <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-xl border-t border-line bg-paper py-4 text-center text-[15px] text-faint safe-bottom">
          {t("search.tripsFound", { count: visible.length })}
        </footer>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SearchResults />
    </Suspense>
  );
}
