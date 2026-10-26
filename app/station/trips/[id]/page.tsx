"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, CheckCircle2, Clock, Package, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { useCheckIn } from "@/components/station/checkin";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { formatPhone, formatRwf } from "@/shared/money";
import { formatClock } from "@/shared/time";
import type { ManifestBookingDTO, StationParcelDTO, StationTripDetailDTO } from "@/shared/types";

const owesCash = (b: ManifestBookingDTO) => b.paymentStatus === "cash_due" || b.status === "pending_payment";

function ParcelList({ parcels }: { parcels: StationParcelDTO[] }) {
  return (
    <ul className="space-y-2">
      {parcels.map((p) => (
        <li key={p.id} className="flex items-center gap-3 rounded-card bg-canvas p-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-semibold">{p.code}</p>
            <p className="truncate text-sm text-muted">
              {p.description} · {p.weightKg} kg · {p.receiverName}
            </p>
          </div>
          <StatusBadge kind="parcel" status={p.status} />
        </li>
      ))}
    </ul>
  );
}

export default function StationTripPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["station", "trip", id],
    queryFn: () => apiFetch<StationTripDetailDTO>(`/station/trips/${id}`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["station"] });
  useSocketEvent("checkin.created", refresh);
  useSocketEvent("trip.updated", refresh);
  useSocketEvent("parcel.updated", refresh);

  const [cashFor, setCashFor] = useState<ManifestBookingDTO | null>(null);
  const [departOpen, setDepartOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [delay, setDelay] = useState("15");
  const [busy, setBusy] = useState<string | null>(null);
  const checkIn = useCheckIn();

  const doCheckIn = (b: ManifestBookingDTO, collectCash = false) => {
    setBusy(b.id);
    checkIn.mutate(
      { code: b.reference, collectCash },
      {
        onSuccess: (r) => {
          setCashFor(null);
          if (r.result === "valid") toast.success(`${t("station.result.valid")} · ${b.travelerName}`);
          else if (r.result === "unpaid") setCashFor(b);
          else toast.error(t(`station.result.${r.result}`));
        },
        onError: (err) => toastError(err, t),
        onSettled: () => setBusy(null),
      },
    );
  };

  const patch = useMutation({
    mutationFn: (body: { status?: "boarding" | "departed"; delayMinutes?: number }) =>
      apiFetch(`/station/trips/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setDepartOpen(false);
      setDelayOpen(false);
      refresh();
      toast.success(t("operator.schedule.tripUpdated"));
    },
    onError: (err) => toastError(err, t),
  });
  const load = useMutation({
    mutationFn: (p: StationParcelDTO) => apiFetch(`/station/parcels/${p.code}/load`, { method: "POST", body: { tripId: id } }),
    onSuccess: () => {
      toast.success(t("station.parcels.loaded"));
      refresh();
    },
    onError: (err) => toastError(err, t),
  });

  if (isLoading) return <PageLoader />;
  if (!data) return <EmptyState title={errorMessage(error, t)} />;
  const { trip, passengers, parcels, loadable } = data;
  const open = trip.status === "scheduled" || trip.status === "boarding";

  return (
    <div className="space-y-6">
      <Link href="/station" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t("common.back")}
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-20 items-center justify-center rounded-card bg-ink text-2xl font-bold text-white tabular">
            {formatClock(trip.departureAt)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {trip.origin.name} → {trip.destination.name}
            </h1>
            <p className="text-muted">
              {trip.operator.name} · {t("common.bus")} <span className="font-mono">{trip.plateNumber}</span>
              {trip.delayMinutes > 0 ? ` · ${t("station.board.was", { time: formatClock(trip.scheduledAt) })}` : ""}
            </p>
          </div>
          <StatusBadge kind="board" status={trip.boardStatus} className="px-3 py-1 text-sm" />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
          <span className="inline-flex items-center gap-2">
            <Users className="size-4 text-muted" aria-hidden />
            {t("station.checkedInCount", { checked: trip.checkedIn, total: trip.booked })}
          </span>
          <span className="inline-flex items-center gap-2">
            <Package className="size-4 text-muted" aria-hidden />
            {t("station.trip.parcelsCount", { count: parcels.length })}
          </span>
        </div>
        {open ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
            {trip.status === "scheduled" ? (
              <Button loading={patch.isPending && patch.variables?.status === "boarding"} onClick={() => patch.mutate({ status: "boarding" })}>
                {t("operator.schedule.markBoarding")}
              </Button>
            ) : null}
            <Button variant={trip.status === "boarding" ? "primary" : "outline"} onClick={() => setDepartOpen(true)}>
              {t("operator.schedule.markDeparted")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDelay(String(trip.delayMinutes || 15));
                setDelayOpen(true);
              }}
            >
              <Clock aria-hidden />
              {t("operator.schedule.reportDelay")}
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={t("station.trip.passengers")} subtitle={t("common.places", { count: trip.booked })} />
          <CardBody>
            {passengers.length === 0 ? (
              <EmptyState icon={<Users className="size-5" />} title={t("station.trip.noPassengers")} />
            ) : (
              <ul className="divide-y divide-line">
                {passengers.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {b.travelerName} <span className="font-normal text-muted">· {t("common.places", { count: b.places })}</span>
                      </p>
                      <p className="text-sm text-muted">
                        <span className="font-mono">{b.reference}</span> · <span className="tabular">{formatPhone(b.travelerPhone)}</span>
                      </p>
                    </div>
                    {b.checkedInAt ? (
                      <Badge tone="success">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        {formatClock(b.checkedInAt)}
                      </Badge>
                    ) : !open ? (
                      <StatusBadge kind="payment" status={b.paymentStatus} />
                    ) : owesCash(b) ? (
                      <Button size="sm" variant="outline" onClick={() => setCashFor(b)}>
                        <Banknote aria-hidden />
                        {formatRwf(b.totalAmount)}
                      </Button>
                    ) : (
                      <Button size="sm" loading={busy === b.id} onClick={() => doCheckIn(b)}>
                        {t("station.trip.checkIn")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title={t("station.trip.parcels")} />
            <CardBody>{parcels.length === 0 ? <p className="text-sm text-muted">{t("station.trip.noParcels")}</p> : <ParcelList parcels={parcels} />}</CardBody>
          </Card>
          {open && loadable.length > 0 ? (
            <Card>
              <CardHeader title={t("station.trip.loadParcels")} />
              <CardBody>
                <ul className="space-y-2">
                  {loadable.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-card bg-canvas p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold">{p.code}</p>
                        <p className="truncate text-sm text-muted">
                          {p.description} · {p.weightKg} kg
                        </p>
                      </div>
                      <Button size="sm" loading={load.isPending && load.variables?.id === p.id} onClick={() => load.mutate(p)}>
                        {t("station.trip.load")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={!!cashFor}
        onOpenChange={(o) => !o && setCashFor(null)}
        title={t("station.result.unpaid")}
        body={cashFor ? `${cashFor.travelerName} · ${cashFor.reference}` : undefined}
        confirmLabel={cashFor ? t("station.result.collectCash", { amount: formatRwf(cashFor.totalAmount) }) : ""}
        loading={!!cashFor && busy === cashFor.id}
        onConfirm={() => cashFor && doCheckIn(cashFor, true)}
      />
      <ConfirmDialog
        open={departOpen}
        onOpenChange={setDepartOpen}
        title={t("operator.schedule.markDeparted")}
        body={t("station.trip.departBody")}
        confirmLabel={t("operator.schedule.markDeparted")}
        loading={patch.isPending}
        onConfirm={() => patch.mutate({ status: "departed" })}
      />
      <Dialog
        open={delayOpen}
        onOpenChange={setDelayOpen}
        title={t("operator.schedule.reportDelay")}
        size="sm"
        footer={
          <Button loading={patch.isPending} onClick={() => patch.mutate({ delayMinutes: Number(delay) || 0 })}>
            {t("common.save")}
          </Button>
        }
      >
        <Field label={t("operator.schedule.delayMinutes")}>
          {(p) => <Input {...p} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />}
        </Field>
      </Dialog>
    </div>
  );
}
