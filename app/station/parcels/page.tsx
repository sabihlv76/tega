"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ParcelActions } from "@/components/station/parcel-actions";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, PageLoader, Spinner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Chips } from "@/components/ui/segmented";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { formatPhone, formatRwf } from "@/shared/money";
import type { StationParcelDTO, StationParcelsDTO } from "@/shared/types";

type Tab = keyof StationParcelsDTO;

function normalizeCode(input: string): string | null {
  const v = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const body = v.startsWith("FP") ? v.slice(2) : v;
  return body.length === 8 ? `FP-${body}` : null;
}

function ParcelRow({ parcel, stationId, onDone }: { parcel: StationParcelDTO; stationId: string; onDone: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-paper p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-card bg-subtle">
        <Package className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold">
          {parcel.code} <span className="font-sans font-normal text-muted">· {parcel.weightKg} kg</span>
        </p>
        <p className="truncate font-medium">{parcel.description}</p>
        <p className="truncate text-sm text-muted">
          {parcel.origin.name} → {parcel.destination.name} · {parcel.senderName} → {parcel.receiverName}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {parcel.paymentStatus === "cash_due" ? <Badge tone="warning">{formatRwf(parcel.priceRwf)}</Badge> : null}
        <StatusBadge kind="parcel" status={parcel.status} />
        <ParcelActions parcel={parcel} stationId={stationId} onDone={onDone} />
      </div>
    </li>
  );
}

function ParcelDetails({ parcel, stationId, onDone }: { parcel: StationParcelDTO; stationId: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">{t("parcels.sender")}</dt>
          <dd className="font-medium">{parcel.senderName}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t("parcels.receiver")}</dt>
          <dd className="font-medium">{parcel.receiverName}</dd>
          <dd className="text-sm text-muted tabular">{formatPhone(parcel.receiverPhone)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t("common.route")}</dt>
          <dd className="font-medium">
            {parcel.origin.name} → {parcel.destination.name}
          </dd>
          <dd className="text-sm text-muted">{parcel.operator.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t("parcels.description")}</dt>
          <dd className="font-medium">{parcel.description}</dd>
          <dd className="text-sm text-muted">
            {parcel.weightKg} kg · {formatRwf(parcel.priceRwf)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <StatusBadge kind="parcel" status={parcel.status} />
        <StatusBadge kind="payment" status={parcel.paymentStatus} />
        <span className="flex-1" />
        <ParcelActions parcel={parcel} stationId={stationId} onDone={onDone} />
      </div>
    </div>
  );
}

function StationParcels() {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const stationId = user?.station?.id ?? "";
  const [tab, setTab] = useState<Tab>("toReceive");
  const [search, setSearch] = useState(params.get("code") ?? "");
  const [lookup, setLookup] = useState<string | null>(normalizeCode(params.get("code") ?? ""));

  const lists = useQuery({ queryKey: ["station", "parcels"], queryFn: () => apiFetch<StationParcelsDTO>("/station/parcels") });
  const found = useQuery({
    queryKey: ["station", "parcel", lookup],
    queryFn: () => apiFetch<StationParcelDTO>(`/station/parcels/${lookup}`),
    enabled: !!lookup,
    retry: false,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["station"] });
  useSocketEvent("parcel.updated", refresh);

  const rows = lists.data?.[tab] ?? [];
  const tabs: Tab[] = ["toReceive", "toLoad", "toRelease"];
  const code = normalizeCode(search);

  return (
    <div className="space-y-6">
      <PageHeader title={t("station.parcels.title")} subtitle={t("station.parcels.subtitle")} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          label={t("station.parcels.title")}
          value={tab}
          onChange={setTab}
          options={tabs.map((key) => ({ value: key, label: t(`station.parcels.${key}`), count: lists.data?.[key].length }))}
        />
        <form
          className="flex w-full gap-2 lg:w-96"
          onSubmit={(e) => {
            e.preventDefault();
            if (code) setLookup(code);
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
            placeholder="FP-XXXXXXXX"
            aria-label={t("station.manual.parcelLabel")}
            className="font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="outline" size="icon" disabled={!code} aria-label={t("station.manual.findParcel")}>
            <Search aria-hidden />
          </Button>
        </form>
      </div>

      {lists.isLoading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Package className="size-5" />} title={t("station.parcels.empty")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <ParcelRow key={p.id} parcel={p} stationId={stationId} onDone={refresh} />
          ))}
        </ul>
      )}

      <Dialog
        open={!!lookup}
        onOpenChange={(o) => {
          if (o) return;
          setLookup(null);
          if (params.get("code")) router.replace("/station/parcels");
        }}
        title={lookup ?? ""}
        size="lg"
      >
        {found.isLoading ? (
          <Spinner />
        ) : found.error || !found.data ? (
          <p className="text-sm text-error-ink">{errorMessage(found.error, t)}</p>
        ) : (
          <ParcelDetails
            parcel={found.data}
            stationId={stationId}
            onDone={() => {
              refresh();
              void found.refetch();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

export default function StationParcelsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <StationParcels />
    </Suspense>
  );
}
