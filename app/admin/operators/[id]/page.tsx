"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bus, CheckCircle2, Route as RouteIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList } from "@/components/portal/documents";
import { StatusBadge } from "@/components/status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { formatPhone, formatRwf, formatRwfCompact } from "@/shared/money";
import { formatDuration } from "@/shared/time";
import type { AdminOperatorDetailDTO, FileRef, OperatorSummaryDTO } from "@/shared/types";

type Action = "approve" | "reject" | "suspend" | "reactivate";
const DONE: Record<Action, string> = {
  approve: "admin.operators.approved",
  reject: "admin.operators.rejected",
  suspend: "admin.operators.suspended",
  reactivate: "admin.operators.reactivated",
};

function StatusActions({ operator, onChanged }: { operator: OperatorSummaryDTO; onChanged: () => void }) {
  const { t } = useI18n();
  const [action, setAction] = useState<"reject" | "suspend" | null>(null);
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: (a: Action) =>
      apiFetch(`/admin/operators/${operator.id}/${a}`, {
        method: "POST",
        body: a === "reject" || a === "suspend" ? { reason: reason.trim() || undefined } : {},
      }),
    onSuccess: (_data, a) => {
      toast.success(t(DONE[a]));
      setAction(null);
      setReason("");
      onChanged();
    },
    onError: (err) => toastError(err, t),
  });
  const s = operator.status;
  return (
    <div className="flex flex-wrap gap-2">
      {s === "pending" ? (
        <>
          <Button loading={run.isPending && run.variables === "approve"} onClick={() => run.mutate("approve")}>
            <CheckCircle2 aria-hidden />
            {t("admin.operators.approve")}
          </Button>
          <Button variant="outline" onClick={() => setAction("reject")}>
            {t("admin.operators.reject")}
          </Button>
        </>
      ) : null}
      {s === "approved" ? (
        <Button variant="outline" onClick={() => setAction("suspend")}>
          {t("admin.operators.suspend")}
        </Button>
      ) : null}
      {s === "suspended" || s === "rejected" ? (
        <Button loading={run.isPending} onClick={() => run.mutate("reactivate")}>
          {s === "rejected" ? t("admin.operators.approve") : t("admin.operators.reactivate")}
        </Button>
      ) : null}
      <Dialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === "reject" ? t("admin.operators.reject") : t("admin.operators.suspend")}
        description={operator.name}
        size="sm"
        footer={
          <Button variant="danger" loading={run.isPending} onClick={() => action && run.mutate(action)}>
            {action === "reject" ? t("admin.operators.reject") : t("admin.operators.suspend")}
          </Button>
        }
      >
        <Field label={t("admin.operators.reason")}>
          {(p) => <Textarea {...p} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}

function CommissionCard({ operator, onChanged }: { operator: OperatorSummaryDTO; onChanged: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  useEffect(() => setValue(String(Math.round(operator.commissionRate * 1000) / 10)), [operator.commissionRate]);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/operators/${operator.id}`, { method: "PATCH", body: { commissionRate: value.trim() === "" ? null : Number(value) } }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      onChanged();
    },
    onError: (err) => toastError(err, t),
  });
  const n = Number(value);
  const valid = value.trim() === "" || (Number.isFinite(n) && n >= 0 && n <= 100);
  return (
    <Card>
      <CardHeader title={t("admin.operators.commissionOverride")} />
      <CardBody className="flex flex-wrap items-end gap-3">
        <Field label={t("admin.operators.commissionOverride")} hint={t("admin.operators.commissionHint")} className="flex-1">
          {(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} className="w-32" />}
        </Field>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      </CardBody>
    </Card>
  );
}

export default function AdminOperatorPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "operator", id],
    queryFn: () => apiFetch<AdminOperatorDetailDTO>(`/admin/operators/${id}`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin"] });
  const verify = useMutation({
    mutationFn: (doc: FileRef) => apiFetch(`/admin/files/${doc.id}/verify`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      refresh();
    },
    onError: (err) => toastError(err, t),
  });

  if (isLoading) return <PageLoader />;
  if (!data) return <EmptyState title={errorMessage(error, t)} />;
  const { operator: o, routes, vehicles, staff } = data;

  return (
    <div className="space-y-6">
      <Link href="/admin/operators" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t("admin.operators.title")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={o.name} className="size-14 text-lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{o.name}</h1>
              <StatusBadge kind="operator" status={o.status} />
            </div>
            <p className="text-muted">
              <span className="font-mono">{o.registrationNumber}</span> · <span className="tabular">{formatPhone(o.contactPhone)}</span>
              {o.contactEmail ? ` · ${o.contactEmail}` : ""}
              {o.headquarters ? ` · ${o.headquarters.name}` : ""}
            </p>
          </div>
        </div>
        <StatusActions operator={o} onChanged={refresh} />
      </div>
      {o.statusReason && o.status !== "approved" ? <Alert tone="warning" title={o.statusReason} /> : null}

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("admin.operators.stats.routes")} value={o.stats.routes} />
        <StatCard label={t("admin.operators.stats.vehicles")} value={o.stats.vehicles} />
        <StatCard label={t("admin.operators.stats.tripsToday")} value={o.stats.tripsToday} />
        <StatCard label={t("admin.operators.stats.bookings30d")} value={o.stats.bookings30d} />
        <StatCard label={t("admin.operators.stats.revenue30d")} value={formatRwfCompact(o.stats.revenue30d)} />
        <StatCard
          label={t("admin.operators.stats.capViolations")}
          value={o.stats.capViolations}
          hintTone="error"
          hint={o.stats.capViolations ? t("statuses.cap.above_cap") : undefined}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.operators.documents")} />
          <CardBody>
            <DocumentList documents={o.documents} onVerify={(d) => verify.mutate(d)} />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <CommissionCard operator={o} onChanged={refresh} />
          <Card>
            <CardHeader title={t("operator.settings.team")} />
            <CardBody>
              <ul className="divide-y divide-line">
                {staff.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-3">
                    <Avatar name={u.name} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.name ?? "-"}</p>
                      <p className="truncate text-sm text-muted tabular">{[formatPhone(u.phone), u.email].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="text-sm text-muted">{u.isOperatorOwner ? t("operator.settings.owner") : t("operator.settings.staff")}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("admin.operators.routes")}</h2>
        <TableCard>
          {routes.length === 0 ? (
            <EmptyState icon={<RouteIcon className="size-5" />} title={t("common.noResults")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("operator.routes.columns.route")}</Th>
                  <Th>{t("operator.routes.columns.duration")}</Th>
                  <Th className="text-right">{t("operator.routes.columns.price")}</Th>
                  <Th className="text-right">{t("operator.pricing.ruraCap")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">
                      {r.origin.name} → {r.destination.name}
                    </Td>
                    <Td className="text-sm text-muted">{formatDuration(r.durationMinutes)}</Td>
                    <Td className="text-right tabular">{formatRwf(r.priceRwf)}</Td>
                    <Td className="text-right tabular text-muted">{r.capRwf === null ? "-" : formatRwf(r.capRwf)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge kind="route" status={r.status} />
                        {r.capStatus !== "ok" ? <StatusBadge kind="cap" status={r.capStatus} /> : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </TableCard>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("admin.operators.vehicles")}</h2>
        {vehicles.length === 0 ? (
          <Card>
            <EmptyState icon={<Bus className="size-5" />} title={t("operator.vehicles.empty")} />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {vehicles.map((v) => (
              <Card key={v.id} className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-lg font-bold">{v.plateNumber}</p>
                    <p className="text-sm text-muted">
                      {v.model ?? "-"} · {t("common.places", { count: v.capacity })}
                    </p>
                  </div>
                  <StatusBadge kind="vehicle" status={v.status} />
                </div>
                <DocumentList documents={v.documents} onVerify={(d) => verify.mutate(d)} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
