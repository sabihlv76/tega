"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GuestPrompt } from "@/components/passenger/guest";
import { PassengerShell } from "@/components/passenger/shell";
import { StatusBadge } from "@/components/status";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Chips } from "@/components/ui/segmented";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwf } from "@/shared/money";
import { formatClock } from "@/shared/time";
import type { BookingDTO } from "@/shared/types";

type Scope = "upcoming" | "past" | "cancelled";

export default function BookingsPage() {
  const { t, locale } = useI18n();
  const { status } = useAuth();
  const [scope, setScope] = useState<Scope>("upcoming");
  const { data, isLoading } = useQuery({
    queryKey: ["bookings", scope],
    queryFn: () => apiFetch<BookingDTO[]>("/bookings", { query: { scope } }),
    enabled: status === "authenticated",
  });

  return (
    <PassengerShell>
      <h1 className="mb-5 mt-4 text-3xl font-bold tracking-tight">{t("bookings.title")}</h1>
      {status === "anonymous" ? (
        <GuestPrompt />
      ) : (
        <>
          <Chips<Scope>
            label={t("bookings.title")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "upcoming", label: t("bookings.upcoming") },
              { value: "past", label: t("bookings.past") },
              { value: "cancelled", label: t("bookings.cancelled") },
            ]}
          />
          <div className="mt-5">
            {isLoading || status === "loading" ? (
              <div className="space-y-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : !data?.length ? (
              <EmptyState
                icon={<ReceiptText className="size-5" />}
                title={t("bookings.empty")}
                body={t("bookings.emptyHint")}
                action={<ButtonLink href="/">{t("bookings.bookTrip")}</ButtonLink>}
              />
            ) : (
              <ul className="space-y-3">
                {data.map((b) => (
                  <li key={b.id}>
                    <Link href={`/tickets/${b.reference}`} className="block rounded-2xl bg-canvas p-5 transition-colors hover:bg-subtle">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-muted">
                            {formatDate(b.trip.departureAt, locale, { weekday: "short" })} · {formatClock(b.trip.departureAt)}
                          </p>
                          <p className="mt-1 truncate text-lg font-semibold">
                            {b.trip.origin.name} → {b.trip.destination.name}
                          </p>
                          <p className="text-[15px] text-muted">
                            {b.trip.operator.name} · {t("common.places", { count: b.places })}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 size-5 shrink-0 text-faint" aria-hidden />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge kind="booking" status={b.status} />
                          {b.paymentStatus === "cash_due" ? <StatusBadge kind="payment" status="cash_due" /> : null}
                        </div>
                        <span className="font-semibold tabular">{formatRwf(b.totalAmount)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </PassengerShell>
  );
}
