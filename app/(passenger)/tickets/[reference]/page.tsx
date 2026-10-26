"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, ExternalLink, Info, Radio, X } from "lucide-react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { FlowHeader } from "@/components/passenger/shell";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent, useSocketRooms } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { formatPhone, formatRwf } from "@/shared/money";
import { formatClock, formatDuration } from "@/shared/time";
import type { BookingDTO, PaymentDTO, TripDTO } from "@/shared/types";

type TicketData = { booking: BookingDTO; payment: PaymentDTO | null };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 truncate text-[17px]">{children}</p>
    </div>
  );
}

function Ticket() {
  const { t, locale } = useI18n();
  const { reference } = useParams<{ reference: string }>();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const key = ["ticket", reference];
  const { data, isLoading, refetch } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TicketData>(`/bookings/${reference}`),
  });

  useSocketRooms(data ? [`trip:${data.booking.trip.id}`] : []);
  useSocketEvent<TripDTO>("trip.updated", (trip) => {
    queryClient.setQueryData<TicketData>(key, (old) =>
      old && old.booking.trip.id === trip.id ? { ...old, booking: { ...old.booking, trip } } : old,
    );
  });
  useSocketEvent<BookingDTO>("booking.updated", (b) => {
    if (b.reference === reference) void refetch();
  });

  const cancel = useMutation({
    mutationFn: () => apiFetch<BookingDTO>(`/bookings/${data?.booking.id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("ticket.cancelledToast"));
      setConfirmCancel(false);
      void refetch();
    },
    onError: (err) => toastError(err, t),
  });

  if (isLoading) return <PageLoader />;
  if (!data) {
    return (
      <>
        <FlowHeader title={t("ticket.title")} backHref="/bookings" />
        <EmptyState title={t("errors.NOT_FOUND")} action={<ButtonLink href="/bookings">{t("bookings.title")}</ButtonLink>} />
      </>
    );
  }

  const b = data.booking;
  const trip = b.trip;
  const cashDue = b.paymentStatus === "cash_due";
  const banner =
    b.status === "confirmed"
      ? { tone: "ok", text: cashDue ? t("ticket.cashDue") : t("ticket.confirmed") }
      : b.status === "pending_payment"
        ? { tone: "wait", text: t("ticket.pendingPayment") }
        : b.status === "completed"
          ? { tone: "ok", text: t("ticket.completed") }
          : { tone: "bad", text: b.status === "expired" ? t("ticket.expired") : t("ticket.cancelled") };

  const share = async () => {
    const text = t("ticket.shareText", {
      reference: b.reference,
      from: trip.origin.name,
      to: trip.destination.name,
      date: formatDate(trip.departureAt, locale),
      time: formatClock(trip.departureAt),
    });
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "FIKA", text, url });
        return;
      } catch {
        // fall through to copy
      }
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast.success(t("common.copied"));
  };

  return (
    <div className="min-h-dvh bg-[#f4f4f4] pb-10">
      <FlowHeader title={t("ticket.title")} backHref="/bookings" className="border-none bg-[#f4f4f4]/95" />
      <main className="px-6">
        <p className="flex items-center justify-center gap-3 py-4 text-lg font-semibold" role="status">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-white",
              banner.tone === "ok" ? "bg-ink" : banner.tone === "wait" ? "bg-warning-ink" : "bg-error-ink",
            )}
            aria-hidden
          >
            {banner.tone === "ok" ? <Check className="size-5" /> : banner.tone === "wait" ? <Clock className="size-5" /> : <X className="size-5" />}
          </span>
          {banner.text}
        </p>

        <article className="relative overflow-hidden rounded-3xl bg-paper">
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-4xl font-bold tabular">{formatClock(trip.departureAt)}</p>
                <p className="text-[15px] text-muted">{trip.origin.name}</p>
              </div>
              <div className="flex flex-1 flex-col items-center pt-3 text-sm text-faint">
                <span>{formatDuration(trip.durationMinutes)}</span>
                <span className="mt-1 flex w-full items-center" aria-hidden>
                  <span className="size-2.5 rounded-full border-2 border-ink" />
                  <span className="h-px flex-1 bg-faint" />
                  <span className="size-2.5 rounded-full bg-ink" />
                </span>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold tabular">{formatClock(trip.arrivalAt)}</p>
                <p className="text-[15px] text-muted">{trip.destination.name}</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
              <Detail label={t("common.date")}>{formatDate(trip.departureAt, locale)}</Detail>
              <Detail label={t("common.operator")}>{trip.operator.name}</Detail>
              <Detail label={t("ticket.traveler")}>{b.traveler.name}</Detail>
              <Detail label={cashDue ? t("ticket.due") : t("ticket.paid")}>
                <span className="font-semibold">{formatRwf(b.totalAmount)}</span>
              </Detail>
              <Detail label={t("booking.places")}>{t("common.places", { count: b.places })}</Detail>
              <Detail label={t("common.bus")}>{trip.vehicle.plateNumber}</Detail>
            </div>
          </div>

          <div className="relative flex items-center" aria-hidden>
            <span className="-ml-4 size-8 rounded-full bg-[#f4f4f4]" />
            <span className="mx-2 flex-1 border-t-2 border-dashed border-line" />
            <span className="-mr-4 size-8 rounded-full bg-[#f4f4f4]" />
          </div>

          <div className="flex flex-col items-center px-6 pb-8 pt-4">
            {b.qrToken ? (
              <div className="rounded-2xl bg-ink p-5">
                <QRCodeSVG value={b.qrToken} size={176} bgColor="#000000" fgColor="#ffffff" level="M" title={b.reference} />
              </div>
            ) : (
              <div className="flex size-[216px] items-center justify-center rounded-2xl bg-subtle text-center text-sm text-muted">
                {banner.text}
              </div>
            )}
            <p className="mt-4 text-xl font-bold tracking-[0.2em]">{b.reference}</p>
            <p className="text-[15px] text-faint">{t("ticket.showAtStation")}</p>
            {b.checkedInAt ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-success-ink">
                <Check className="size-4" aria-hidden />
                {t("ticket.checkedIn", { time: formatClock(b.checkedInAt) })}
              </p>
            ) : null}
          </div>
        </article>

        <div className="mt-4 space-y-3">
          {b.status === "confirmed" || b.status === "completed" ? (
            <Button variant="inverse" size="xl" block onClick={() => void share()} className="rounded-2xl">
              <ExternalLink aria-hidden />
              {t("ticket.share")}
            </Button>
          ) : null}
          {b.status === "pending_payment" ? (
            <ButtonLink href={`/pay/booking/${b.id}`} size="xl" block>
              {t("ticket.completePayment")}
            </ButtonLink>
          ) : null}
          {cashDue ? (
            <Alert tone="warning" title={t("ticket.payAtStation", { amount: formatRwf(b.totalAmount) })} />
          ) : null}

          {b.status === "confirmed" ? (
            <section className="rounded-2xl bg-paper p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-faint">
                <Radio className="size-4" aria-hidden />
                {t("ticket.liveStatus")}
              </h2>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[17px]">
                  {trip.operator.name} · {trip.vehicle.plateNumber}
                </span>
                <StatusBadge kind="board" status={trip.boardStatus} />
              </div>
              {trip.delayMinutes > 0 ? (
                <p className="mt-1 text-sm text-warning-ink">{t("search.delayed", { minutes: trip.delayMinutes })}</p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl bg-paper p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">{t("ticket.receipt")}</h2>
            <div className="mt-3 space-y-2 text-[15px]">
              <div className="flex justify-between text-muted">
                <span>{t("ticket.receiptLine", { count: b.places, price: formatRwf(b.unitPrice) })}</span>
                <span className="tabular text-ink">{formatRwf(b.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{t("payment.method")}</span>
                <span className="text-ink">{b.paymentMethod ? t(`statuses.method.${b.paymentMethod}`) : "—"}</span>
              </div>
              {data.payment?.phone ? (
                <div className="flex justify-between text-muted">
                  <span>{t("common.phone")}</span>
                  <span className="text-ink">{formatPhone(data.payment.phone)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-muted">
                <span>{t("common.status")}</span>
                <StatusBadge kind="payment" status={b.paymentStatus} />
              </div>
              <p className="pt-1 text-sm text-faint">{t("ticket.bookedOn", { date: formatDate(b.createdAt, locale) })}</p>
            </div>
          </section>

          {b.status === "confirmed" || b.status === "pending_payment" ? (
            b.canCancel ? (
              <Button variant="ghost" block className="text-error-ink" onClick={() => setConfirmCancel(true)}>
                {t("ticket.cancelBooking")}
              </Button>
            ) : (
              <p className="flex items-center justify-center gap-1.5 text-center text-sm text-muted">
                <Info className="size-4" aria-hidden />
                {t("ticket.cancelWindow", { hours: b.cancellationHours })}
              </p>
            )
          ) : null}
        </div>
      </main>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("ticket.cancelConfirmTitle")}
        body={
          b.paymentStatus === "paid"
            ? t("ticket.cancelRefund", { amount: formatRwf(b.totalAmount), phone: formatPhone(data.payment?.phone ?? b.traveler.phone) })
            : t("ticket.cancelConfirmBody")
        }
        confirmLabel={t("ticket.cancelBooking")}
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}

export default function TicketPage() {
  return (
    <RoleGate>
      <Ticket />
    </RoleGate>
  );
}
