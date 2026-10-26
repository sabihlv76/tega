"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BusFront, ReceiptText } from "lucide-react";
import Link from "next/link";
import { DepartureRow } from "@/components/portal/departures";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Alert, EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { formatRwf, formatRwfCompact } from "@/shared/money";
import type { OperatorDashboardDTO } from "@/shared/types";

function change(value: number | null, t: ReturnType<typeof useI18n>["t"]) {
  if (value === null) return undefined;
  return t("operator.dashboard.vsYesterday", { change: value > 0 ? `+${value}` : value });
}

export default function OperatorDashboard() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["operator", "dashboard"],
    queryFn: () => apiFetch<OperatorDashboardDTO>("/operator/dashboard"),
    refetchInterval: 60_000,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["operator", "dashboard"] });
  useSocketEvent("booking.created", refresh);
  useSocketEvent("checkin.created", refresh);
  useSocketEvent("trip.updated", refresh);

  if (isLoading || !data) return <PageLoader />;

  return (
    <div className="space-y-8">
      <PageHeader title={t("operator.dashboard.title")} subtitle={formatDate(new Date(), locale, { weekday: "long" })} />

      {data.capViolations > 0 ? (
        <Alert
          tone="warning"
          title={t("operator.dashboard.capWarning", { count: data.capViolations })}
          action={
            <ButtonLink href="/operator/pricing" size="sm">
              {t("operator.dashboard.review")}
            </ButtonLink>
          }
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          highlight
          label={t("operator.dashboard.todaysBookings")}
          value={data.bookingsToday}
          hint={change(data.bookingsChange, t)}
          hintTone={(data.bookingsChange ?? 0) >= 0 ? "success" : "error"}
        />
        <StatCard
          label={t("operator.dashboard.revenueToday")}
          value={formatRwfCompact(data.revenueToday)}
          hint={change(data.revenueChange, t)}
          hintTone={(data.revenueChange ?? 0) >= 0 ? "success" : "error"}
        />
        <StatCard
          label={t("operator.dashboard.activeVehicles")}
          value={data.activeVehicles}
          hint={t("operator.dashboard.ofTotal", { total: data.totalVehicles })}
        />
        <StatCard
          label={t("operator.dashboard.parcelsInTransit")}
          value={data.parcelsInTransit}
          hint={t("operator.dashboard.pendingPickup", { count: data.parcelsPendingPickup })}
          hintTone={data.parcelsPendingPickup > 0 ? "warning" : "muted"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={t("operator.dashboard.upcomingDepartures")}
            action={
              <Link href="/operator/schedule" className="text-sm font-medium text-muted hover:text-ink">
                {t("common.viewAll")}
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {data.upcomingDepartures.length === 0 ? (
              <EmptyState icon={<BusFront className="size-5" />} title={t("operator.dashboard.noDepartures")} />
            ) : (
              data.upcomingDepartures.map((trip) => <DepartureRow key={trip.id} trip={trip} href={`/operator/schedule?trip=${trip.id}`} />)
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t("operator.dashboard.recentBookings")}
            action={
              <Link href="/operator/bookings" className="text-sm font-medium text-muted hover:text-ink">
                {t("common.viewAll")}
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {data.recentBookings.length === 0 ? (
              <EmptyState icon={<ReceiptText className="size-5" />} title={t("operator.dashboard.noBookings")} />
            ) : (
              data.recentBookings.map((b) => (
                <div key={b.id} className="flex items-center gap-4 rounded-card bg-canvas p-3">
                  <Avatar name={b.travelerName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{b.travelerName}</p>
                    <p className="truncate text-sm text-muted">
                      {b.trip.origin.name} → {b.trip.destination.name} · {t("common.places", { count: b.places })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular">{formatRwf(b.totalAmount)}</p>
                    <p className="text-xs text-muted">{relativeTime(b.createdAt, t)}</p>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
