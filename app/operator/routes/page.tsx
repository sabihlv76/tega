"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MoreVertical, Pause, Pencil, Play, Plus, Route as RouteIcon, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LocationSelect } from "@/components/portal/location-select";
import { useLocations } from "@/components/location-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { usePublicConfig } from "@/lib/config";
import { errorMessage, toastError } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { capStatusFor, formatRwf } from "@/shared/money";
import { formatDuration } from "@/shared/time";
import type { RouteDTO } from "@/shared/types";

type Filter = "all" | "active" | "paused";

interface FormState {
  originId: string;
  destinationId: string;
  viaIds: string[];
  distanceKm: string;
  hours: string;
  minutes: string;
  priceRwf: string;
}

const empty: FormState = { originId: "", destinationId: "", viaIds: [], distanceKm: "", hours: "", minutes: "", priceRwf: "" };

function RouteDialog({ route, open, onOpenChange }: { route: RouteDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: locations } = useLocations();
  const [form, setForm] = useState<FormState>(empty);
  const [viaPick, setViaPick] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(
      route
        ? {
            originId: route.origin.id,
            destinationId: route.destination.id,
            viaIds: route.via.map((v) => v.id),
            distanceKm: route.distanceKm ? String(route.distanceKm) : "",
            hours: String(Math.floor(route.durationMinutes / 60)),
            minutes: String(route.durationMinutes % 60),
            priceRwf: String(route.priceRwf),
          }
        : empty,
    );
  }, [open, route]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const cap = useQuery({
    queryKey: ["cap", form.originId, form.destinationId, form.viaIds.join(",")],
    queryFn: () =>
      apiFetch<{ capRwf: number | null }>("/fares/cap", {
        query: { origin: form.originId, destination: form.destinationId, via: form.viaIds.join(",") },
      }),
    enabled: !!form.originId && !!form.destinationId && form.originId !== form.destinationId,
  });
  const price = Number(form.priceRwf) || 0;
  const capRwf = cap.data?.capRwf ?? null;
  const status = capStatusFor(price, capRwf);
  const config = usePublicConfig();
  const blocked = status === "above_cap" && config.data?.fareCapEnforcement === "block";
  const duration = (Number(form.hours) || 0) * 60 + (Number(form.minutes) || 0);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        viaIds: form.viaIds,
        distanceKm: form.distanceKm ? Number(form.distanceKm) : null,
        durationMinutes: duration,
        priceRwf: price,
      };
      return route
        ? apiFetch<RouteDTO>(`/operator/routes/${route.id}`, { method: "PATCH", body })
        : apiFetch<RouteDTO>("/operator/routes", { method: "POST", body: { ...body, originId: form.originId, destinationId: form.destinationId } });
    },
    onSuccess: () => {
      toast.success(route ? t("operator.routes.updated") : t("operator.routes.created"));
      void queryClient.invalidateQueries({ queryKey: ["operator", "routes"] });
      onOpenChange(false);
    },
  });

  const name = (id: string) => locations?.find((l) => l.id === id)?.name ?? id;
  const valid = !!form.originId && !!form.destinationId && form.originId !== form.destinationId && duration >= 5 && price > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={route ? t("operator.routes.edit") : t("operator.routes.add")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.isPending} disabled={!valid || blocked} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("operator.routes.origin")}>
          {(p) => (
            <LocationSelect {...p} stationsOnly value={form.originId} onChange={(v) => set("originId", v)} exclude={route ? [] : [form.destinationId]} />
          )}
        </Field>
        <Field label={t("operator.routes.destination")}>
          {(p) => <LocationSelect {...p} value={form.destinationId} onChange={(v) => set("destinationId", v)} exclude={[form.originId]} />}
        </Field>
        <Field label={t("operator.routes.via")} className="sm:col-span-2">
          {(p) => (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <LocationSelect {...p} value={viaPick} onChange={setViaPick} exclude={[form.originId, form.destinationId, ...form.viaIds]} />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={!viaPick}
                  onClick={() => {
                    set("viaIds", [...form.viaIds, viaPick]);
                    setViaPick("");
                  }}
                >
                  <Plus aria-hidden />
                  {t("common.add")}
                </Button>
              </div>
              {form.viaIds.length ? (
                <div className="flex flex-wrap gap-2">
                  {form.viaIds.map((id) => (
                    <Badge key={id} tone="neutral" className="py-1 text-sm">
                      {name(id)}
                      <button
                        type="button"
                        aria-label={`${t("common.remove")} ${name(id)}`}
                        onClick={() => set("viaIds", form.viaIds.filter((v) => v !== id))}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Field>
        <Field label={t("operator.routes.distanceKm")} optional={t("common.optional")}>
          {(p) => <Input {...p} inputMode="numeric" value={form.distanceKm} onChange={(e) => set("distanceKm", e.target.value.replace(/[^\d.]/g, ""))} />}
        </Field>
        <Field label={t("operator.routes.durationMinutes")}>
          {(p) => (
            <div className="flex items-center gap-2">
              <Input {...p} inputMode="numeric" value={form.hours} onChange={(e) => set("hours", e.target.value.replace(/\D/g, ""))} aria-label="h" />
              <span className="text-muted">h</span>
              <Input inputMode="numeric" value={form.minutes} onChange={(e) => set("minutes", e.target.value.replace(/\D/g, ""))} aria-label="min" />
              <span className="text-muted">min</span>
            </div>
          )}
        </Field>
        <Field
          label={t("operator.routes.priceRwf")}
          className="sm:col-span-2"
          hint={capRwf !== null ? t("operator.routes.capValue", { cap: formatRwf(capRwf) }) : form.originId && form.destinationId ? t("operator.routes.noCap") : undefined}
        >
          {(p) => <Input {...p} inputMode="numeric" value={form.priceRwf} onChange={(e) => set("priceRwf", e.target.value.replace(/\D/g, ""))} />}
        </Field>
      </div>
      {status === "above_cap" && capRwf !== null ? (
        <Alert
          tone={blocked ? "error" : "warning"}
          className="mt-4"
          title={t(blocked ? "operator.routes.priceBlocked" : "operator.routes.priceAboveCap", { cap: formatRwf(capRwf) })}
        />
      ) : null}
      {save.error ? (
        <p className="mt-4 text-sm text-error-ink" role="alert">
          {errorMessage(save.error, t)}
        </p>
      ) : null}
    </Dialog>
  );
}

export default function OperatorRoutesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<RouteDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["operator", "routes"], queryFn: () => apiFetch<RouteDTO[]>("/operator/routes") });

  const setStatus = useMutation({
    mutationFn: (r: RouteDTO) =>
      apiFetch<RouteDTO>(`/operator/routes/${r.id}`, { method: "PATCH", body: { status: r.status === "active" ? "paused" : "active" } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["operator", "routes"] }),
    onError: (err) => toastError(err, t),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!needle || `${r.origin.name} ${r.destination.name} ${r.via.map((v) => v.name).join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [data, filter, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("operator.routes.title")}
        subtitle={t("operator.routes.subtitle")}
        actions={
          <Button
            size="lg"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t("operator.routes.add")}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("operator.routes.searchPlaceholder")} className="pl-9" aria-label={t("common.search")} />
        </div>
        <Chips<Filter>
          label={t("common.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("common.all") },
            { value: "active", label: t("operator.routes.active") },
            { value: "paused", label: t("operator.routes.paused") },
          ]}
        />
      </div>

      {isLoading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <TableCard>
          <EmptyState icon={<RouteIcon className="size-5" />} title={t("operator.routes.empty")} />
        </TableCard>
      ) : (
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>{t("operator.routes.columns.route")}</Th>
                <Th>{t("operator.routes.columns.distance")}</Th>
                <Th>{t("operator.routes.columns.duration")}</Th>
                <Th>{t("operator.routes.columns.price")}</Th>
                <Th>{t("operator.routes.columns.tripsPerDay")}</Th>
                <Th>{t("operator.routes.columns.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <p className="font-semibold">
                      {r.origin.name} → {r.destination.name}
                    </p>
                    <p className="text-sm text-muted">{r.via.length ? t("common.via", { stops: r.via.map((v) => v.name).join(", ") }) : t("common.direct")}</p>
                  </Td>
                  <Td className="tabular">{r.distanceKm ? t("common.km", { count: r.distanceKm }) : "—"}</Td>
                  <Td className="tabular">{formatDuration(r.durationMinutes)}</Td>
                  <Td>
                    <p className="font-semibold tabular">{formatRwf(r.priceRwf)}</p>
                    {r.capStatus === "above_cap" ? (
                      <p className="flex items-center gap-1 text-sm text-warning-ink">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {t("operator.routes.aboveCap")}
                      </p>
                    ) : r.capStatus === "no_cap" ? (
                      <p className="text-sm text-faint">{t("operator.routes.noCap")}</p>
                    ) : (
                      <p className="text-sm text-muted">{t("operator.routes.capValue", { cap: formatRwf(r.capRwf ?? 0) })}</p>
                    )}
                  </Td>
                  <Td className="tabular">{r.tripsPerDay}</Td>
                  <Td>
                    {r.status === "paused" ? (
                      <Badge tone="neutral" title={r.pausedReason ?? undefined}>
                        {t("operator.routes.paused")}
                      </Badge>
                    ) : r.capStatus === "above_cap" ? (
                      <Badge tone="warning">{t("operator.routes.warning")}</Badge>
                    ) : (
                      <Badge tone="success">{t("operator.routes.active")}</Badge>
                    )}
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
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                      >
                        {t("operator.routes.edit")}
                      </MenuItem>
                      <MenuItem icon={r.status === "active" ? <Pause aria-hidden /> : <Play aria-hidden />} onSelect={() => setStatus.mutate(r)}>
                        {r.status === "active" ? t("operator.routes.pause") : t("operator.routes.resume")}
                      </MenuItem>
                    </Menu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

      <RouteDialog route={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
