"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { BarChart, HBars } from "@/components/ui/charts";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { chartLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwf, formatRwfCompact } from "@/shared/money";
import { kigaliDate } from "@/shared/time";
import type { AdminRevenueDTO, PayoutDTO } from "@/shared/types";

type Period = "week" | "month" | "year";

function dueLabel(p: PayoutDTO, t: ReturnType<typeof useI18n>["t"]): { text: string; overdue: boolean } {
  const today = new Date(`${kigaliDate()}T00:00:00Z`).getTime();
  const due = new Date(`${kigaliDate(new Date(p.dueDate))}T00:00:00Z`).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { text: t("admin.revenue.overdue"), overdue: true };
  if (days === 0) return { text: t("admin.revenue.dueToday"), overdue: false };
  if (days === 1) return { text: t("admin.revenue.dueTomorrow"), overdue: false };
  return { text: t("admin.revenue.dueInDays", { days }), overdue: false };
}

export default function AdminRevenuePage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "revenue", period],
    queryFn: () => apiFetch<AdminRevenueDTO>("/admin/revenue", { query: { period } }),
    placeholderData: (previous) => previous,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin"] });
  const generate = useMutation({
    mutationFn: () => apiFetch<{ created: number }>("/admin/payouts/generate", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(t("admin.revenue.prepared", { count: r.created }));
      invalidate();
    },
    onError: (err) => toastError(err, t),
  });
  const processAll = useMutation({
    mutationFn: () => apiFetch<{ processed: number }>("/admin/payouts/process-all", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(t("admin.revenue.processed", { count: r.processed }));
      invalidate();
    },
    onError: (err) => toastError(err, t),
  });
  const processOne = useMutation({
    mutationFn: (p: PayoutDTO) => apiFetch<PayoutDTO>(`/admin/payouts/${p.id}/process`, { method: "POST" }),
    onSuccess: (p) => {
      if (p.status === "failed") toast.error(p.failureReason ?? t("statuses.payout.failed"));
      else toast.success(t("admin.revenue.processed", { count: 1 }));
      invalidate();
    },
    onError: (err) => toastError(err, t),
  });

  const periodName = t(`operator.revenue.${period}`).toLowerCase();
  const change = (value: number | null) =>
    value === null ? undefined : t("admin.revenue.vsLast", { change: value > 0 ? `+${value}` : value, period: periodName });
  const tone = (value: number | null) => ((value ?? 0) >= 0 ? "success" : "error") as "success" | "error";

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("admin.revenue.title")}
        subtitle={t("admin.revenue.subtitle")}
        actions={
          <Segmented
            label={t("admin.revenue.title")}
            value={period}
            onChange={setPeriod}
            options={(["week", "month", "year"] as const).map((p) => ({ value: p, label: t(`operator.revenue.${p}`) }))}
          />
        }
      />
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard highlight label={t("admin.revenue.gross")} value={formatRwfCompact(data.gross)} hint={change(data.grossChange)} hintTone={tone(data.grossChange)} />
            <StatCard
              label={t("admin.revenue.commission", { rate: Math.round(data.commissionRate * 1000) / 10 })}
              value={formatRwfCompact(data.commission)}
              hint={change(data.commissionChange)}
              hintTone={tone(data.commissionChange)}
            />
            <StatCard label={t("admin.revenue.parcelRevenue")} value={formatRwfCompact(data.parcelRevenue)} hint={change(data.parcelChange)} hintTone={tone(data.parcelChange)} />
            <StatCard
              label={t("admin.revenue.pendingPayouts")}
              value={formatRwfCompact(data.pendingPayouts)}
              hint={t("admin.revenue.operatorsDue", { count: data.operatorsDueThisWeek })}
              hintTone="warning"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t("admin.revenue.trend")} />
              <CardBody>
                <BarChart
                  data={data.series.map((p) => ({ ...p, display: chartLabel(p.label, locale) }))}
                  format={formatRwf}
                  caption={t("admin.revenue.trend")}
                  maxLabels={period === "month" ? 8 : 12}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("admin.revenue.byOperator")} />
              <CardBody>
                {data.byOperator.length === 0 ? (
                  <p className="text-sm text-muted">{t("common.noResults")}</p>
                ) : (
                  <HBars rows={data.byOperator.map((r) => ({ label: r.operator.name, value: r.commission }))} format={formatRwfCompact} />
                )}
              </CardBody>
            </Card>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("admin.revenue.upcomingPayouts")}</h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" loading={generate.isPending} onClick={() => generate.mutate()}>
                  {t("admin.revenue.generate")}
                </Button>
                <Button
                  loading={processAll.isPending}
                  disabled={!data.upcomingPayouts.some((p) => p.status === "pending")}
                  onClick={() => processAll.mutate()}
                >
                  {t("admin.revenue.processAll")}
                </Button>
              </div>
            </div>
            <TableCard>
              {data.upcomingPayouts.length === 0 ? (
                <EmptyState icon={<Wallet className="size-5" />} title={t("admin.revenue.noPayouts")} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("admin.revenue.columns.operator")}</Th>
                      <Th>{t("admin.revenue.columns.account")}</Th>
                      <Th className="text-right">{t("admin.revenue.columns.gross")}</Th>
                      <Th className="text-right">{t("admin.revenue.columns.net")}</Th>
                      <Th>{t("admin.revenue.columns.due")}</Th>
                      <Th>{t("admin.revenue.columns.status")}</Th>
                      <Th>
                        <span className="sr-only">{t("common.actions")}</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcomingPayouts.map((p) => {
                      const due = dueLabel(p, t);
                      return (
                        <Tr key={p.id}>
                          <Td className="font-medium">{p.operator.name}</Td>
                          <Td className="font-mono text-sm">
                            {p.bankAccountMasked ?? <span className="font-sans text-warning-ink">{t("admin.revenue.noAccount")}</span>}
                          </Td>
                          <Td className="text-right tabular">{formatRwf(p.gross)}</Td>
                          <Td className="text-right font-semibold tabular">{formatRwf(p.net)}</Td>
                          <Td className={due.overdue ? "text-sm font-medium text-error-ink" : "text-sm"}>{due.text}</Td>
                          <Td>
                            <StatusBadge kind="payout" status={p.status} />
                            {p.failureReason ? <p className="mt-1 max-w-48 text-xs text-error-ink">{p.failureReason}</p> : null}
                          </Td>
                          <Td className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              loading={processOne.isPending && processOne.variables?.id === p.id}
                              onClick={() => processOne.mutate(p)}
                            >
                              {t("admin.revenue.process")}
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </TableCard>
          </section>
        </>
      )}
    </div>
  );
}
