"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, MoreVertical, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LocationSelect } from "@/components/portal/location-select";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Alert, Badge, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Switch } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwf } from "@/shared/money";
import { kigaliDate } from "@/shared/time";
import type { FareCapDTO, FareCapListDTO } from "@/shared/types";

const num = (v: string) => v.replace(/[^0-9.]/g, "");

function CapDialog({ cap, open, onOpenChange }: { cap: FareCapDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ originId: "", destinationId: "", viaId: "", capRwf: "", distanceKm: "", effectiveFrom: "" });
  useEffect(() => {
    if (!open) return;
    setForm({
      originId: cap?.origin.id ?? "",
      destinationId: cap?.destination.id ?? "",
      viaId: cap?.via?.id ?? "",
      capRwf: cap ? String(cap.capRwf) : "",
      distanceKm: cap?.distanceKm ? String(cap.distanceKm) : "",
      effectiveFrom: cap ? kigaliDate(new Date(cap.effectiveFrom)) : kigaliDate(),
    });
  }, [open, cap]);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const common = {
        capRwf: Number(form.capRwf),
        distanceKm: form.distanceKm ? Number(form.distanceKm) : null,
        effectiveFrom: form.effectiveFrom || undefined,
      };
      return cap
        ? apiFetch(`/admin/fare-caps/${cap.id}`, { method: "PATCH", body: common })
        : apiFetch("/admin/fare-caps", {
            method: "POST",
            body: { ...common, originId: form.originId, destinationId: form.destinationId, viaId: form.viaId || null },
          });
    },
    onSuccess: () => {
      toast.success(t("admin.fareCaps.saved"));
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      onOpenChange(false);
    },
  });
  const valid = Number(form.capRwf) > 0 && (cap || (form.originId && form.destinationId && form.originId !== form.destinationId));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={cap ? t("admin.fareCaps.edit") : t("admin.fareCaps.add")}
      description={cap ? `${cap.origin.name} → ${cap.destination.name}${cap.via ? ` (${cap.via.name})` : ""}` : undefined}
      footer={
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {cap ? null : (
          <>
            <Field label={t("admin.fareCaps.origin")}>
              {(p) => <LocationSelect {...p} value={form.originId} onChange={(v) => set("originId", v)} exclude={[form.destinationId]} />}
            </Field>
            <Field label={t("admin.fareCaps.destination")}>
              {(p) => <LocationSelect {...p} value={form.destinationId} onChange={(v) => set("destinationId", v)} exclude={[form.originId]} />}
            </Field>
            <Field label={t("admin.fareCaps.via")} className="sm:col-span-2">
              {(p) => <LocationSelect {...p} value={form.viaId} onChange={(v) => set("viaId", v)} exclude={[form.originId, form.destinationId]} />}
            </Field>
          </>
        )}
        <Field label={t("admin.fareCaps.capRwf")}>
          {(p) => <Input {...p} inputMode="numeric" value={form.capRwf} onChange={(e) => set("capRwf", num(e.target.value).replace(".", ""))} />}
        </Field>
        <Field label={t("admin.fareCaps.distanceKm")} optional={t("common.optional")}>
          {(p) => <Input {...p} inputMode="decimal" value={form.distanceKm} onChange={(e) => set("distanceKm", num(e.target.value))} />}
        </Field>
        <Field label={t("admin.fareCaps.effectiveFrom")}>
          {(p) => <Input {...p} type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />}
        </Field>
      </div>
      {save.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const run = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (file) form.set("file", file);
      return apiFetch<{ imported: number; errors: string[] }>("/admin/fare-caps/import", { method: "POST", form });
    },
    onSuccess: (r) => {
      toast.success(t("admin.fareCaps.imported", { count: r.imported }));
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      setFile(null);
      setErrors(r.errors);
      if (r.errors.length === 0) onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.fareCaps.importCsv")}
      description={t("admin.fareCaps.csvHint")}
      footer={
        <Button loading={run.isPending} disabled={!file} onClick={() => run.mutate()}>
          <Upload aria-hidden />
          {t("admin.fareCaps.updateCaps")}
        </Button>
      }
    >
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label={t("admin.fareCaps.importCsv")}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm file:mr-3 file:rounded-input file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-medium"
      />
      {run.error ? <p className="mt-3 text-sm text-error-ink">{errorMessage(run.error, t)}</p> : null}
      {errors.length ? (
        <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-card bg-error-soft p-3 font-mono text-xs text-error-ink">
          {errors.slice(0, 50).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

export default function FareCapsPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<FareCapDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<FareCapDTO | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "fare-caps", q.trim(), showAll],
    queryFn: () => apiFetch<FareCapListDTO>("/admin/fare-caps", { query: { q: q.trim() || undefined, withRoutes: showAll ? "0" : "1" } }),
    placeholderData: (previous) => previous,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin"] });
  const enforce = useMutation({
    mutationFn: (routeId: string) => apiFetch(`/admin/routes/${routeId}/enforce-cap`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("admin.routes.enforced"));
      invalidate();
    },
    onError: (err) => toastError(err, t),
  });
  const remove = useMutation({
    mutationFn: (cap: FareCapDTO) => apiFetch(`/admin/fare-caps/${cap.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("admin.fareCaps.deleted"));
      setDeleting(null);
      invalidate();
    },
    onError: (err) => toastError(err, t),
  });
  const violations = data?.violations ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.fareCaps.title")}
        subtitle={t("admin.fareCaps.subtitle")}
        actions={
          <>
            <Button size="lg" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden />
              {t("admin.fareCaps.importCsv")}
            </Button>
            <Button
              size="lg"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus aria-hidden />
              {t("admin.fareCaps.add")}
            </Button>
          </>
        }
      />

      {violations.length ? (
        <Alert tone="warning" title={t("admin.fareCaps.violations", { count: violations.length })}>
          <ul className="mt-2 space-y-2">
            {violations.map((v) => (
              <li key={v.routeId} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-ink">
                  {t("admin.fareCaps.violationLine", {
                    operator: v.operator.name,
                    route: `${v.origin.name} → ${v.destination.name}`,
                    price: formatRwf(v.priceRwf),
                    cap: formatRwf(v.capRwf),
                  })}
                </span>
                <Button size="sm" variant="outline" loading={enforce.isPending && enforce.variables === v.routeId} onClick={() => enforce.mutate(v.routeId)}>
                  {t("admin.routes.enforceCap")}
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.fareCaps.searchPlaceholder")} aria-label={t("common.search")} className="pl-9" />
        </div>
        <div className="w-full lg:w-auto">
          <Switch label={t("admin.fareCaps.showAll")} checked={showAll} onChange={setShowAll} />
        </div>
      </div>

      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : !data?.items.length ? (
          <EmptyState icon={<Gauge className="size-5" />} title={t("common.noResults")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.fareCaps.columns.corridor")}</Th>
                <Th className="text-right">{t("admin.fareCaps.columns.distance")}</Th>
                <Th className="text-right">{t("admin.fareCaps.columns.cap")}</Th>
                <Th>{t("admin.fareCaps.columns.effective")}</Th>
                <Th>{t("admin.fareCaps.columns.operators")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <p className="font-medium">
                      {c.origin.name} → {c.destination.name}
                    </p>
                    {c.via ? <p className="text-sm text-muted">{t("common.via", { stops: c.via.name })}</p> : null}
                  </Td>
                  <Td className="text-right tabular text-muted">{c.distanceKm ? t("common.km", { count: c.distanceKm }) : "-"}</Td>
                  <Td className="text-right font-semibold tabular">{formatRwf(c.capRwf)}</Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{formatDate(c.effectiveFrom, locale)}</Td>
                  <Td>
                    {c.violations ? (
                      <Badge tone="warning">{t("admin.fareCaps.violationsCount", { count: c.operators, violations: c.violations })}</Badge>
                    ) : (
                      <span className="tabular">{c.operators}</span>
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
                          setEditing(c);
                          setDialogOpen(true);
                        }}
                      >
                        {t("common.edit")}
                      </MenuItem>
                      <MenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => setDeleting(c)}>
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
      <p className="text-sm text-muted">{t("admin.fareCaps.footnote")}</p>

      <CapDialog cap={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("common.delete")}
        body={deleting ? `${deleting.origin.name} → ${deleting.destination.name} · ${formatRwf(deleting.capRwf)}` : undefined}
        confirmLabel={t("common.delete")}
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
