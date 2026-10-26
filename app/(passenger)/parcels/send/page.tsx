"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocationPicker, useLocations } from "@/components/location-picker";
import { FlowHeader, SectionLabel, StickyAction } from "@/components/passenger/shell";
import { RoleGate } from "@/components/role-gate";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PARCEL_SIZE_MAX_KG, PARCEL_SIZES, type ParcelSize } from "@/shared/constants";
import { formatAmount, formatRwf, normalizeRwPhone } from "@/shared/money";
import { formatClock } from "@/shared/time";
import type { LocationLite, ParcelDTO, ParcelQuoteDTO } from "@/shared/types";

const inline = "mt-0.5 w-full bg-transparent text-[17px] placeholder:text-faint focus:outline-none";

function SendParcel() {
  const t = useT();
  const router = useRouter();
  const { data: locations } = useLocations();
  const [from, setFrom] = useState<LocationLite | null>(null);
  const [to, setTo] = useState<LocationLite | null>(null);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [size, setSize] = useState<ParcelSize>("small");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!from && locations?.length) {
      const kigali = locations.find((l) => l.slug === "kigali");
      if (kigali) setFrom({ id: kigali.id, slug: kigali.slug, name: kigali.name });
    }
  }, [locations, from]);

  const weightKg = Math.max(0, Number(weight.replace(",", ".")) || 0);
  const quoteWeight = Math.max(0.5, Math.round(weightKg * 2) / 2);
  const quotes = useQuery({
    queryKey: ["parcel-quote", from?.slug, to?.slug, quoteWeight],
    queryFn: () => apiFetch<ParcelQuoteDTO[]>("/parcels/quote", { query: { from: from?.slug, to: to?.slug, weightKg: quoteWeight } }),
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (quotes.data?.length && !quotes.data.some((q) => q.operator.id === operatorId)) setOperatorId(quotes.data[0].operator.id);
  }, [quotes.data, operatorId]);

  const selected = quotes.data?.find((q) => q.operator.id === operatorId) ?? null;
  const tooHeavy = weightKg > PARCEL_SIZE_MAX_KG[size];
  const phoneOk = !!normalizeRwPhone(receiverPhone);
  const valid = !!from && !!to && description.trim().length >= 2 && weightKg > 0 && !tooHeavy && receiverName.trim().length >= 2 && phoneOk && !!selected;

  const create = useMutation({
    mutationFn: () =>
      apiFetch<ParcelDTO>("/parcels", {
        method: "POST",
        body: {
          from: from?.slug,
          to: to?.slug,
          operatorId,
          description: description.trim(),
          weightKg,
          size,
          receiver: { name: receiverName.trim(), phone: receiverPhone },
        },
      }),
    onSuccess: (parcel) => router.push(`/pay/parcel/${parcel.code}`),
  });

  return (
    <div className="min-h-dvh pb-32">
      <FlowHeader title={t("parcels.sendTitle")} subtitle={t("parcels.sendSubtitle")} backHref="/parcels" />
      <main className="space-y-8 px-6 py-6">
        <div className="rounded-2xl bg-canvas">
          <button type="button" onClick={() => setPicker("from")} className="flex w-full items-center gap-5 px-5 pb-4 pt-5 text-left">
            <span className="size-3.5 shrink-0 rounded-full border-[2.5px] border-ink" aria-hidden />
            <span>
              <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("common.from")}</span>
              <span className="block text-lg">{from?.name ?? t("home.selectOrigin")}</span>
            </span>
          </button>
          <div className="mx-5 h-px bg-line" />
          <button type="button" onClick={() => setPicker("to")} className="flex w-full items-center gap-5 px-5 pb-5 pt-4 text-left">
            <span className="size-3.5 shrink-0 rounded-full bg-ink" aria-hidden />
            <span>
              <span className="block text-xs font-medium uppercase tracking-wide text-faint">{t("common.to")}</span>
              <span className={cn("block text-lg", !to && "text-faint")}>{to?.name ?? t("home.selectDestination")}</span>
            </span>
          </button>
        </div>

        <section>
          <SectionLabel>{t("parcels.details")}</SectionLabel>
          <div className="divide-y divide-line rounded-2xl bg-canvas">
            <div className="px-5 py-3.5">
              <label htmlFor="parcel-description" className="block text-sm text-faint">
                {t("parcels.description")}
              </label>
              <input
                id="parcel-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("parcels.descriptionPlaceholder")}
                className={inline}
              />
            </div>
            <div className="grid grid-cols-2 divide-x divide-line">
              <div className="px-5 py-3.5">
                <label htmlFor="parcel-weight" className="block text-sm text-faint">
                  {t("parcels.weight")}
                </label>
                <input
                  id="parcel-weight"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="0.0"
                  aria-invalid={tooHeavy || undefined}
                  className={cn(inline, tooHeavy && "text-error-ink")}
                />
              </div>
              <div className="px-5 py-3.5">
                <label htmlFor="parcel-size" className="block text-sm text-faint">
                  {t("parcels.size")}
                </label>
                <select
                  id="parcel-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value as ParcelSize)}
                  className={cn(inline, "appearance-none")}
                >
                  {PARCEL_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {t(`parcels.sizes.${s}`)} · {t("parcels.sizeHint", { kg: PARCEL_SIZE_MAX_KG[s] })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {tooHeavy ? <p className="mt-2 text-sm text-error-ink">{t("errors.PARCEL_TOO_HEAVY")}</p> : null}
        </section>

        <section>
          <SectionLabel>{t("parcels.receiver")}</SectionLabel>
          <div className="divide-y divide-line rounded-2xl bg-canvas">
            <div className="px-5 py-3.5">
              <label htmlFor="receiver-name" className="block text-sm text-faint">
                {t("parcels.receiverName")}
              </label>
              <input
                id="receiver-name"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder={t("booking.fullName")}
                className={inline}
              />
            </div>
            <div className="px-5 py-3.5">
              <label htmlFor="receiver-phone" className="block text-sm text-faint">
                {t("parcels.receiverPhone")}
              </label>
              <input
                id="receiver-phone"
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                placeholder="+250 7XX XXX XXX"
                aria-invalid={(touched && !phoneOk) || undefined}
                className={inline}
              />
            </div>
          </div>
          {touched && !phoneOk ? <p className="mt-2 text-sm text-error-ink">{t("errors.PHONE_INVALID")}</p> : null}
        </section>

        <section>
          <SectionLabel>{t("parcels.selectOperator")}</SectionLabel>
          {!to ? (
            <p className="text-[15px] text-muted">{t("parcels.chooseRoute")}</p>
          ) : quotes.isLoading ? (
            <Skeleton className="h-20" />
          ) : !quotes.data?.length ? (
            <p className="text-[15px] text-muted">{t("parcels.noOperators")}</p>
          ) : (
            <div className="space-y-3" role="radiogroup" aria-label={t("parcels.selectOperator")}>
              {quotes.data.map((q) => (
                // biome-ignore lint/a11y/useSemanticElements: card-style radio
                <button
                  key={q.operator.id}
                  type="button"
                  role="radio"
                  aria-checked={operatorId === q.operator.id}
                  onClick={() => setOperatorId(q.operator.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 rounded-2xl border-2 bg-canvas p-5 text-left",
                    operatorId === q.operator.id ? "border-ink" : "border-transparent",
                  )}
                >
                  <span>
                    <span className="block text-lg font-semibold">{q.operator.name}</span>
                    <span className="block text-[15px] text-muted">
                      {q.nextDeparture ? t("parcels.nextDeparture", { time: formatClock(q.nextDeparture) }) : t("parcels.noDeparture")}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-lg font-bold tabular">{formatAmount(q.perKg)} RWF</span>
                    <span className="block text-sm text-faint">{t("common.perKg")}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {selected && weightKg > 0 ? (
          <div className="flex items-center justify-between border-t border-line pt-4">
            <span className="text-xl font-bold">{t("common.total")}</span>
            <span className="text-2xl font-bold tabular">{formatRwf(selected.priceRwf)}</span>
          </div>
        ) : null}
        {create.error ? (
          <p className="text-sm text-error-ink" role="alert">
            {errorMessage(create.error, t)}
          </p>
        ) : null}
      </main>

      <StickyAction>
        <Button
          size="xl"
          block
          loading={create.isPending}
          onClick={() => {
            setTouched(true);
            if (valid) create.mutate();
          }}
        >
          {t("parcels.send")}
        </Button>
      </StickyAction>

      <LocationPicker
        open={picker === "from"}
        onOpenChange={(o) => !o && setPicker(null)}
        title={t("home.selectOrigin")}
        stationsOnly
        exclude={to?.id}
        onSelect={setFrom}
      />
      <LocationPicker
        open={picker === "to"}
        onOpenChange={(o) => !o && setPicker(null)}
        title={t("home.selectDestination")}
        stationsOnly
        exclude={from?.id}
        onSelect={setTo}
      />
    </div>
  );
}

export default function SendParcelPage() {
  return (
    <RoleGate>
      <SendParcel />
    </RoleGate>
  );
}
