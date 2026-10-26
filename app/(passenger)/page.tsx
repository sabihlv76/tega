"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpDown, CalendarDays, ChevronRight, Package, Search, Ticket, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, useLocations } from "@/components/location-picker";
import { PassengerShell, SectionLabel } from "@/components/passenger/shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Stepper } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDayLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MAX_PLACES_PER_BOOKING } from "@/shared/constants";
import { formatClock, formatDuration, kigaliDate } from "@/shared/time";
import type { BookingDTO, LocationLite, PopularRouteDTO } from "@/shared/types";

export default function HomePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { status } = useAuth();
  const today = kigaliDate();
  const { data: locations } = useLocations();

  const [from, setFrom] = useState<LocationLite | null>(null);
  const [to, setTo] = useState<LocationLite | null>(null);
  const [date, setDate] = useState(today);
  const [travelers, setTravelers] = useState(1);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [travelersOpen, setTravelersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default departure: Kigali (Nyabugogo), the busiest bus park.
  useEffect(() => {
    if (!from && locations?.length) {
      const kigali = locations.find((l) => l.slug === "kigali") ?? locations.find((l) => l.isStation);
      if (kigali) setFrom({ id: kigali.id, slug: kigali.slug, name: kigali.name });
    }
  }, [locations, from]);

  const popular = useQuery({ queryKey: ["popular"], queryFn: () => apiFetch<PopularRouteDTO[]>("/routes/popular") });
  const upcoming = useQuery({
    queryKey: ["bookings", "upcoming"],
    queryFn: () => apiFetch<BookingDTO[]>("/bookings", { query: { scope: "upcoming" } }),
    enabled: status === "authenticated",
  });
  const nextTrip = upcoming.data?.find((b) => b.status === "confirmed");

  const search = () => {
    if (!from || !to) return setError(t("home.chooseDestination"));
    if (from.id === to.id) return setError(t("home.sameLocation"));
    router.push(`/search?from=${from.slug}&to=${to.slug}&date=${date}&travelers=${travelers}`);
  };

  return (
    <PassengerShell>
      <h1 className="mb-6 mt-4 text-4xl font-bold tracking-tight">{t("home.whereTo")}</h1>

      {nextTrip ? (
        <Link
          href={`/tickets/${nextTrip.reference}`}
          className="mb-5 flex items-center gap-4 rounded-2xl bg-ink p-4 text-white transition-opacity hover:opacity-95"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <Ticket className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-neutral-300">{t("home.upcomingTrip")}</span>
            <span className="block truncate font-semibold">
              {nextTrip.trip.origin.name} → {nextTrip.trip.destination.name}
            </span>
            <span className="block text-sm text-neutral-300">
              {formatDayLabel(nextTrip.trip.departureAt.slice(0, 10), locale, t, today)} · {formatClock(nextTrip.trip.departureAt)}
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-neutral-400" aria-hidden />
        </Link>
      ) : null}

      <div className="relative rounded-2xl bg-canvas">
        <button type="button" onClick={() => setPicker("from")} className="flex w-full items-center gap-5 px-5 pb-4 pt-5 text-left">
          <span className="size-3.5 shrink-0 rounded-full border-[2.5px] border-ink" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("common.from")}</span>
            <span className={cn("block truncate text-lg", !from && "text-faint")}>{from?.name ?? t("home.selectOrigin")}</span>
          </span>
        </button>
        <div className="mx-5 h-px bg-line" />
        <button type="button" onClick={() => setPicker("to")} className="flex w-full items-center gap-5 px-5 pb-5 pt-4 text-left">
          <span className="size-3.5 shrink-0 rounded-full bg-ink" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("common.to")}</span>
            <span className={cn("block truncate text-lg", !to && "text-faint")}>{to?.name ?? t("home.selectDestination")}</span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t("home.swap")}
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
          className="absolute right-5 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-paper shadow-sm hover:bg-subtle"
        >
          <ArrowUpDown className="size-5" aria-hidden />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="relative flex cursor-pointer items-center gap-4 rounded-2xl bg-canvas px-5 py-4">
          <CalendarDays className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("common.date")}</span>
            <span className="block truncate text-lg">{formatDayLabel(date, locale, t, today)}</span>
          </span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label={t("home.pickDate")}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <button type="button" onClick={() => setTravelersOpen(true)} className="flex items-center gap-4 rounded-2xl bg-canvas px-5 py-4 text-left">
          <User className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("home.travelers")}</span>
            <span className="block truncate text-lg">{t("home.adults", { count: travelers })}</span>
          </span>
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-error-ink" role="alert">
          {error}
        </p>
      ) : null}

      <Button size="xl" block className="mt-6" onClick={search}>
        <Search aria-hidden />
        {t("home.searchTrips")}
      </Button>

      <section className="mt-10">
        <SectionLabel>{t("home.popularRoutes")}</SectionLabel>
        {popular.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <ul>
            {(popular.data ?? []).map((r) => (
              <li key={`${r.origin.id}-${r.destination.id}`} className="border-b border-line last:border-b-0">
                <Link
                  href={`/search?from=${r.origin.slug}&to=${r.destination.slug}&date=${today}&travelers=1`}
                  className="flex items-center gap-4 py-4"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-canvas">
                    <ArrowRight className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px]">
                      {r.origin.name} → {r.destination.name}
                    </span>
                    <span className="block text-[15px] text-faint">
                      {t("home.approxDuration", { duration: formatDuration(r.durationMinutes) })}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-line p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-canvas">
            <Package className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">{t("home.parcelsPromoTitle")}</h2>
            <p className="mt-0.5 text-sm text-muted">{t("home.parcelsPromoBody")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/parcels/send" className="text-sm font-semibold underline underline-offset-4">
                {t("parcels.sendTitle")}
              </Link>
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <Link href="/parcels/track" className="text-sm font-semibold underline underline-offset-4">
                {t("home.trackParcel")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <LocationPicker
        open={picker === "from"}
        onOpenChange={(open) => !open && setPicker(null)}
        title={t("home.selectOrigin")}
        exclude={to?.id}
        onSelect={(l) => {
          setFrom(l);
          setError(null);
        }}
      />
      <LocationPicker
        open={picker === "to"}
        onOpenChange={(open) => !open && setPicker(null)}
        title={t("home.selectDestination")}
        exclude={from?.id}
        onSelect={(l) => {
          setTo(l);
          setError(null);
        }}
      />
      <Dialog
        open={travelersOpen}
        onOpenChange={setTravelersOpen}
        title={t("home.travelers")}
        side="sheet"
        size="sm"
        footer={
          <Button block onClick={() => setTravelersOpen(false)}>
            {t("common.confirm")}
          </Button>
        }
      >
        <div className="flex items-center justify-between py-2">
          <span className="text-lg">{t("home.adults", { count: travelers })}</span>
          <Stepper
            value={travelers}
            onChange={setTravelers}
            max={MAX_PLACES_PER_BOOKING}
            decreaseLabel={t("booking.decrease")}
            increaseLabel={t("booking.increase")}
          />
        </div>
        <p className="text-sm text-muted">{t("booking.maxPlaces", { max: MAX_PLACES_PER_BOOKING })}</p>
      </Dialog>
    </PassengerShell>
  );
}
