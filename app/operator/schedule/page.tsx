"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Clock, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { weekdayShort } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { formatClock, kigaliDate } from "@/shared/time";
import type { RouteDTO, ScheduleDTO, StationTripDTO, VehicleDTO } from "@/shared/types";

const WEEK = [1, 2, 3, 4, 5, 6, 0];

function DaysPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const { t, locale } = useI18n();
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {WEEK.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value.includes(d)}
            onClick={() => toggle(d)}
            className={cn(
              "h-9 min-w-11 rounded-input border px-2 text-sm font-medium",
              value.includes(d) ? "border-ink bg-ink text-white" : "border-line bg-paper text-muted",
            )}
          >
            {weekdayShort(d, locale)}
          </button>
        ))}
      </div>
      <div className="flex gap-3 text-sm">
        <button type="button" className="underline underline-offset-4" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>
          {t("operator.schedule.everyDay")}
        </button>
        <button type="button" className="underline underline-offset-4" onClick={() => onChange([1, 2, 3, 4, 5])}>
          {t("operator.schedule.weekdays")}
        </button>
      </div>
    </div>
  );
}

function daysLabel(days: number[], locale: ReturnType<typeof useI18n>["locale"], t: ReturnType<typeof useI18n>["t"]): string {
  if (days.length === 7) return t("operator.schedule.everyDay");
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return t("operator.schedule.weekdays");
  return WEEK.filter((d) => days.includes(d))
    .map((d) => weekdayShort(d, locale))
    .join(", ");
}

function ScheduleDialog({
  schedule,
  open,
  onOpenChange,
  routes,
  vehicles,
}: {
  schedule: ScheduleDTO | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  routes: RouteDTO[];
  vehicles: VehicleDTO[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [routeId, setRouteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  useEffect(() => {
    if (!open) return;
    setRouteId(schedule?.route.id ?? "");
    setVehicleId(schedule?.vehicle.id ?? "");
    setTime(schedule?.departureTime ?? "07:00");
    setDays(schedule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
  }, [open, schedule]);

  const save = useMutation({
    mutationFn: () =>
      schedule
        ? apiFetch(`/operator/schedules/${schedule.id}`, { method: "PATCH", body: { vehicleId, departureTime: time, daysOfWeek: days } })
        : apiFetch("/operator/schedules", { method: "POST", body: { routeId, vehicleId, departureTime: time, daysOfWeek: days } }),
    onSuccess: () => {
      toast.success(t("operator.schedule.created"));
      void queryClient.invalidateQueries({ queryKey: ["operator", "schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={schedule ? t("common.edit") : t("operator.schedule.add")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.isPending} disabled={!routeId || !vehicleId || !time || days.length === 0} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("operator.schedule.route")} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={routeId} disabled={!!schedule} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">{t("common.selectPlaceholder")}</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.origin.name} → {r.destination.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("operator.schedule.vehicle")}>
          {(p) => (
            <Select {...p} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">{t("common.selectPlaceholder")}</option>
              {vehicles
                .filter((v) => v.status === "active")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plateNumber} · {v.capacity}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("operator.schedule.departureTime")}>
          {(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
        </Field>
        <Field label={t("operator.schedule.days")} className="sm:col-span-2">
          {() => <DaysPicker value={days} onChange={setDays} />}
        </Field>
      </div>
      {save.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
    </Dialog>
  );
}

function TripActions({ trip, onDelay, onCancel }: { trip: StationTripDTO; onDelay: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (status: string) => apiFetch(`/operator/trips/${trip.id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      toast.success(t("operator.schedule.tripUpdated"));
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
    },
    onError: (err) => toastError(err, t),
  });
  if (trip.status === "arrived" || trip.status === "cancelled") return null;
  return (
    <Menu
      trigger={
        <Button variant="ghost" size="iconSm" aria-label={t("common.actions")}>
          <MoreVertical aria-hidden />
        </Button>
      }
    >
      {trip.status === "scheduled" ? <MenuItem onSelect={() => update.mutate("boarding")}>{t("operator.schedule.markBoarding")}</MenuItem> : null}
      {trip.status === "scheduled" || trip.status === "boarding" ? (
        <MenuItem onSelect={() => update.mutate("departed")}>{t("operator.schedule.markDeparted")}</MenuItem>
      ) : null}
      {trip.status === "departed" ? <MenuItem onSelect={() => update.mutate("arrived")}>{t("operator.schedule.markArrived")}</MenuItem> : null}
      {trip.status === "scheduled" || trip.status === "boarding" ? (
        <>
          <MenuItem onSelect={onDelay}>{t("operator.schedule.reportDelay")}</MenuItem>
          <MenuItem danger onSelect={onCancel}>
            {t("operator.schedule.cancelTrip")}
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}

function Schedule() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const highlight = params.get("trip");
  const queryClient = useQueryClient();
  const [date, setDate] = useState(kigaliDate());
  const [editing, setEditing] = useState<ScheduleDTO | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [delayFor, setDelayFor] = useState<StationTripDTO | null>(null);
  const [delay, setDelay] = useState("15");
  const [cancelFor, setCancelFor] = useState<StationTripDTO | null>(null);
  const [deleteFor, setDeleteFor] = useState<ScheduleDTO | null>(null);
  const [newTrip, setNewTrip] = useState({ routeId: "", vehicleId: "", time: "12:00" });

  const schedules = useQuery({ queryKey: ["operator", "schedules"], queryFn: () => apiFetch<ScheduleDTO[]>("/operator/schedules") });
  const routes = useQuery({ queryKey: ["operator", "routes"], queryFn: () => apiFetch<RouteDTO[]>("/operator/routes") });
  const vehicles = useQuery({ queryKey: ["operator", "vehicles"], queryFn: () => apiFetch<VehicleDTO[]>("/operator/vehicles") });
  const trips = useQuery({
    queryKey: ["operator", "trips", date],
    queryFn: () => apiFetch<StationTripDTO[]>("/operator/trips", { query: { date } }),
  });
  useSocketEvent("trip.updated", () => void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] }));

  const toggle = useMutation({
    mutationFn: (s: ScheduleDTO) => apiFetch(`/operator/schedules/${s.id}`, { method: "PATCH", body: { active: !s.active } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
    },
    onError: (err) => toastError(err, t),
  });
  const remove = useMutation({
    mutationFn: (s: ScheduleDTO) => apiFetch(`/operator/schedules/${s.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteFor(null);
      void queryClient.invalidateQueries({ queryKey: ["operator", "schedules"] });
    },
    onError: (err) => toastError(err, t),
  });
  const createTrip = useMutation({
    mutationFn: () => apiFetch("/operator/trips", { method: "POST", body: { ...newTrip, date } }),
    onSuccess: () => {
      toast.success(t("operator.schedule.tripCreated"));
      setTripOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
    },
  });
  const setTripDelay = useMutation({
    mutationFn: () => apiFetch(`/operator/trips/${delayFor?.id}`, { method: "PATCH", body: { delayMinutes: Number(delay) || 0 } }),
    onSuccess: () => {
      setDelayFor(null);
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
    },
    onError: (err) => toastError(err, t),
  });
  const cancelTrip = useMutation({
    mutationFn: () => apiFetch(`/operator/trips/${cancelFor?.id}`, { method: "PATCH", body: { status: "cancelled" } }),
    onSuccess: () => {
      setCancelFor(null);
      void queryClient.invalidateQueries({ queryKey: ["operator", "trips"] });
    },
    onError: (err) => toastError(err, t),
  });

  if (schedules.isLoading || routes.isLoading || vehicles.isLoading) return <PageLoader />;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("operator.schedule.title")}
        subtitle={t("operator.schedule.subtitle")}
        actions={
          <Button
            size="lg"
            onClick={() => {
              setEditing(null);
              setScheduleOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t("operator.schedule.add")}
          </Button>
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("operator.schedule.departures")}</h2>
        <TableCard>
          {!schedules.data?.length ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title={t("operator.schedule.noSchedules")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("operator.schedule.departureTime")}</Th>
                  <Th>{t("operator.schedule.route")}</Th>
                  <Th>{t("operator.schedule.days")}</Th>
                  <Th>{t("operator.schedule.vehicle")}</Th>
                  <Th>{t("operator.schedule.active")}</Th>
                  <Th>
                    <span className="sr-only">{t("common.actions")}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {schedules.data.map((s) => (
                  <Tr key={s.id}>
                    <Td className="text-lg font-bold tabular">{s.departureTime}</Td>
                    <Td className="font-medium">
                      {s.route.origin.name} → {s.route.destination.name}
                    </Td>
                    <Td className="text-sm text-muted">{daysLabel(s.daysOfWeek, locale, t)}</Td>
                    <Td className="font-mono text-sm">{s.vehicle.plateNumber}</Td>
                    <Td>
                      <Switch label={<span className="sr-only">{t("operator.schedule.active")}</span>} checked={s.active} onChange={() => toggle.mutate(s)} />
                    </Td>
                    <Td className="text-right">
                      <Menu
                        trigger={
                          <Button variant="ghost" size="iconSm" aria-label={t("common.actions")}>
                            <MoreVertical aria-hidden />
                          </Button>
                        }
                      >
                        <MenuItem
                          icon={<Pencil aria-hidden />}
                          onSelect={() => {
                            setEditing(s);
                            setScheduleOpen(true);
                          }}
                        >
                          {t("common.edit")}
                        </MenuItem>
                        <MenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => setDeleteFor(s)}>
                          {t("common.delete")}
                        </MenuItem>
                      </Menu>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </TableCard>
        <p className="text-sm text-muted">{t("operator.schedule.autoGenerated")}</p>
      </section>

      <Card>
        <CardHeader
          title={t("operator.schedule.trips")}
          action={
            <div className="flex items-center gap-2">
              <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t("common.date")} className="h-10 w-40" />
              <Button variant="outline" onClick={() => setTripOpen(true)}>
                <Plus aria-hidden />
                <span className="hidden sm:inline">{t("operator.schedule.addTrip")}</span>
              </Button>
            </div>
          }
        />
        <CardBody>
          {trips.isLoading ? (
            <PageLoader />
          ) : !trips.data?.length ? (
            <EmptyState icon={<Clock className="size-5" />} title={t("operator.schedule.noTrips")} />
          ) : (
            <ul className="space-y-2">
              {trips.data.map((trip) => (
                <li
                  key={trip.id}
                  className={cn("flex flex-wrap items-center gap-4 rounded-card bg-canvas p-3", highlight === trip.id && "ring-2 ring-ink")}
                >
                  <span className="flex h-12 w-16 items-center justify-center rounded-card bg-ink font-bold text-white tabular">
                    {formatClock(trip.departureAt)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {trip.origin.name} → {trip.destination.name}
                    </p>
                    <p className="text-sm text-muted">
                      {trip.plateNumber} · {t("operator.dashboard.placesBooked", { booked: trip.booked, total: trip.seatsTotal })} ·{" "}
                      {t("station.checkedInCount", { checked: trip.checkedIn, total: trip.booked })}
                    </p>
                  </div>
                  <StatusBadge kind="board" status={trip.boardStatus} />
                  <TripActions
                    trip={trip}
                    onDelay={() => {
                      setDelay(String(trip.delayMinutes || 15));
                      setDelayFor(trip);
                    }}
                    onCancel={() => setCancelFor(trip)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ScheduleDialog
        schedule={editing}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        routes={(routes.data ?? []).filter((r) => r.status === "active")}
        vehicles={vehicles.data ?? []}
      />

      <Dialog
        open={tripOpen}
        onOpenChange={setTripOpen}
        title={t("operator.schedule.addTrip")}
        footer={
          <Button loading={createTrip.isPending} disabled={!newTrip.routeId || !newTrip.vehicleId} onClick={() => createTrip.mutate()}>
            {t("common.create")}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("operator.schedule.route")} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={newTrip.routeId} onChange={(e) => setNewTrip((s) => ({ ...s, routeId: e.target.value }))}>
                <option value="">{t("common.selectPlaceholder")}</option>
                {(routes.data ?? [])
                  .filter((r) => r.status === "active")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin.name} → {r.destination.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label={t("operator.schedule.vehicle")}>
            {(p) => (
              <Select {...p} value={newTrip.vehicleId} onChange={(e) => setNewTrip((s) => ({ ...s, vehicleId: e.target.value }))}>
                <option value="">{t("common.selectPlaceholder")}</option>
                {(vehicles.data ?? [])
                  .filter((v) => v.status === "active")
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNumber}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label={t("operator.schedule.departureTime")}>
            {(p) => <Input {...p} type="time" value={newTrip.time} onChange={(e) => setNewTrip((s) => ({ ...s, time: e.target.value }))} />}
          </Field>
        </div>
        {createTrip.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(createTrip.error, t)}</p> : null}
      </Dialog>

      <Dialog
        open={!!delayFor}
        onOpenChange={(o) => !o && setDelayFor(null)}
        title={t("operator.schedule.reportDelay")}
        size="sm"
        footer={
          <Button loading={setTripDelay.isPending} onClick={() => setTripDelay.mutate()}>
            {t("common.save")}
          </Button>
        }
      >
        <Field label={t("operator.schedule.delayMinutes")}>
          {(p) => <Input {...p} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value.replace(/\D/g, ""))} />}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={!!cancelFor}
        onOpenChange={(o) => !o && setCancelFor(null)}
        title={t("operator.schedule.cancelTrip")}
        body={t("operator.schedule.cancelTripBody", { count: cancelFor?.booked ?? 0 })}
        confirmLabel={t("operator.schedule.cancelTrip")}
        danger
        loading={cancelTrip.isPending}
        onConfirm={() => cancelTrip.mutate()}
      />
      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title={t("common.delete")}
        body={deleteFor ? `${deleteFor.departureTime} · ${deleteFor.route.origin.name} → ${deleteFor.route.destination.name}` : undefined}
        confirmLabel={t("common.delete")}
        danger
        loading={remove.isPending}
        onConfirm={() => deleteFor && remove.mutate(deleteFor)}
      />
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Schedule />
    </Suspense>
  );
}
