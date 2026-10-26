"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, LogIn } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FlowHeader, SectionLabel, StickyAction } from "@/components/passenger/shell";
import { viaLabel } from "@/components/passenger/trip";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dot, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Stepper } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { MAX_PLACES_PER_BOOKING } from "@/shared/constants";
import { formatRwf, normalizeRwPhone } from "@/shared/money";
import { formatClock, formatDuration } from "@/shared/time";
import type { BookingDTO, TripDTO } from "@/shared/types";

function InlineField({
  label,
  children,
  htmlFor,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5">
      <label htmlFor={htmlFor} className="block text-sm text-faint">
        {label}
      </label>
      {children}
    </div>
  );
}

const inlineInput =
  "mt-0.5 w-full bg-transparent text-[17px] text-ink placeholder:text-faint focus:outline-none aria-[invalid=true]:text-error-ink";

function ReviewBooking() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { tripId } = useParams<{ tripId: string }>();
  const params = useSearchParams();
  const { user, status } = useAuth();

  const trip = useQuery({ queryKey: ["trip", tripId], queryFn: () => apiFetch<TripDTO>(`/trips/${tripId}`) });
  const [places, setPlaces] = useState(Math.max(1, Number(params.get("travelers")) || 1));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName((v) => v || user.name || "");
      setPhone((v) => v || (user.phone ? user.phone.replace("+250", "0") : ""));
      setEmail((v) => v || user.email || "");
    }
  }, [user]);

  const book = useMutation({
    mutationFn: () =>
      apiFetch<BookingDTO>("/bookings", {
        method: "POST",
        body: { tripId, places, traveler: { name: name.trim(), phone, email: email.trim() || null } },
      }),
    onSuccess: (booking) => router.push(`/pay/booking/${booking.id}`),
  });

  if (trip.isLoading) return <PageLoader />;
  if (!trip.data) {
    return (
      <>
        <FlowHeader title={t("booking.title")} />
        <EmptyState
          title={t("booking.tripUnavailable")}
          action={<ButtonLink href="/">{t("booking.bookAnother")}</ButtonLink>}
        />
      </>
    );
  }
  const tr = trip.data;
  const maxPlaces = Math.max(1, Math.min(MAX_PLACES_PER_BOOKING, tr.placesLeft));
  const total = tr.priceRwf * places;

  const submit = () => {
    setFieldError(null);
    if (name.trim().length < 2) return setFieldError("name");
    if (!normalizeRwPhone(phone)) return setFieldError("phone");
    book.mutate();
  };

  return (
    <div className="min-h-dvh pb-32">
      <FlowHeader title={t("booking.title")} />
      <main className="space-y-8 px-6 py-6">
        <section className="rounded-2xl bg-canvas p-6">
          <p className="font-semibold">{tr.operator.name}</p>
          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-bold tabular">{formatClock(tr.departureAt)}</p>
              <p className="text-[15px] text-muted">{tr.origin.name}</p>
            </div>
            <div className="flex flex-1 flex-col items-center pt-2 text-sm text-faint">
              <span>{formatDuration(tr.durationMinutes)}</span>
              <span className="my-1 h-px w-full bg-faint" aria-hidden />
              <span>{viaLabel(tr, t)}</span>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tabular">{formatClock(tr.arrivalAt)}</p>
              <p className="text-[15px] text-muted">{tr.destination.name}</p>
            </div>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[15px] text-muted">
            <CalendarDays className="size-5" aria-hidden />
            {formatDate(tr.departureAt, locale, { weekday: "short" })}
          </p>
        </section>

        {status === "anonymous" ? (
          <section className="rounded-2xl border border-line p-6 text-center">
            <LogIn className="mx-auto size-8 text-muted" aria-hidden />
            <p className="mt-3 font-semibold">{t("auth.signInToBook")}</p>
            <ButtonLink
              href={`/auth/login?next=${encodeURIComponent(`/book/${tripId}?travelers=${places}`)}`}
              className="mt-4"
              size="lg"
            >
              {t("common.signIn")}
            </ButtonLink>
          </section>
        ) : (
          <>
            <section>
              <SectionLabel>{t("booking.travelerDetails")}</SectionLabel>
              <div className="divide-y divide-line rounded-2xl bg-canvas">
                <InlineField label={t("booking.fullName")} htmlFor="traveler-name">
                  <input
                    id="traveler-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder={t("auth.namePlaceholder")}
                    aria-invalid={fieldError === "name"}
                    className={inlineInput}
                  />
                </InlineField>
                <InlineField label={t("booking.phone")} htmlFor="traveler-phone">
                  <input
                    id="traveler-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="078 812 3456"
                    aria-invalid={fieldError === "phone"}
                    className={inlineInput}
                  />
                  {fieldError === "phone" ? <p className="mt-1 text-sm text-error-ink">{t("errors.PHONE_INVALID")}</p> : null}
                </InlineField>
                <InlineField label={t("booking.email")} htmlFor="traveler-email">
                  <input
                    id="traveler-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inlineInput}
                  />
                </InlineField>
              </div>
            </section>

            <section>
              <SectionLabel>{t("booking.places")}</SectionLabel>
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-canvas px-5 py-4">
                <div>
                  <p className="text-[17px]">{t("common.places", { count: places })}</p>
                  <Dot tone={tr.placesLeft <= 5 ? "warning" : "success"}>{t("booking.available", { count: tr.placesLeft })}</Dot>
                </div>
                <Stepper
                  value={places}
                  onChange={setPlaces}
                  max={maxPlaces}
                  decreaseLabel={t("booking.decrease")}
                  increaseLabel={t("booking.increase")}
                />
              </div>
            </section>
          </>
        )}

        <section>
          <SectionLabel>{t("booking.price")}</SectionLabel>
          <div className="flex items-center justify-between border-b border-line pb-3 text-[17px] text-muted">
            <span>{t("booking.ticketLine", { count: places })}</span>
            <span className="tabular text-ink">{formatRwf(tr.priceRwf * places)}</span>
          </div>
          <div className="flex items-center justify-between pt-3">
            <span className="text-xl font-bold">{t("booking.total")}</span>
            <span className="text-2xl font-bold tabular">{formatRwf(total)}</span>
          </div>
        </section>

        {book.error ? (
          <p className="text-sm text-error-ink" role="alert">
            {errorMessage(book.error, t)}
          </p>
        ) : null}
      </main>

      {status !== "anonymous" ? (
        <StickyAction>
          <Button size="xl" block onClick={submit} loading={book.isPending} disabled={tr.placesLeft === 0}>
            {t("booking.continueToPayment")}
          </Button>
        </StickyAction>
      ) : null}
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ReviewBooking />
    </Suspense>
  );
}
