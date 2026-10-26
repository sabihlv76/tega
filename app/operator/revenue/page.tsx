"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { BarChart, HBars } from "@/components/ui/charts";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { chartLabel, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwf, formatRwfCompact } from "@/shared/money";
import type { OperatorRevenueDTO } from "@/shared/types";

type Period = "week" | "month" | "year";

export default function RevenuePage() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useQuery({
    queryKey: ["operator", "revenue", period],
    queryFn: () => apiFetch<OperatorRevenueDTO>("/operator/revenue", { query: { period } }),
    placeholderData: (previous) => previous,
  });
  const rate = data ? Math.round(data.commissionRate * 1000) / 10 : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("operator.revenue.title")}
        subtitle={t("operator.revenue.subtitle")}
        actions={
          <Segmented
            label={t("operator.revenue.title")}
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
            <StatCard
              highlight
              label={t("operator.revenue.gross")}
              value={formatRwfCompact(data.gross)}
              hint={`${t("operator.revenue.online")} ${formatRwfCompact(data.online)} · ${t("operator.revenue.cash")} ${formatRwfCompact(data.cash)}`}
            />
            <StatCard
              label={t("operator.revenue.commission")}
              value={formatRwfCompact(data.commission)}
              hint={t("operator.revenue.commissionRate", { rate })}
            />
            <StatCard label={t("operator.revenue.net")} value={formatRwfCompact(data.net)} />
            <StatCard label={t("operator.revenue.parcels")} value={formatRwfCompact(data.parcels)} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t("operator.revenue.trend")} />
              <CardBody>
                <BarChart
                  data={data.series.map((p) => ({ ...p, display: chartLabel(p.label, locale) }))}
                  format={formatRwf}
                  caption={t("operator.revenue.trend")}
                  maxLabels={period === "month" ? 8 : 12}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("operator.revenue.byRoute")} />
              <CardBody>
                {data.byRoute.length === 0 ? (
                  <p className="text-sm text-muted">{t("common.noResults")}</p>
                ) : (
                  <HBars rows={data.byRoute.map((r) => ({ label: r.route, value: r.gross }))} format={formatRwfCompact} />
                )}
              </CardBody>
            </Card>
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{t("operator.revenue.payouts")}</h2>
              <p className="text-sm text-muted">{t("operator.revenue.cashNote")}</p>
            </div>
            <TableCard>
              {data.payouts.length === 0 ? (
                <EmptyState icon={<Wallet className="size-5" />} title={t("operator.revenue.noPayouts", { days: data.payoutCycleDays })} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("operator.revenue.columns.period")}</Th>
                      <Th className="text-right">{t("operator.revenue.columns.gross")}</Th>
                      <Th className="text-right">{t("operator.revenue.columns.commission")}</Th>
                      <Th className="text-right">{t("operator.revenue.columns.net")}</Th>
                      <Th>{t("operator.revenue.columns.due")}</Th>
                      <Th>{t("operator.revenue.columns.status")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((p) => (
                      <Tr key={p.id}>
                        <Td className="whitespace-nowrap">
                          {formatDate(p.periodStart, locale, { year: undefined })} – {formatDate(p.periodEnd, locale)}
                        </Td>
                        <Td className="text-right tabular">{formatRwf(p.gross)}</Td>
                        <Td className="text-right tabular text-muted">{formatRwf(p.commission)}</Td>
                        <Td className="text-right font-semibold tabular">{formatRwf(p.net)}</Td>
                        <Td className="whitespace-nowrap text-sm">
                          {formatDate(p.processedAt ?? p.dueDate, locale)}
                          {p.reference ? <p className="font-mono text-xs text-muted">{p.reference}</p> : null}
                        </Td>
                        <Td>
                          <StatusBadge kind="payout" status={p.status} />
                          {p.failureReason ? <p className="mt-1 text-xs text-error-ink">{p.failureReason}</p> : null}
                        </Td>
                      </Tr>
                    ))}
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
