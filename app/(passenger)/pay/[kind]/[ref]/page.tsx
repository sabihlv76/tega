"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Clock, Smartphone, XCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FlowHeader, SectionLabel, StickyAction } from "@/components/passenger/shell";
import { RoleGate } from "@/components/role-gate";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageLoader } from "@/components/ui/feedback";
import { PhoneInput } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/shared/constants";
import { formatAmount, formatRwf, networkOf, normalizeRwPhone } from "@/shared/money";
import { formatClock } from "@/shared/time";
import type { BookingDTO, ParcelDTO, PaymentDTO, PublicConfigDTO } from "@/shared/types";

type Target =
  | { kind: "booking"; booking: BookingDTO; payment: PaymentDTO | null }
  | { kind: "parcel"; parcel: ParcelDTO; payment: PaymentDTO | null };

function MethodCard({
  selected,
  onSelect,
  logo,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  logo: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: card-style radio
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border-2 bg-canvas p-4 text-left transition-colors",
        selected ? "border-ink" : "border-transparent hover:border-line",
      )}
    >
      {logo}
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold">{title}</span>
        <span className="block text-[15px] text-muted">{hint}</span>
      </span>
      <span
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-ink" : "border-faint")}
        aria-hidden
      >
        {selected ? <span className="size-3 rounded-full bg-ink" /> : null}
      </span>
    </button>
  );
}

const doneUrl = (tg: Target) => (tg.kind === "booking" ? `/tickets/${tg.booking.reference}` : `/parcels/${tg.parcel.code}`);

function PaymentScreen() {
  const t = useT();
  const router = useRouter();
  const { kind, ref } = useParams<{ kind: "booking" | "parcel"; ref: string }>();
  const { user } = useAuth();
  const [method, setMethod] = useState<PaymentMethod>("mtn");
  const [phone, setPhone] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const config = useQuery({ queryKey: ["config"], queryFn: () => apiFetch<PublicConfigDTO>("/config"), staleTime: 300_000 });
  const target = useQuery({
    queryKey: ["pay-target", kind, ref],
    queryFn: async (): Promise<Target> => {
      if (kind === "parcel") {
        const r = await apiFetch<{ parcel: ParcelDTO; payment: PaymentDTO | null }>(`/parcels/${ref}`);
        return { kind: "parcel", ...r };
      }
      const r = await apiFetch<{ booking: BookingDTO; payment: PaymentDTO | null }>(`/bookings/${ref}`);
      return { kind: "booking", ...r };
    },
  });

  useEffect(() => {
    if (user?.phone && !phone) setPhone(user.phone.replace("+250", ""));
  }, [user, phone]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const payment = useQuery({
    queryKey: ["payment", paymentId],
    queryFn: () => apiFetch<PaymentDTO>(`/payments/${paymentId}`),
    enabled: !!paymentId,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "pending" && q.state.data.status !== "initiated" ? false : 2500),
  });
  useSocketEvent<PaymentDTO>("payment.updated", (p) => {
    if (p.id === paymentId) void payment.refetch();
  });

  // Leave once the payment (or cash reservation) is settled.
  useEffect(() => {
    const p = payment.data;
    if (!p || !target.data) return;
    if (p.status === "success" || (p.method === "cash" && p.status === "pending")) {
      const timer = setTimeout(() => router.replace(doneUrl(target.data)), 900);
      return () => clearTimeout(timer);
    }
  }, [payment.data, target.data, router]);

  const pay = useMutation({
    mutationFn: async () => {
      if (!target.data) throw new Error("no target");
      const id = target.data.kind === "booking" ? target.data.booking.id : target.data.parcel.id;
      return apiFetch<PaymentDTO>("/payments", {
        method: "POST",
        body: { kind, id, method, phone: method === "cash" ? undefined : phone },
      });
    },
    onSuccess: (p) => setPaymentId(p.id),
  });

  if (target.isLoading) return <PageLoader />;
  if (!target.data) {
    return (
      <>
        <FlowHeader title={t("payment.title")} />
        <EmptyState title={t("errors.NOT_FOUND")} action={<ButtonLink href="/">{t("auth.goHome")}</ButtonLink>} />
      </>
    );
  }

  const tg = target.data;
  const amount = tg.kind === "booking" ? tg.booking.totalAmount : tg.parcel.priceRwf;
  const status = tg.kind === "booking" ? tg.booking.status : tg.parcel.status;
  const holdExpiresAt = tg.kind === "booking" ? tg.booking.holdExpiresAt : tg.parcel.holdExpiresAt;
  const expired = status === "expired" || (!!holdExpiresAt && new Date(holdExpiresAt).getTime() < now && !paymentId);
  const alreadyPaid = status !== "pending_payment" && status !== "expired";

  if (alreadyPaid && !paymentId) {
    return (
      <>
        <FlowHeader title={t("payment.title")} />
        <EmptyState
          icon={<CheckCircle2 className="size-5" />}
          title={t("payment.alreadyPaid")}
          action={<ButtonLink href={doneUrl(tg)}>{t("common.continue")}</ButtonLink>}
        />
      </>
    );
  }

  const normalized = normalizeRwPhone(phone);
  const network = normalized ? networkOf(normalized) : null;
  const mismatch = method !== "cash" && !!normalized && network !== method;
  const current = payment.data ?? pay.data ?? null;
  const waiting = !!current && (current.status === "pending" || current.status === "initiated") && current.method !== "cash";
  const succeeded = current?.status === "success" || (current?.method === "cash" && current.status === "pending");
  const failed = current?.status === "failed";
  const mock = method === "mtn" ? config.data?.payments.mtn === "mock" : config.data?.payments.airtel === "mock";

  if (waiting || succeeded) {
    return (
      <>
        <FlowHeader title={kind === "parcel" ? t("payment.parcelTitle") : t("payment.title")} />
        <main className="flex flex-col items-center px-6 py-16 text-center" aria-live="polite">
          {succeeded ? (
            <CheckCircle2 className="size-16 text-success" aria-hidden />
          ) : (
            <span className="relative flex size-20 items-center justify-center">
              <span className="pulse-ring absolute inset-0 rounded-full bg-ink/15" />
              <Smartphone className="size-10" aria-hidden />
            </span>
          )}
          <h1 className="mt-6 text-2xl font-bold">{succeeded ? t("payment.successTitle") : t("payment.waitingTitle")}</h1>
          <p className="mt-2 max-w-xs text-[15px] text-muted">
            {succeeded ? t("payment.redirecting") : t("payment.waitingBody", { amount: formatRwf(amount), phone: `+250 ${phone}` })}
          </p>
          {waiting && current?.mode === "mock" ? (
            <div className="mt-6">
              <Badge tone="warning">{t("common.testMode")}</Badge>
              <p className="mt-2 max-w-xs text-sm text-muted">{t("payment.waitingMock")}</p>
            </div>
          ) : null}
        </main>
      </>
    );
  }

  return (
    <div className="min-h-dvh pb-32">
      <FlowHeader title={kind === "parcel" ? t("payment.parcelTitle") : t("payment.title")} />
      <main className="space-y-8 px-6 py-8">
        <div className="text-center">
          <p className="text-[15px] text-faint">{t("payment.totalAmount")}</p>
          <p className="mt-1 text-6xl font-bold tracking-tight tabular">{formatAmount(amount)}</p>
          <p className="text-lg text-faint">RWF</p>
          {holdExpiresAt && !expired ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
              <Clock className="size-4" aria-hidden />
              {t("payment.holdUntil", { time: formatClock(holdExpiresAt) })}
            </p>
          ) : null}
        </div>

        {expired ? (
          <Alert tone="warning" title={t("payment.expired")} action={<ButtonLink href="/" size="sm">{t("booking.bookAnother")}</ButtonLink>} />
        ) : null}
        {failed ? (
          <Alert tone="error" title={t("payment.failedTitle")}>
            {current?.failureReason ?? t("errors.PAYMENT_FAILED")}
          </Alert>
        ) : null}

        <section>
          <SectionLabel>{t("payment.method")}</SectionLabel>
          <div className="space-y-3" role="radiogroup" aria-label={t("payment.method")}>
            <MethodCard
              selected={method === "mtn"}
              onSelect={() => setMethod("mtn")}
              logo={<span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#ffcc00] text-lg font-black text-ink">MTN</span>}
              title={t("payment.mtn")}
              hint={t("payment.mtnHint")}
            />
            <MethodCard
              selected={method === "airtel"}
              onSelect={() => setMethod("airtel")}
              logo={<span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#e40000] text-base font-bold text-white">Airtel</span>}
              title={t("payment.airtel")}
              hint={t("payment.airtelHint")}
            />
            <MethodCard
              selected={method === "cash"}
              onSelect={() => setMethod("cash")}
              logo={
                <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-subtle">
                  <Banknote className="size-6" aria-hidden />
                </span>
              }
              title={t("payment.cash")}
              hint={kind === "parcel" ? t("payment.cashHintParcel") : t("payment.cashHint")}
            />
          </div>
        </section>

        {method !== "cash" ? (
          <section>
            <SectionLabel>
              <label htmlFor="momo-number">{t("payment.momoNumber")}</label>
            </SectionLabel>
            <PhoneInput
              id="momo-number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
              placeholder="788 123 456"
              aria-invalid={mismatch || undefined}
              className="h-14 rounded-2xl border-0 bg-canvas text-lg"
            />
            <p className={cn("mt-2 px-1 text-sm", mismatch ? "text-error-ink" : "text-faint")}>
              {mismatch
                ? t("payment.wrongNetwork", { network: method === "mtn" ? t("payment.mtn") : t("payment.airtel") })
                : t("payment.pushNotice")}
            </p>
            {mock ? <Badge tone="warning" className="mt-2">{t("common.testMode")}</Badge> : null}
          </section>
        ) : null}

        {pay.error ? (
          <p className="text-sm text-error-ink" role="alert">
            {errorMessage(pay.error, t)}
          </p>
        ) : null}
      </main>

      <StickyAction>
        <Button
          size="xl"
          block
          loading={pay.isPending}
          disabled={expired || (method !== "cash" && (!normalized || mismatch))}
          onClick={() => pay.mutate()}
        >
          {failed ? <XCircle aria-hidden /> : null}
          {method === "cash" ? t("payment.reserve") : t("payment.pay", { amount: formatRwf(amount) })}
        </Button>
      </StickyAction>
    </div>
  );
}

export default function PayPage() {
  return (
    <RoleGate>
      <PaymentScreen />
    </RoleGate>
  );
}
