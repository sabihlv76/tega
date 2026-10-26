"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/feedback";
import { OtpInput } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDayLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatPhone, formatRwf } from "@/shared/money";
import { formatClock, kigaliDate } from "@/shared/time";
import type { StationParcelDTO, StationTripDTO } from "@/shared/types";

function LoadDialog({ parcel, open, onOpenChange, onDone }: { parcel: StationParcelDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [tripId, setTripId] = useState("");
  const trips = useQuery({
    queryKey: ["station", "parcel-trips", parcel.code],
    queryFn: () => apiFetch<StationTripDTO[]>(`/station/parcels/${parcel.code}/trips`),
    enabled: open,
  });
  const load = useMutation({
    mutationFn: () => apiFetch(`/station/parcels/${parcel.code}/load`, { method: "POST", body: { tripId } }),
    onSuccess: () => {
      toast.success(t("station.parcels.loaded"));
      onOpenChange(false);
      onDone();
    },
  });
  const today = kigaliDate();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("station.parcels.chooseTrip")}
      description={`${parcel.code} · ${parcel.origin.name} → ${parcel.destination.name}`}
      footer={
        <Button disabled={!tripId} loading={load.isPending} onClick={() => load.mutate()}>
          {t("station.trip.load")}
        </Button>
      }
    >
      {trips.isLoading ? (
        <Spinner />
      ) : !trips.data?.length ? (
        <p className="text-sm text-muted">{t("station.parcels.noTrips")}</p>
      ) : (
        <div role="radiogroup" aria-label={t("station.parcels.chooseTrip")} className="space-y-2">
          {trips.data.map((trip) => (
            // biome-ignore lint/a11y/useSemanticElements: large tappable option rows
            <button
              key={trip.id}
              type="button"
              role="radio"
              aria-checked={tripId === trip.id}
              onClick={() => setTripId(trip.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-card border p-3 text-left transition-colors",
                tripId === trip.id ? "border-ink bg-canvas ring-1 ring-ink" : "border-line hover:bg-canvas",
              )}
            >
              <span className="text-lg font-bold tabular">{formatClock(trip.departureAt)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">
                {formatDayLabel(kigaliDate(new Date(trip.departureAt)), locale, t, today)} · <span className="font-mono">{trip.plateNumber}</span>
              </span>
              <StatusBadge kind="board" status={trip.boardStatus} />
            </button>
          ))}
        </div>
      )}
      {load.error ? <p className="mt-3 text-sm text-error-ink">{errorMessage(load.error, t)}</p> : null}
    </Dialog>
  );
}

function ReleaseDialog({ parcel, open, onOpenChange, onDone }: { parcel: StationParcelDTO; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const release = useMutation({
    mutationFn: () => apiFetch(`/station/parcels/${parcel.code}/release`, { method: "POST", body: { pickupCode: code } }),
    onSuccess: () => {
      toast.success(t("station.parcels.released"));
      close(false);
      onDone();
    },
  });
  function close(o: boolean) {
    if (!o) {
      setCode("");
      release.reset();
    }
    onOpenChange(o);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t("station.parcels.release")}
      description={`${parcel.code} · ${parcel.receiverName} · ${formatPhone(parcel.receiverPhone)}`}
      footer={
        <Button disabled={code.length !== 6} loading={release.isPending} onClick={() => release.mutate()}>
          {t("station.parcels.release")}
        </Button>
      }
    >
      <p className="mb-3 text-sm font-medium">{t("station.parcels.pickupCodePrompt")}</p>
      <OtpInput value={code} onChange={setCode} label={t("station.parcels.pickupCodePrompt")} autoFocus />
      {release.error ? <p className="mt-3 text-sm text-error-ink">{errorMessage(release.error, t)}</p> : null}
    </Dialog>
  );
}

/** The next desk action for a parcel at this bus park: receive, load or release. */
export function ParcelActions({ parcel, stationId, onDone }: { parcel: StationParcelDTO; stationId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"cash" | "load" | "release" | null>(null);
  const receive = useMutation({
    mutationFn: (collectCash: boolean) => apiFetch(`/station/parcels/${parcel.code}/receive`, { method: "POST", body: { collectCash } }),
    onSuccess: () => {
      toast.success(t("station.parcels.received"));
      setMode(null);
      onDone();
    },
    onError: (err) => toastError(err, t),
  });
  const close = (o: boolean) => !o && setMode(null);

  if (parcel.origin.id === stationId && parcel.status === "awaiting_dropoff") {
    const cash = parcel.paymentStatus === "cash_due";
    return (
      <>
        <Button size="sm" loading={receive.isPending && !cash} onClick={() => (cash ? setMode("cash") : receive.mutate(false))}>
          {t("station.parcels.receive")}
        </Button>
        <ConfirmDialog
          open={mode === "cash"}
          onOpenChange={close}
          title={t("station.parcels.receive")}
          body={`${parcel.code} · ${parcel.senderName}`}
          confirmLabel={t("station.parcels.collectCash", { amount: formatRwf(parcel.priceRwf) })}
          loading={receive.isPending}
          onConfirm={() => receive.mutate(true)}
        />
      </>
    );
  }
  if (parcel.origin.id === stationId && parcel.status === "received") {
    return (
      <>
        <Button size="sm" onClick={() => setMode("load")}>
          {t("station.trip.load")}
        </Button>
        <LoadDialog parcel={parcel} open={mode === "load"} onOpenChange={close} onDone={onDone} />
      </>
    );
  }
  if (parcel.destination.id === stationId && parcel.status === "arrived") {
    return (
      <>
        <Button size="sm" onClick={() => setMode("release")}>
          {t("station.parcels.release")}
        </Button>
        <ReleaseDialog parcel={parcel} open={mode === "release"} onOpenChange={close} onDone={onDone} />
      </>
    );
  }
  return null;
}
