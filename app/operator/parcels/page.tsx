"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Search } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { PageHeader } from "@/components/ui/card";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { formatPhone, formatRwf } from "@/shared/money";
import type { StationParcelDTO } from "@/shared/types";

const FILTERS = ["active", "awaiting_dropoff", "received", "in_transit", "arrived", "collected"] as const;
type Filter = (typeof FILTERS)[number];

export default function OperatorParcelsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["operator", "parcels", status],
    queryFn: () => apiFetch<StationParcelDTO[]>("/operator/parcels", { query: { status } }),
  });
  useSocketEvent("parcel.updated", () => void queryClient.invalidateQueries({ queryKey: ["operator", "parcels"] }));

  const needle = search.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (p) =>
      !needle ||
      p.code.toLowerCase().includes(needle) ||
      p.receiverName.toLowerCase().includes(needle) ||
      p.senderName.toLowerCase().includes(needle) ||
      p.destination.name.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("operator.parcels.title")} subtitle={t("operator.parcels.subtitle")} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          label={t("common.filter")}
          value={status}
          onChange={setStatus}
          options={FILTERS.map((f) => ({ value: f, label: t(`operator.parcels.filters.${f}`) }))}
        />
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.searchPlaceholder")}
            aria-label={t("common.search")}
            className="pl-9"
          />
        </div>
      </div>

      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Package className="size-5" />} title={t("operator.parcels.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("operator.parcels.columns.code")}</Th>
                <Th>{t("operator.parcels.columns.route")}</Th>
                <Th>{t("operator.parcels.columns.receiver")}</Th>
                <Th className="text-right">{t("operator.parcels.columns.weight")}</Th>
                <Th className="text-right">{t("operator.parcels.columns.price")}</Th>
                <Th>{t("operator.parcels.columns.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <p className="font-mono text-sm font-semibold">{p.code}</p>
                    <p className="max-w-56 truncate text-xs text-muted">{p.description}</p>
                  </Td>
                  <Td className="font-medium">
                    {p.origin.name} → {p.destination.name}
                  </Td>
                  <Td>
                    <p className="font-medium">{p.receiverName}</p>
                    <p className="text-sm text-muted tabular">{formatPhone(p.receiverPhone)}</p>
                  </Td>
                  <Td className="text-right tabular">{p.weightKg} kg</Td>
                  <Td className="text-right font-semibold tabular">{formatRwf(p.priceRwf)}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge kind="parcel" status={p.status} />
                      {p.paymentStatus === "cash_due" ? <StatusBadge kind="payment" status="cash_due" /> : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
