"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, FileText, Pencil, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList, DocumentUpload } from "@/components/portal/documents";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { VEHICLE_STATUSES, type VehicleStatus } from "@/shared/constants";
import type { VehicleDTO } from "@/shared/types";

function VehicleDialog({ vehicle, open, onOpenChange }: { vehicle: VehicleDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [status, setStatus] = useState<VehicleStatus>("active");

  useEffect(() => {
    if (!open) return;
    setPlate(vehicle?.plateNumber ?? "");
    setModel(vehicle?.model ?? "");
    setCapacity(vehicle ? String(vehicle.capacity) : "");
    setStatus((vehicle?.status as VehicleStatus) ?? "active");
  }, [open, vehicle]);

  const save = useMutation({
    mutationFn: () =>
      vehicle
        ? apiFetch<VehicleDTO>(`/operator/vehicles/${vehicle.id}`, {
            method: "PATCH",
            body: { model: model || null, capacity: Number(capacity), status },
          })
        : apiFetch<VehicleDTO>("/operator/vehicles", { method: "POST", body: { plateNumber: plate, model: model || null, capacity: Number(capacity) } }),
    onSuccess: () => {
      toast.success(vehicle ? t("operator.vehicles.updated") : t("operator.vehicles.created"));
      void queryClient.invalidateQueries({ queryKey: ["operator", "vehicles"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={vehicle ? t("operator.vehicles.edit") : t("operator.vehicles.add")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.isPending} disabled={(!vehicle && plate.length < 5) || !(Number(capacity) > 0)} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("operator.vehicles.plate")}>
          {(p) => <Input {...p} value={plate} disabled={!!vehicle} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="RAC 204 B" />}
        </Field>
        <Field label={t("operator.vehicles.capacity")}>
          {(p) => <Input {...p} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} placeholder="30" />}
        </Field>
        <Field label={t("operator.vehicles.model")} className="sm:col-span-2">
          {(p) => <Input {...p} value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("operator.vehicles.modelPlaceholder")} />}
        </Field>
        {vehicle ? (
          <Field label={t("common.status")}>
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as VehicleStatus)}>
                {VEHICLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`operator.vehicles.status.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>
      {save.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
    </Dialog>
  );
}

export default function VehiclesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<VehicleDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [docsFor, setDocsFor] = useState<VehicleDTO | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["operator", "vehicles"], queryFn: () => apiFetch<VehicleDTO[]>("/operator/vehicles") });
  const docsVehicle = data?.find((v) => v.id === docsFor?.id) ?? docsFor;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("operator.vehicles.title")}
        subtitle={t("operator.vehicles.subtitle")}
        actions={
          <Button
            size="lg"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t("operator.vehicles.add")}
          </Button>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Bus className="size-5" />} title={t("operator.vehicles.empty")} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((v) => (
            <Card key={v.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-lg font-bold tracking-wide">{v.plateNumber}</p>
                  <p className="text-[15px] text-muted">{v.model ?? "—"}</p>
                </div>
                <StatusBadge kind="vehicle" status={v.status} />
              </div>
              <div className="mt-4 flex items-center gap-4 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-4" aria-hidden />
                  {t("common.places", { count: v.capacity })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="size-4" aria-hidden />
                  {v.documents.length}
                </span>
              </div>
              <div className="mt-5 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(v);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil aria-hidden />
                  {t("common.edit")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDocsFor(v)}>
                  <FileText aria-hidden />
                  {t("operator.vehicles.documents")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <VehicleDialog vehicle={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <Dialog
        open={!!docsFor}
        onOpenChange={(o) => !o && setDocsFor(null)}
        title={`${t("operator.vehicles.documents")} · ${docsVehicle?.plateNumber ?? ""}`}
        size="lg"
      >
        {docsVehicle ? (
          <div className="space-y-4">
            <DocumentList documents={docsVehicle.documents} />
            <DocumentUpload
              endpoint={`/operator/vehicles/${docsVehicle.id}/documents`}
              types={["insurance", "roadworthiness", "rura_permit", "other"]}
              onUploaded={() => void queryClient.invalidateQueries({ queryKey: ["operator", "vehicles"] })}
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
