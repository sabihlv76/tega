"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TicketScanResult } from "@/shared/constants";
import { formatPhone, formatRwf } from "@/shared/money";
import { formatClock } from "@/shared/time";
import type { CheckInResultDTO } from "@/shared/types";

/** Posts a scanned QR token or typed booking reference to the station desk check-in endpoint. */
export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; collectCash?: boolean }) =>
      apiFetch<CheckInResultDTO>("/station/checkin", { method: "POST", body: input }),
    onSuccess: (result) => {
      try {
        navigator.vibrate?.(result.result === "valid" ? 80 : [140, 70, 140]);
      } catch {
        // Vibration is optional feedback.
      }
      void queryClient.invalidateQueries({ queryKey: ["station"] });
    },
  });
}

const TONES: Record<TicketScanResult, "success" | "warning" | "error"> = {
  valid: "success",
  already_used: "warning",
  unpaid: "warning",
  invalid: "error",
  wrong_station: "error",
  wrong_day: "error",
  cancelled: "error",
};

const STYLES = {
  success: { box: "border-green-200 bg-success-soft", icon: "text-success-ink", Icon: CheckCircle2 },
  warning: { box: "border-amber-200 bg-warning-soft", icon: "text-warning-ink", Icon: AlertTriangle },
  error: { box: "border-red-200 bg-error-soft", icon: "text-error-ink", Icon: XCircle },
};

export function CheckInResultCard({
  result,
  onCollectCash,
  collecting,
  onNext,
  nextLabel,
}: {
  result: CheckInResultDTO;
  onCollectCash: () => void;
  collecting: boolean;
  onNext: () => void;
  nextLabel?: string;
}) {
  const { t } = useI18n();
  const look = STYLES[TONES[result.result]];
  const b = result.booking;
  return (
    <div role="status" aria-live="assertive" className={cn("rounded-card border p-5 sm:p-6", look.box)}>
      <div className="flex items-center gap-3">
        <look.Icon className={cn("size-10 shrink-0", look.icon)} aria-hidden />
        <p className="text-2xl font-bold tracking-tight">{t(`station.result.${result.result}`)}</p>
      </div>
      {b ? (
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">{t("operator.bookings.columns.traveler")}</dt>
            <dd className="text-lg font-semibold">{b.travelerName}</dd>
            <dd className="text-sm text-muted tabular">{formatPhone(b.travelerPhone)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t("operator.bookings.columns.places")}</dt>
            <dd className="text-lg font-semibold">{t("common.places", { count: b.places })}</dd>
            <dd className="font-mono text-sm text-muted">{b.reference}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted">{t("operator.bookings.columns.trip")}</dt>
            <dd className="font-semibold">
              <span className="tabular">{formatClock(b.trip.departureAt)}</span> · {b.trip.origin.name} → {b.trip.destination.name}
            </dd>
            <dd className="text-sm text-muted">
              {t("common.bus")} <span className="font-mono">{b.trip.plateNumber}</span>
            </dd>
          </div>
          {result.result === "already_used" && b.checkedInAt ? (
            <p className="text-sm font-medium text-warning-ink sm:col-span-2">
              {t("station.result.checkedInAt", { time: formatClock(b.checkedInAt) })}
            </p>
          ) : null}
        </dl>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {result.result === "unpaid" ? (
          <Button size="lg" loading={collecting} onClick={onCollectCash}>
            <Banknote aria-hidden />
            {t("station.result.collectCash", { amount: formatRwf(result.amountDue) })}
          </Button>
        ) : null}
        <Button size="lg" variant={result.result === "unpaid" ? "outline" : "primary"} onClick={onNext}>
          {nextLabel ?? t("station.result.scanNext")}
        </Button>
      </div>
    </div>
  );
}
