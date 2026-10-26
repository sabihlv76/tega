"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ParcelTimeline } from "@/components/passenger/parcel";
import { FlowHeader, SectionLabel } from "@/components/passenger/shell";
import { RoleGate } from "@/components/role-gate";
import { StatusBadge } from "@/components/status";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent, useSocketRooms } from "@/lib/socket";
import { formatPhone, formatRwf } from "@/shared/money";
import type { ParcelDTO, PaymentDTO } from "@/shared/types";

function ParcelDetail() {
  const { t, locale } = useI18n();
  const { code } = useParams<{ code: string }>();
  const queryClient = useQueryClient();
  const key = ["parcel", code];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ parcel: ParcelDTO; payment: PaymentDTO | null }>(`/parcels/${code}`),
  });
  useSocketEvent<ParcelDTO>("parcel.updated", (p) => {
    if (p.code === code) void queryClient.invalidateQueries({ queryKey: key });
  });
  useSocketRooms(data ? [`parcel:${code}`] : []);

  if (isLoading) return <PageLoader />;
  if (!data) {
    return (
      <>
        <FlowHeader title={t("parcels.title")} backHref="/parcels" />
        <EmptyState title={t("parcels.notFound")} />
      </>
    );
  }
  const p = data.parcel;

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t("common.copied"));
  };

  return (
    <div className="min-h-dvh pb-10">
      <FlowHeader title={p.code} subtitle={`${p.origin.name} → ${p.destination.name}`} backHref="/parcels" />
      <main className="space-y-8 px-6 py-6">
        <div className="flex items-center justify-between">
          <StatusBadge kind="parcel" status={p.status} className="text-sm" />
          <span className="text-xl font-bold tabular">{formatRwf(p.priceRwf)}</span>
        </div>

        {p.status === "pending_payment" ? (
          <ButtonLink href={`/pay/parcel/${p.code}`} size="xl" block>
            {t("ticket.completePayment")}
          </ButtonLink>
        ) : null}

        {p.pickupCode ? (
          <section className="rounded-2xl bg-ink p-5 text-white">
            <p className="flex items-center gap-2 text-sm text-neutral-300">
              <KeyRound className="size-4" aria-hidden />
              {t("parcels.pickupCode")}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-4xl font-bold tracking-[0.3em] tabular">{p.pickupCode}</p>
              <Button variant="inverse" size="iconSm" aria-label={t("common.copy")} onClick={() => void copy(p.pickupCode ?? "")}>
                <Copy aria-hidden />
              </Button>
            </div>
            <p className="mt-2 text-sm text-neutral-300">{t("parcels.pickupCodeHint")}</p>
          </section>
        ) : null}

        <section>
          <SectionLabel>{t("parcels.timeline")}</SectionLabel>
          <ParcelTimeline parcel={p} />
        </section>

        <section className="divide-y divide-line rounded-2xl bg-canvas text-[15px]">
          {[
            [t("parcels.trackingCode"), p.code],
            [t("common.operator"), p.operator.name],
            [t("parcels.description"), `${p.description} · ${p.weightKg} kg · ${t(`parcels.sizes.${p.size}`)}`],
            [t("parcels.sender"), `${p.sender.name} · ${formatPhone(p.sender.phone)}`],
            [t("parcels.receiver"), `${p.receiver.name} · ${formatPhone(p.receiver.phone)}`],
            [t("common.date"), formatDateTime(p.createdAt, locale)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 px-5 py-3">
              <span className="text-muted">{label}</span>
              <span className="text-right">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <span className="text-muted">{t("common.status")}</span>
            <StatusBadge kind="payment" status={p.paymentStatus} />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ParcelPage() {
  return (
    <RoleGate>
      <ParcelDetail />
    </RoleGate>
  );
}
