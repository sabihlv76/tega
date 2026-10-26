"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import type { FareCapEnforcement } from "@/shared/constants";
import type { LocationDTO, SettingsDTO } from "@/shared/types";

const int = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 5);

type NumberKey = "holdMinutes" | "parcelHoldMinutes" | "defaultCancellationHours" | "reminderMinutesBeforeDeparture" | "payoutCycleDays";
const NUMBER_FIELDS: { key: NumberKey; label: string }[] = [
  { key: "holdMinutes", label: "admin.settings.holdMinutes" },
  { key: "parcelHoldMinutes", label: "admin.settings.parcelHoldMinutes" },
  { key: "defaultCancellationHours", label: "admin.settings.defaultCancellationHours" },
  { key: "reminderMinutesBeforeDeparture", label: "admin.settings.reminderMinutes" },
  { key: "payoutCycleDays", label: "admin.settings.payoutCycleDays" },
];

function PlatformSettingsForm({ settings }: { settings: SettingsDTO }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [commission, setCommission] = useState("");
  const [numbers, setNumbers] = useState<Record<NumberKey, string>>({} as Record<NumberKey, string>);
  const [enforcement, setEnforcement] = useState<FareCapEnforcement>("warn");
  const [channels, setChannels] = useState(settings.channels);
  const [support, setSupport] = useState({ supportPhone: "", supportEmail: "" });

  useEffect(() => {
    setCommission(String(Math.round(settings.commissionRate * 1000) / 10));
    setNumbers(Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, String(settings[f.key])])) as Record<NumberKey, string>);
    setEnforcement(settings.fareCapEnforcement);
    setChannels(settings.channels);
    setSupport({ supportPhone: settings.supportPhone, supportEmail: settings.supportEmail });
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SettingsDTO>("/admin/settings", {
        method: "PATCH",
        body: {
          commissionRate: Math.round(Number(commission) * 10) / 1000,
          ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, Number(numbers[f.key]) || 0])),
          fareCapEnforcement: enforcement,
          channels,
          ...support,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "settings"], data);
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      toast.success(t("admin.settings.saved"));
    },
  });
  const rate = Number(commission);
  const valid = commission !== "" && rate >= 0 && rate <= 50 && support.supportEmail.includes("@");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("admin.settings.business")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.settings.commissionRate")}>
            {(p) => <Input {...p} inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} />}
          </Field>
          <Field label={t("admin.settings.fareCapEnforcement")}>
            {(p) => (
              <Select {...p} value={enforcement} onChange={(e) => setEnforcement(e.target.value as FareCapEnforcement)}>
                <option value="warn">{t("admin.settings.warn")}</option>
                <option value="block">{t("admin.settings.block")}</option>
              </Select>
            )}
          </Field>
          {NUMBER_FIELDS.map((f) => (
            <Field key={f.key} label={t(f.label)}>
              {(p) => <Input {...p} inputMode="numeric" value={numbers[f.key] ?? ""} onChange={(e) => setNumbers((n) => ({ ...n, [f.key]: int(e.target.value) }))} />}
            </Field>
          ))}
        </CardBody>
      </Card>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.settings.channels")} />
          <CardBody className="divide-y divide-line py-2">
            <Switch label={t("profile.sms")} checked={channels.sms} onChange={(sms) => setChannels((c) => ({ ...c, sms }))} />
            <Switch label={t("profile.emailChannel")} checked={channels.email} onChange={(email) => setChannels((c) => ({ ...c, email }))} />
            <Switch label={t("profile.inApp")} checked={channels.inApp} onChange={(inApp) => setChannels((c) => ({ ...c, inApp }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.settings.support")} />
          <CardBody className="space-y-4">
            <Field label={t("admin.settings.supportPhone")}>
              {(p) => <Input {...p} value={support.supportPhone} onChange={(e) => setSupport((s) => ({ ...s, supportPhone: e.target.value }))} />}
            </Field>
            <Field label={t("admin.settings.supportEmail")}>
              {(p) => <Input {...p} type="email" value={support.supportEmail} onChange={(e) => setSupport((s) => ({ ...s, supportEmail: e.target.value }))} />}
            </Field>
          </CardBody>
        </Card>
      </div>
      {save.error ? <p className="text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
      <Button size="lg" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
        {t("common.save")}
      </Button>
    </div>
  );
}

function LocationDialog({ location, open, onOpenChange }: { location: LocationDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", isStation: false, district: "", province: "", aliases: "", active: true });
  useEffect(() => {
    if (!open) return;
    setForm({
      name: location?.name ?? "",
      isStation: location?.isStation ?? false,
      district: location?.district ?? "",
      province: location?.province ?? "",
      aliases: location?.aliases.join(", ") ?? "",
      active: location?.active ?? true,
    });
  }, [open, location]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        isStation: form.isStation,
        district: form.district.trim() || null,
        province: form.province.trim() || null,
        aliases: form.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 10),
      };
      return location
        ? apiFetch(`/admin/locations/${location.id}`, { method: "PATCH", body: { ...body, active: form.active } })
        : apiFetch("/admin/locations", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(t("admin.settings.locationSaved"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={location ? location.name : t("admin.settings.addLocation")}
      footer={
        <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.settings.locationName")} className="sm:col-span-2">
          {(p) => <Input {...p} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}
        </Field>
        <Field label={t("admin.settings.district")} optional={t("common.optional")}>
          {(p) => <Input {...p} value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))} />}
        </Field>
        <Field label={t("admin.settings.province")} optional={t("common.optional")}>
          {(p) => <Input {...p} value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />}
        </Field>
        <Field label={t("admin.settings.aliases")} hint={t("admin.settings.aliasesHint")} className="sm:col-span-2">
          {(p) => <Input {...p} value={form.aliases} onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))} />}
        </Field>
        <div className="sm:col-span-2">
          <Switch label={t("admin.settings.isStation")} checked={form.isStation} onChange={(isStation) => setForm((f) => ({ ...f, isStation }))} />
          {location ? <Switch label={t("admin.settings.locationActive")} checked={form.active} onChange={(active) => setForm((f) => ({ ...f, active }))} /> : null}
        </div>
      </div>
      {save.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
    </Dialog>
  );
}

function LocationsSection() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<LocationDTO | null>(null);
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["admin", "locations"], queryFn: () => apiFetch<LocationDTO[]>("/admin/locations") });
  useEffect(() => {
    if (error) toastError(error, t);
  }, [error, t]);
  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter((l) => !needle || `${l.name} ${l.district ?? ""} ${l.aliases.join(" ")}`.toLowerCase().includes(needle));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("admin.settings.locations")}</h2>
        <div className="flex w-full gap-2 sm:w-auto">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.searchPlaceholder")} aria-label={t("common.search")} className="sm:w-64" />
          <Button
            variant="outline"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden />
            <span className="hidden sm:inline">{t("admin.settings.addLocation")}</span>
          </Button>
        </div>
      </div>
      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon={<MapPin className="size-5" />} title={t("common.noResults")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.settings.locationName")}</Th>
                <Th>{t("admin.settings.district")}</Th>
                <Th>{t("admin.settings.aliases")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <p className="font-medium">{l.name}</p>
                    {l.isStation ? <Badge tone="dark">{t("admin.settings.busPark")}</Badge> : null}
                  </Td>
                  <Td className="text-sm text-muted">{[l.district, l.province].filter(Boolean).join(", ") || "-"}</Td>
                  <Td className="max-w-64 truncate font-mono text-xs text-muted">{l.aliases.join(", ") || "-"}</Td>
                  <Td>{l.active ? <Badge tone="success">{t("statuses.route.active")}</Badge> : <Badge>{t("admin.settings.hidden")}</Badge>}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`${t("common.edit")} ${l.name}`}
                      onClick={() => {
                        setEditing(l);
                        setOpen(true);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>
      <LocationDialog location={editing} open={open} onOpenChange={setOpen} />
    </section>
  );
}

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "settings"], queryFn: () => apiFetch<SettingsDTO>("/admin/settings") });
  return (
    <div className="space-y-8">
      <PageHeader title={t("admin.settings.title")} subtitle={t("admin.settings.subtitle")} />
      {isLoading || !data ? <PageLoader /> : <PlatformSettingsForm settings={data} />}
      <LocationsSection />
    </div>
  );
}
