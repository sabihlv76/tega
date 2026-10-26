"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Route as RouteIcon, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { formatRwf } from "@/shared/money";
import type { RouteDTO } from "@/shared/types";

const FILTERS = ["all", "above_cap", "no_cap", "paused"] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminRoutesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [pausing, setPausing] = useState<RouteDTO | null>(null);
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "routes", filter],
    queryFn: () => apiFetch<RouteDTO[]>("/admin/routes", { query: { filter } }),
  });
  const act = useMutation({
    mutationFn: ({ route, action, body }: { route: RouteDTO; action: "enforce-cap" | "pause" | "resume"; body?: unknown }) =>
      apiFetch<RouteDTO>(`/admin/routes/${route.id}/${action}`, { method: "POST", body: body ?? {} }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "enforce-cap" ? t("admin.routes.enforced") : t("common.saved"));
      setPausing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toastError(err, t),
  });

  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (r) => !needle || `${r.origin.name} ${r.destination.name} ${r.operator.name}`.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.routes.title")} subtitle={t("admin.routes.subtitle")} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips label={t("common.filter")} value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: t(`admin.routes.filters.${f}`) }))} />
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.searchPlaceholder")} aria-label={t("common.search")} className="pl-9" />
        </div>
      </div>
      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon={<RouteIcon className="size-5" />} title={t("admin.routes.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("operator.routes.columns.route")}</Th>
                <Th>{t("common.operator")}</Th>
                <Th className="text-right">{t("operator.routes.columns.price")}</Th>
                <Th className="text-right">{t("operator.pricing.ruraCap")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <p className="font-medium">
                      {r.origin.name} → {r.destination.name}
                    </p>
                    {r.pausedReason ? <p className="text-sm text-muted">{t("operator.routes.pausedBy", { reason: r.pausedReason })}</p> : null}
                  </Td>
                  <Td>{r.operator.name}</Td>
                  <Td className={r.capStatus === "above_cap" ? "text-right font-semibold text-warning-ink tabular" : "text-right tabular"}>{formatRwf(r.priceRwf)}</Td>
                  <Td className="text-right tabular text-muted">{r.capRwf === null ? "-" : formatRwf(r.capRwf)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge kind="route" status={r.status} />
                      <StatusBadge kind="cap" status={r.capStatus} />
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Menu
                      trigger={
                        <Button variant="ghost" size="iconSm" aria-label={t("common.actions")}>
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                    >
                      <MenuItem disabled={r.capRwf === null || r.priceRwf <= (r.capRwf ?? 0)} onSelect={() => act.mutate({ route: r, action: "enforce-cap" })}>
                        {t("admin.routes.enforceCap")}
                      </MenuItem>
                      {r.status === "paused" ? (
                        <MenuItem onSelect={() => act.mutate({ route: r, action: "resume" })}>{t("admin.routes.resume")}</MenuItem>
                      ) : (
                        <MenuItem
                          danger
                          onSelect={() => {
                            setReason(r.capStatus === "above_cap" ? t("admin.routes.capReason") : "");
                            setPausing(r);
                          }}
                        >
                          {t("admin.routes.pause")}
                        </MenuItem>
                      )}
                    </Menu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>
      <Dialog
        open={!!pausing}
        onOpenChange={(o) => !o && setPausing(null)}
        title={t("admin.routes.pause")}
        description={pausing ? `${pausing.operator.name} · ${pausing.origin.name} → ${pausing.destination.name}` : undefined}
        size="sm"
        footer={
          <Button variant="danger" loading={act.isPending} onClick={() => pausing && act.mutate({ route: pausing, action: "pause", body: { reason: reason.trim() || undefined } })}>
            {t("admin.routes.pause")}
          </Button>
        }
      >
        <Field label={t("admin.routes.pauseReason")}>{(p) => <Input {...p} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}
