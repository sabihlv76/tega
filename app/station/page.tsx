"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BusFront, Keyboard, ScanLine } from "lucide-react";
import { DepartureRow } from "@/components/portal/departures";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import type { StationDashboardDTO } from "@/shared/types";

export default function StationDashboard() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["station", "dashboard"],
    queryFn: () => apiFetch<StationDashboardDTO>("/station/dashboard"),
    refetchInterval: 60_000,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["station"] });
  useSocketEvent("trip.updated", refresh);
  useSocketEvent("checkin.created", refresh);
  useSocketEvent("parcel.updated", refresh);

  if (isLoading || !data) return <PageLoader />;
  const next = data.nextDepartures[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title={data.station.name}
        subtitle={formatDate(new Date(), locale, { weekday: "long" })}
        actions={
          <>
            <ButtonLink href="/station/checkin" variant="outline" size="lg">
              <Keyboard aria-hidden />
              {t("station.manualCheckIn")}
            </ButtonLink>
            <ButtonLink href="/station/scan" size="lg">
              <ScanLine aria-hidden />
              {t("station.scanTicket")}
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard highlight label={t("station.departuresToday")} value={data.departuresToday} />
        <StatCard
          label={t("station.passengersCheckedIn")}
          value={`${data.passengersCheckedIn}/${data.passengersBooked}`}
          hint={data.passengersBooked ? `${Math.round((data.passengersCheckedIn / data.passengersBooked) * 100)}%` : undefined}
        />
        <StatCard label={t("station.parcelsToLoad")} value={data.parcelsToLoad} hintTone="warning" />
        <StatCard label={t("station.parcels.toRelease")} value={data.parcelsToRelease} />
      </div>

      <Card>
        <CardHeader title={t("station.nextDepartures")} />
        <CardBody className="space-y-3">
          {!next ? (
            <EmptyState icon={<BusFront className="size-5" />} title={t("station.board.noDepartures")} />
          ) : (
            data.nextDepartures.map((trip, i) => (
              <DepartureRow key={trip.id} trip={trip} href={`/station/trips/${trip.id}`} highlight={i === 0} showOperator />
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
