"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, History } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { BarChart } from "@/components/ui/charts";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { chartLabel, formatDate, relativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwfCompact } from "@/shared/money";
import type { AdminDashboardDTO } from "@/shared/types";

export default function AdminDashboard() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => apiFetch<AdminDashboardDTO>("/admin/dashboard"),
    refetchInterval: 60_000,
  });
  if (isLoading || !data) return <PageLoader />;

  return (
    <div className="space-y-8">
      <PageHeader title={t("admin.dashboard.title")} subtitle={formatDate(new Date(), locale, { weekday: "long" })} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard highlight label={t("admin.dashboard.revenueToday")} value={formatRwfCompact(data.revenueToday)} />
        <StatCard label={t("admin.dashboard.commissionToday")} value={formatRwfCompact(data.commissionToday)} />
        <StatCard label={t("admin.dashboard.bookingsToday")} value={data.bookingsToday} />
        <StatCard label={t("admin.dashboard.passengers")} value={data.passengers.toLocaleString("en-US")} />
        <StatCard
          label={t("admin.dashboard.operators")}
          value={data.operators.total}
          hint={data.operators.pending ? t("admin.dashboard.pendingApproval", { count: data.operators.pending }) : undefined}
          hintTone="warning"
        />
        <StatCard label={t("admin.dashboard.parcelsInTransit")} value={data.parcelsInTransit} />
        <StatCard
          label={t("admin.dashboard.capViolations")}
          value={data.capViolations}
          hintTone={data.capViolations ? "error" : "muted"}
          hint={data.capViolations ? <Link href="/admin/fare-caps" className="underline underline-offset-4">{t("admin.dashboard.review")}</Link> : undefined}
        />
        <StatCard label={t("admin.dashboard.pendingPayouts")} value={formatRwfCompact(data.pendingPayouts)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("admin.dashboard.trend")} />
          <CardBody>
            <BarChart
              data={data.series.map((p) => ({ ...p, display: chartLabel(p.label, locale) }))}
              format={(v) => String(v)}
              caption={t("admin.dashboard.trend")}
              maxLabels={7}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.dashboard.pendingOperators")} />
          <CardBody className="space-y-3">
            {data.pendingOperators.length === 0 ? (
              <EmptyState icon={<Building2 className="size-5" />} title={t("admin.operators.empty")} className="py-6" />
            ) : (
              data.pendingOperators.map((o) => (
                <div key={o.id} className="flex items-center gap-3 rounded-card bg-canvas p-3">
                  <Avatar name={o.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.name}</p>
                    <p className="truncate text-sm text-muted">{relativeTime(o.createdAt, t)}</p>
                  </div>
                  <ButtonLink href={`/admin/operators/${o.id}`} size="sm" variant="outline">
                    {t("admin.dashboard.review")}
                  </ButtonLink>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("admin.dashboard.recentActivity")} />
        <CardBody>
          {data.recentActivity.length === 0 ? (
            <EmptyState icon={<History className="size-5" />} title={t("admin.dashboard.noActivity")} />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentActivity.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-mono text-xs font-semibold">{log.action}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{log.summary ?? log.entityType}</span>
                  {log.actor ? <StatusBadge kind="role" status={log.actor.role} /> : null}
                  <span className="text-sm">{log.actor?.name ?? "FIKA"}</span>
                  <span className="w-24 text-right text-xs text-muted">{relativeTime(log.createdAt, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
